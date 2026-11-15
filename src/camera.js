// CameraController: webcam + MediaPipe pose + calibration + preview overlay.
// Same interface as KeyboardController:
//   { lane, start(), stop(), update(elapsed), consumeJump(), isDucking() }
// Extra methods used by main.js: init(), calibrate(), cancelCalibration(), release().

// Same Comic Sans stack as --comic in index.html (canvas can't read CSS variables).
const COMIC = '"Comic Sans MS", "Comic Sans", "Comic Neue", "Chalkboard SE", "Chalkboard", cursive';

const NOSE = 0, L_SHOULDER = 11, R_SHOULDER = 12, L_HIP = 23, R_HIP = 24;

export class CameraError extends Error {}

function friendlyCameraError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Click the camera icon in the address bar, allow access, then try again — or play with the keyboard.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No webcam was found. Plug one in and try again — or play with the keyboard.';
  }
  if (name === 'NotReadableError') {
    return 'The webcam is busy in another app (Zoom, Meet, FaceTime…). Close it and try again.';
  }
  return 'Could not start the camera: ' + (err && err.message ? err.message : String(err));
}

export class CameraController {
  /**
   * @param config  CONFIG
   * @param els     { wrap, video, overlay } DOM elements of the preview box
   */
  constructor(config, els) {
    this.cfg = config;
    this.pcfg = config.pose;
    this.els = els;
    this.ctx = els.overlay.getContext('2d');

    this.lane = 1;
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.active = false;       // true while a level is being played
    this.lastVideoTime = -1;

    this.baseline = null;      // { shoulderY, noseY, width }
    this.smoothX = null;
    this.visible = false;
    this.pose = null;          // latest landmarks
    this.jumpRaw = false;      // above jump threshold right now
    this.duckRaw = false;      // below duck threshold right now
    this.jumpQueued = false;
    this.jumpLabelUntil = 0;
    this.calib = null;

    this._loop = this._loop.bind(this);
  }

  // ---------- controller interface ----------

  start() {
    this.active = true;
    this.jumpQueued = false;
  }

  stop() {
    this.active = false;
    this.jumpQueued = false;
  }

  update(_elapsed) {
    // Pose detection runs in its own rAF loop (it must also run during calibration).
  }

  consumeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  isDucking() {
    return this.duckRaw;
  }

  // ---------- setup / teardown ----------

  get ready() {
    return !!(this.stream && this.landmarker);
  }

  async init(onStatus = () => {}) {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new CameraError('The camera only works over https or on localhost. Run `npx serve .` and open http://localhost:3000.');
    }

    if (!this.stream) {
      onStatus('Asking for camera access…');
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
      } catch (err) {
        throw new CameraError(friendlyCameraError(err));
      }
      const video = this.els.video;
      video.srcObject = this.stream;
      video.muted = true;
      video.playsInline = true;
      await new Promise((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.addEventListener('loadedmetadata', resolve, { once: true });
      });
      await video.play().catch(() => {});
      // Match the preview box to the real video aspect so the overlay lines up.
      if (video.videoWidth && video.videoHeight) {
        this.els.wrap.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      }
      this.lastVideoTime = -1;
    }

    if (!this.landmarker) {
      onStatus('Loading the pose model…');
      try {
        this.landmarker = await this._createLandmarker();
      } catch (err) {
        throw new CameraError('Could not load the pose model: ' + (err && err.message ? err.message : err));
      }
    }

    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this._loop);
    }
    onStatus('Camera ready');
  }

  async _createLandmarker() {
    const { PoseLandmarker, FilesetResolver } = await import('../vendor/mediapipe/vision_bundle.mjs');
    const wasmUrl = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
    const vision = await FilesetResolver.forVisionTasks(wasmUrl);
    const make = (delegate) => PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: this.pcfg.modelUrl, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    try {
      return await make('GPU');
    } catch (err) {
      console.warn('PoseLandmarker GPU delegate failed, falling back to CPU', err);
      return await make('CPU');
    }
  }

  /** Stop the webcam (model stays loaded for next time). */
  release() {
    this.cancelCalibration();
    this.running = false;
    this.active = false;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.els.video.srcObject = null;
    this.pose = null;
    this.visible = false;
    this.smoothX = null;
    this.duckRaw = this.jumpRaw = false;
    this.lane = 1;
    this.ctx.clearRect(0, 0, this.els.overlay.width, this.els.overlay.height);
  }

  // ---------- calibration ----------

  /**
   * Stand in the middle lane and stay still for calibrationSeconds.
   * onTick({ seeing, remaining }) is called every processed frame.
   * Resolves when done; rejects with 'cancelled' if cancelCalibration() is called.
   */
  calibrate(onTick = () => {}) {
    this.cancelCalibration();
    return new Promise((resolve, reject) => {
      this.calib = { onTick, resolve, reject, samples: [], startedAt: null };
    });
  }

  cancelCalibration() {
    if (this.calib) {
      const { reject } = this.calib;
      this.calib = null;
      reject(new Error('cancelled'));
    }
  }

  _calibStep(now, lm) {
    const c = this.calib;
    if (!this.visible) {
      c.samples = [];
      c.startedAt = null;
      c.onTick({ seeing: false, remaining: this.pcfg.calibrationSeconds });
      return;
    }
    if (c.startedAt === null) c.startedAt = now;
    const L = lm[L_SHOULDER], R = lm[R_SHOULDER];
    c.samples.push({
      shoulderY: (L.y + R.y) / 2,
      noseY: lm[NOSE].y,
      width: Math.abs(L.x - R.x),
    });
    const elapsed = (now - c.startedAt) / 1000;
    const remaining = Math.max(0, this.pcfg.calibrationSeconds - elapsed);
    c.onTick({ seeing: true, remaining });
    if (remaining <= 0 && c.samples.length >= 5) {
      const avg = (k) => c.samples.reduce((s, x) => s + x[k], 0) / c.samples.length;
      this.baseline = { shoulderY: avg('shoulderY'), noseY: avg('noseY'), width: Math.max(0.02, avg('width')) };
      this.calib = null;
      this.jumpRaw = this.duckRaw = false;
      c.resolve(this.baseline);
    }
  }

  // ---------- tracking loop ----------

  _loop() {
    if (!this.running) return;
    const video = this.els.video;
    if (this.landmarker && video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      const now = performance.now();
      let result = null;
      try {
        result = this.landmarker.detectForVideo(video, now);
      } catch (err) {
        console.warn('detectForVideo failed', err);
      }
      this._process(now, result && result.landmarks && result.landmarks[0]);
    }
    this._draw();
    requestAnimationFrame(this._loop);
  }

  _process(now, lm) {
    const p = this.pcfg;
    this.pose = lm || null;
    const vis = (pt) => (pt && pt.visibility !== undefined ? pt.visibility : 1);
    this.visible = !!lm && Math.min(vis(lm[L_SHOULDER]), vis(lm[R_SHOULDER])) >= p.minVisibility;

    if (this.calib) this._calibStep(now, lm);

    if (!this.visible) {
      this.duckRaw = false;
      this.jumpRaw = false;
      return;
    }

    const L = lm[L_SHOULDER], R = lm[R_SHOULDER];

    // Lane: mirrored shoulder midpoint, smoothed, split in thirds with hysteresis.
    const rawX = 1 - (L.x + R.x) / 2;
    this.smoothX = this.smoothX === null ? rawX : p.smoothing * rawX + (1 - p.smoothing) * this.smoothX;
    const x = this.smoothX;
    const h = p.laneHysteresis;
    const cur = this.lane;
    if (x < cur / 3 - h || x > (cur + 1) / 3 + h) {
      this.lane = Math.max(0, Math.min(2, Math.floor(x * 3)));
    }

    // Jump / duck need a baseline (not during calibration itself).
    const b = this.baseline;
    if (!b || this.calib) return;
    const shoulderY = (L.y + R.y) / 2;
    const moves = this.cfg.moves;
    const jumpNow = moves.jump && b.shoulderY - shoulderY > p.jumpRise * b.width;
    if (jumpNow && !this.jumpRaw) {
      if (this.active) this.jumpQueued = true;
      this.jumpLabelUntil = now + 500;
    }
    this.jumpRaw = jumpNow;
    this.duckRaw = moves.duck && lm[NOSE].y - b.noseY > p.duckDrop * b.width;
  }

  // ---------- preview overlay ----------

  _draw() {
    const cv = this.els.overlay;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Lanes
    ctx.fillStyle = 'rgba(118,185,0,0.22)';
    ctx.fillRect((this.lane * w) / 3, 0, w / 3, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 3, 0); ctx.lineTo(w / 3, h);
    ctx.moveTo((2 * w) / 3, 0); ctx.lineTo((2 * w) / 3, h);
    ctx.stroke();

    // Thresholds
    const b = this.baseline;
    if (b) {
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      if (this.cfg.moves.jump) {
        ctx.strokeStyle = '#3fa9ff';
        const jy = (b.shoulderY - this.pcfg.jumpRise * b.width) * h;
        ctx.beginPath(); ctx.moveTo(0, jy); ctx.lineTo(w, jy); ctx.stroke();
      }
      if (this.cfg.moves.duck) {
        ctx.strokeStyle = '#ff9b2f';
        const dy = (b.noseY + this.pcfg.duckDrop * b.width) * h;
        ctx.beginPath(); ctx.moveTo(0, dy); ctx.lineTo(w, dy); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Landmarks (mirrored to match the CSS-mirrored video)
    const lm = this.pose;
    if (lm) {
      const pt = (i) => ({ x: (1 - lm[i].x) * w, y: lm[i].y * h });
      const ls = pt(L_SHOULDER), rs = pt(R_SHOULDER), lh = pt(L_HIP), rh = pt(R_HIP);
      ctx.strokeStyle = 'rgba(118,185,0,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ls.x, ls.y); ctx.lineTo(rs.x, rs.y); ctx.lineTo(rh.x, rh.y); ctx.lineTo(lh.x, lh.y); ctx.closePath();
      ctx.stroke();
      for (const [i, color] of [[NOSE, '#ff9b2f'], [L_SHOULDER, '#3fa9ff'], [R_SHOULDER, '#3fa9ff'], [L_HIP, '#76b900'], [R_HIP, '#76b900']]) {
        const q = pt(i);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // JUMP / DUCK label
    let label = null, color = null;
    if (this.duckRaw) { label = 'DUCK'; color = '#ff9b2f'; }
    else if (this.jumpRaw || performance.now() < this.jumpLabelUntil) { label = 'JUMP'; color = '#3fa9ff'; }
    if (label) {
      ctx.font = `700 28px ${COMIC}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText(label, w / 2, 8);
      ctx.fillStyle = color;
      ctx.fillText(label, w / 2, 8);
    }

    // Status bar
    let status;
    if (!this.landmarker) status = 'Loading pose model…';
    else if (!this.visible) status = "Can't see you — step back";
    else if (this.calib) status = 'Calibrating — stay still';
    else status = `Tracking ✓  lane ${['left', 'middle', 'right'][this.lane]}`;
    const bad = this.landmarker && !this.visible;
    ctx.fillStyle = bad ? 'rgba(170,20,20,0.85)' : 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, h - 24, w, 24);
    ctx.fillStyle = '#fff';
    ctx.font = `700 13px ${COMIC}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(status, w / 2, h - 12);
  }
}
