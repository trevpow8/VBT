import { FilesetResolver, PoseLandmarker, DrawingUtils } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3';

let facingMode = 'environment'; // start with back camera for exercise
let stream, rafId, poseLandmarker, lastVideoTime = -1;

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const switchBtn = document.getElementById('switchBtn');
const mirrorCb = document.getElementById('mirror');
const modeCleanBtn = document.getElementById('modeClean');
const modeSquatBtn = document.getElementById('modeSquat');
const errorEl = document.getElementById('error');
const repsEl = document.getElementById('reps');
const stateEl = document.getElementById('state');
const feedbackEl = document.getElementById('feedback');


let reps = 0;
let phase = 'Stand';
let mode = 'clean'; // 'clean' | 'squat'

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

    if (lastVideoTime === video.currentTime) return; // avoid duplicate inference
    lastVideoTime = video.currentTime;

    ctx.clearRect(0, 0, w, h);

    const result = poseLandmarker.detectForVideo(video, performance.now());
    const pose = result?.landmarks?.[0];

    if (pose) {
      // Draw landmarks and skeleton
      drawingUtils.drawLandmarks(pose, { lineWidth: 2, color: '#00FF88', radius: 3 });
      const connections = PoseLandmarker.POSE_CONNECTIONS || [];
      if (connections.length) {
        drawingUtils.drawConnectors(pose, connections, { color: '#00FF88', lineWidth: 2 });
      }

      const feedbacks = [];

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
        // Clean mode (very simple heuristics):
        const shoulder = pose[12], elbow = pose[14], wrist = pose[16];
        const hip = pose[24], knee = pose[26];
        if (shoulder && elbow && wrist && hip && knee) {
          const elbowDeg = Math.round(computeAngle(shoulder, elbow, wrist));
          const hipKneeDeg = Math.round(computeAngle(shoulder, hip, knee));

          // Phase transitions
          if (phase === 'Stand' && hipKneeDeg < 150) phase = 'Pull';
          if (phase === 'Pull' && elbowDeg < 60) { reps += 1; phase = 'Stand'; }

          if (elbowDeg >= 60) feedbacks.push('Drive elbows through');
          if (hipKneeDeg < 140) feedbacks.push('Extend hips/knees');

          drawAngleBadge(elbow, elbowDeg, w, h);
        }
      }

      // HUD update
      repsEl.textContent = String(reps);
      stateEl.textContent = phase;
      feedbackEl.textContent = feedbacks.join(' · ');
    }
  }
  frame();
}

function computeAngle(a, b, c) {
  // angle ABC in degrees
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

