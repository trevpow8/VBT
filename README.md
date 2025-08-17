# VBT
https://vbt-trevpow8s-projects.vercel.app/
A lightweight, in-browser velocity-based training (VBT) prototype for Olympic lifts and squats using real-time pose estimation. Runs entirely client-side in the browser using MediaPipe Tasks (no backend).

## What we're trying to do
- Provide instant, actionable feedback for bar speed and rep quality during lifts, starting with hang cleans and squats.
- Track reps reliably with a simple, explainable state machine and avoid double counting.
- Surface velocity (m/s) during the explosive phase, with clear success/fail cues for thresholds.

## What’s implemented now
- Real-time webcam pose tracking via MediaPipe Tasks Vision.
- Exercise modes: Clean and Squat.
- Rep detection with a small finite-state machine and cooldown to prevent rapid double counts.
- Hang clean velocity tracking:
  - Per-frame upward wrist velocity with EMA smoothing.
  - Per-rep peak velocity capture and HUD display.
  - Green/red flash at rep completion based on threshold (default 1.2 m/s).
- Basic feedback cues (e.g., elbows through, extend hips/knees) and angle badge overlays.
- Controls: mode toggle, switch camera, mirror, reset rep count.
- HUD for reps, state, feedback, and velocity metrics.

## How velocity is computed (current approach)
- Uses wrist vertical motion in pixels per second, smoothed via an exponential moving average.
- Converts to meters per second using a rough meters-per-pixel estimate from total detected pose height and an assumed body height (1.70 m). This can be improved by letting the user input their height for calibration.

## Getting started (local dev)
1. Serve the `web/` folder over HTTP(S) so the browser will grant camera access.
   - Python: `cd web && python3 -m http.server 5173`
   - Node: `cd web && npx serve -l 5173`
2. Open `http://localhost:5173` in a modern browser (Chrome, Edge, Safari).
3. Allow camera access when prompted.
4. Use the controls at the bottom: select mode (Clean/Squat), switch camera, mirror, and reset reps.

## Controls and HUD
- Clean/Squat: choose detection mode.
- Switch Camera: toggle front/back camera.
- Mirror: flip preview when using the front camera.
- Reset Count: zero the rep counter and reset state/velocity.
- HUD: shows reps, current state (e.g., Stand/Pull/Rack), feedback messages, and velocity (current and peak m/s). The screen briefly flashes green/red at rep completion depending on the velocity threshold.

## Roadmap / next steps
- Hang-clean specific gating (brief isometric at mid-thigh) to further reduce false positives.
- Power clean from the floor with a distinct state machine and ground contact detection.
- Calibration: user-entered height or one-time reference pose to improve m/s accuracy.
- Configurable velocity thresholds and unit selection.
- Set/rep logging, simple analytics, and CSV/JSON export.
- PWA packaging for offline use on mobile.
- Optional barbell-centric keypoint tracking for improved bar path and speed.

## Tech stack
- Vanilla JavaScript, HTML, CSS.
- MediaPipe Tasks Vision (PoseLandmarker), Canvas 2D overlays.
- No build step required; modules loaded via CDN.

## Repo layout
```
VBT/
  web/
    index.html   # UI and controls
    app.js       # Pose, rep logic, velocity, HUD
    styles.css   # Styling for controls and HUD
```

## License
MIT
