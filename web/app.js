import { FilesetResolver, PoseLandmarker, DrawingUtils } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3';

let facingMode = 'environment'; 
let stream, rafId, poseLandmarker, lastVideoTime = -1;

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const switchBtn = document.getElementById('switchBtn');
const mirrorCb = document.getElementById('mirror');
const modeCleanBtn = document.getElementById('modeClean');
const modeSquatBtn = document.getElementById('modeSquat');
const resetBtn = document.getElementById('resetBtn');
const errorEl = document.getElementById('error');
const repsEl = document.getElementById('reps');
const stateEl = document.getElementById('state');
const feedbackEl = document.getElementById('feedback');
const velStatsEl = document.getElementById('velStats');


let reps = 0;
let phase = 'Stand';
let mode = 'clean'; 
let lastRepTimestamp = 0;
const REP_COOLDOWN_MS = 1200;


let lastWristY = null; 
let lastVelTs = 0;
let smoothedUpVelPxps = 0; 
let peakUpVelThisRep = 0; 
let lastRepPeakUpVel = 0; 


const ASSUMED_BODY_HEIGHT_M = 1.70;
const THRESHOLD_MPS = 1.2;
const FLASH_MS = 200;
let currentMetersPerPixel = null; 
let lastRepPeakUpVelMps = 0; 
let flashColor = null; 
let flashUntilMs = 0;

async function loadModel() {
  const fileset = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
}

async function startCamera() {
  stopCamera();
  errorEl.textContent = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    resizeCanvas();
    applyMirror();
    drawLoop();
  } catch (err) {
    errorEl.textContent = `Camera access failed: ${err.message}`;
  }
}

function stopCamera() {
  cancelAnimationFrame(rafId);
  if (stream) stream.getTracks().forEach(t => t.stop());
}

function resizeCanvas() {
  if (!video.videoWidth || !video.videoHeight) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

function drawLoop() {
  const w = canvas.width, h = canvas.height;
  const drawingUtils = new DrawingUtils(ctx);

  async function frame() {
    rafId = requestAnimationFrame(frame);
    if (!poseLandmarker) return;

    if (lastVideoTime === video.currentTime) return; 
    lastVideoTime = video.currentTime;

    ctx.clearRect(0, 0, w, h);

    const nowMs = performance.now();
    const result = poseLandmarker.detectForVideo(video, nowMs);
    const pose = result?.landmarks?.[0];

    if (pose) {
      if (pose && pose.length) {
        let minY = 1, maxY = 0;
        for (let i = 0; i < pose.length; i++) {
          const p = pose[i];
          if (!p) continue;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const pixelHeight = Math.max(1, (maxY - minY) * h);
        currentMetersPerPixel = ASSUMED_BODY_HEIGHT_M / pixelHeight;
      }

      drawingUtils.drawLandmarks(pose, { lineWidth: 2, color: '#00FF88', radius: 3 });
      const connections = PoseLandmarker.POSE_CONNECTIONS || [];
      if (connections.length) {
        drawingUtils.drawConnectors(pose, connections, { color: '#00FF88', lineWidth: 2 });
      }

      const feedbacks = [];

      
      const wristR = pose?.[16] || null;
      const wristL = pose?.[15] || null;
      const wrist = wristR || wristL;
      if (wrist) {
        const y = wrist.y; 
        if (lastWristY !== null) {
          const dt = Math.max(1, nowMs - lastVelTs) / 1000; 
          const vyPxps = (lastWristY - y) * h / dt; 
          const alpha = 0.3;
          smoothedUpVelPxps = alpha * vyPxps + (1 - alpha) * smoothedUpVelPxps;
          if (smoothedUpVelPxps > peakUpVelThisRep) peakUpVelThisRep = smoothedUpVelPxps;
        }
        lastWristY = y;
        lastVelTs = nowMs;
      }

      if (mode === 'squat') {
        const hip = pose[24], knee = pose[26], ankle = pose[28];
        if (hip && knee && ankle) {
          const angle = computeAngle(hip, knee, ankle);
          const depth = Math.round(angle);

          if (angle < 140 && phase === 'Stand') phase = 'Down';
          if (angle > 165 && phase === 'Down') { reps += 1; phase = 'Stand'; }

          if (Math.abs(knee.x - ankle.x) > 0.08) feedbacks.push('Knees tracking off');
          if (angle > 165) feedbacks.push('Go deeper');
          if (angle < 90) feedbacks.push('Good depth');

          drawAngleBadge(knee, depth, w, h);
        }
      } else {
        
        const shoulder = pose[12], elbow = pose[14], wrist = pose[16];
        const hip = pose[24], knee = pose[26];
        if (shoulder && elbow && wrist && hip && knee) {
          const elbowDeg = Math.round(computeAngle(shoulder, elbow, wrist));
          const hipKneeDeg = Math.round(computeAngle(shoulder, hip, knee));

      
          if (phase === 'Stand' && hipKneeDeg < 150) phase = 'Pull';
          if (phase === 'Pull' && elbowDeg < 65) phase = 'Rack';
          if (phase === 'Rack' && hipKneeDeg > 165 && elbowDeg > 140) {
            const now = nowMs;
            if (now - lastRepTimestamp > REP_COOLDOWN_MS) {
              reps += 1;
              lastRepTimestamp = now;
            }
            
            lastRepPeakUpVel = peakUpVelThisRep;
            lastRepPeakUpVelMps = currentMetersPerPixel ? lastRepPeakUpVel * currentMetersPerPixel : 0;
            if (lastRepPeakUpVelMps > 0) {
              flashColor = lastRepPeakUpVelMps >= THRESHOLD_MPS ? 'green' : 'red';
              flashUntilMs = nowMs + FLASH_MS;
            }
            peakUpVelThisRep = 0;
            phase = 'Stand';
          }

          if (elbowDeg >= 65 && phase !== 'Stand') feedbacks.push('Drive elbows through');
          if (hipKneeDeg < 145 && phase !== 'Rack') feedbacks.push('Extend hips/knees');

          drawAngleBadge(elbow, elbowDeg, w, h);
        }
      }

      repsEl.textContent = String(reps);
      stateEl.textContent = phase;
      feedbackEl.textContent = feedbacks.join(' · ');
      if (velStatsEl) {
        const curr = Math.max(0, smoothedUpVelPxps);
        const mpsCurr = currentMetersPerPixel ? curr * currentMetersPerPixel : 0;
        const peakPxps = Math.max(0, lastRepPeakUpVel || peakUpVelThisRep);
        const peakMps = lastRepPeakUpVelMps || (currentMetersPerPixel ? peakPxps * currentMetersPerPixel : 0);
        velStatsEl.textContent = `v↑ ${mpsCurr.toFixed(2)} m/s · peak ${peakMps.toFixed(2)} m/s`;
      }

      if (flashColor && nowMs < flashUntilMs) {
        ctx.save();
        ctx.fillStyle = flashColor === 'green' ? 'rgba(0,255,136,0.18)' : 'rgba(255,0,0,0.18)';
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }
  }
  frame();
}

function computeAngle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  const cos = Math.min(1, Math.max(-1, dot / (magAB * magCB + 1e-6)));
  return Math.acos(cos) * 180 / Math.PI;
}

function setMode(next) {
  mode = next;
  reps = 0; phase = 'Stand';
  if (typeof modeCleanBtn !== 'undefined') {
    modeCleanBtn.classList.toggle('is-active', mode === 'clean');
  }
  if (typeof modeSquatBtn !== 'undefined') {
    modeSquatBtn.classList.toggle('is-active', mode === 'squat');
  }
}

function drawAngleBadge(point, value, w, h) {
  const px = point.x * w, py = point.y * h;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeStyle = '#00FF88';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px system-ui,-apple-system,Segoe UI,Roboto';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${value}°`, px, py);
}

function applyMirror() {
  const mirror = mirrorCb.checked && facingMode === 'user';
  video.classList.toggle('mirrored', mirror);
  canvas.classList.toggle('mirrored', mirror);
}

switchBtn.addEventListener('click', async () => {
  facingMode = (facingMode === 'user') ? 'environment' : 'user';
  await startCamera();
});

mirrorCb.addEventListener('change', applyMirror);
video.addEventListener('loadedmetadata', resizeCanvas);
window.addEventListener('resize', resizeCanvas);

(async () => {
  await loadModel();
  await startCamera();
})();

if (modeCleanBtn && modeSquatBtn) {
  modeCleanBtn.addEventListener('click', () => setMode('clean'));
  modeSquatBtn.addEventListener('click', () => setMode('squat'));
}

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    reps = 0;
    phase = 'Stand';
    lastRepTimestamp = 0;
    repsEl.textContent = '0';
    stateEl.textContent = phase;
  });
}

