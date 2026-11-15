// Game: update loop, map generation, spawning, collision and rendering.
// It only talks to its controller through { lane, start, stop, update, consumeJump, isDucking },
// so keyboard and camera play are identical from the game's point of view.

const GREEN = '#76b900';
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const PERSPECTIVE = 7;   // s = 1 / (1 + z * PERSPECTIVE)

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Loads an optional image. `.img` stays null until (and unless) it loads.
function optionalImage(src) {
  const holder = { img: null };
  if (src) {
    const im = new Image();
    im.onload = () => { holder.img = im; };
    im.src = src;
  }
  return holder;
}

// ---------- HQ interior background ----------

// Un-warps the used slice of a perspective photo into a flat texture.
// kind: 'ceiling' (rows = depth, near at the top) or 'left' / 'right' (columns = depth, near first).
// Depth is linear in t: D = lerp(1/near, 1/far, t), and the photo distance from the vp is 1/D.
function rectify(img, spec, kind) {
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const sc = document.createElement('canvas');
  sc.width = sw; sc.height = sh;
  const sctx = sc.getContext('2d');
  sctx.drawImage(img, 0, 0);
  const src = sctx.getImageData(0, 0, sw, sh).data;

  const isCeiling = kind === 'ceiling';
  const tw = isCeiling ? 256 : 512;
  const th = isCeiling ? 512 : 256;
  const out = document.createElement('canvas');
  out.width = tw; out.height = th;
  const octx = out.getContext('2d');
  const dst = octx.createImageData(tw, th);
  const d = dst.data;
  const [vx, vy] = spec.vp;
  const D0 = 1 / spec.near, D1 = 1 / spec.far;

  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      const u = i / (tw - 1), v = j / (th - 1);
      let sx, sy;
      if (isCeiling) {
        const dist = 1 / lerp(D0, D1, v);              // rows = depth
        sy = vy - dist;
        sx = vx + dist * lerp(spec.a, spec.b, u);      // columns = left -> right
      } else {
        const dist = 1 / lerp(D0, D1, u);              // columns = depth
        sx = kind === 'left' ? vx - dist : vx + dist;
        sy = vy + dist * lerp(spec.a, spec.b, v);      // rows = top -> bottom
      }
      // Bilinear sample
      sx = clamp(sx, 0, sw - 1.001); sy = clamp(sy, 0, sh - 1.001);
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (j * tw + i) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
        const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
        d[o + c] = top + (bot - top) * fy;
      }
      d[o + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

// Loads and rectifies the three photos. Fields stay null until (and unless) they are ready.
function loadBackground(bg) {
  const holder = { ceiling: null, left: null, right: null };
  if (!bg) return holder;
  for (const kind of ['ceiling', 'left', 'right']) {
    const spec = bg[kind];
    if (!spec || !spec.src) continue;
    const im = new Image();
    im.onload = () => {
      try { holder[kind] = rectify(im, spec, kind); }
      catch (e) { console.warn('Background image could not be processed:', spec.src, e); }
    };
    im.src = spec.src;
  }
  return holder;
}

// Mirror-tiling: 0..1 forward, 1..2 backward, so neighbouring tiles always meet seamlessly.
function mirrorFrac(x) {
  const p = ((x % 2) + 2) % 2;
  return p > 1 ? 2 - p : p;
}

// Builds the whole level up front so it is identical every run.
export function buildMap(cfg) {
  const rng = mulberry32(cfg.seed);
  const objects = [];
  let id = 0;
  let t = cfg.firstRowAt;
  const lastSpawn = cfg.levelSeconds - cfg.travelSeconds - 0.3;

  while (t <= lastSpawn) {
    const p = t / cfg.levelSeconds;
    const arrive = t + cfg.travelSeconds;

    // Shuffle lanes, the first 1-2 get obstacles, the rest stay open.
    const lanes = [0, 1, 2];
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    const count = rng() < lerp(cfg.doubleObstacleChance[0], cfg.doubleObstacleChance[1], p) ? 2 : 1;
    const blocked = lanes.slice(0, count);
    const free = lanes.slice(count); // always at least one lane open

    for (const lane of blocked) {
      const r = rng();
      const type = r < 0.36 ? 'low' : r < 0.68 ? 'high' : 'wall';
      objects.push({ id: id++, kind: 'obstacle', type, lane, arrive });
    }

    // A trail of 3 GPUs leading into a free lane.
    if (rng() < cfg.gpuRowChance) {
      const lane = free[Math.floor(rng() * free.length)];
      for (let i = 0; i < 3; i++) {
        objects.push({ id: id++, kind: 'gpu', lane, arrive: arrive - (2 - i) * cfg.gpuTrailSpacing });
      }
    }

    t += lerp(cfg.rowEvery[0], cfg.rowEvery[1], p);
  }

  objects.sort((a, b) => a.arrive - b.arrive);
  return objects;
}

export class Game {
  constructor(canvas, config, { onEnd, hud } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cfg = config;
    this.onEnd = onEnd || (() => {});
    this.hud = hud || null;

    this.images = {
      head: optionalImage(config.headImage),
      low: optionalImage(config.obstacles.low.image),
      high: optionalImage(config.obstacles.high.image),
      wall: optionalImage(config.obstacles.wall.image),
      gpu: optionalImage(config.gpu.image),
      run: (config.runFrames || []).map(optionalImage),
    };
    this.bg = loadBackground(config.background);

    this.map = buildMap(config);
    this.totalGpus = this.map.filter((o) => o.kind === 'gpu').length;

    const srng = mulberry32(config.seed ^ 0x9e3779b9);
    this.stars = Array.from({ length: 140 }, () => ({
      x: srng(), y: srng(), r: 0.4 + srng() * 1.2, tw: srng() * Math.PI * 2,
    }));
    this.skyline = [];
    for (let x = -0.02; x < 1.02;) {
      const w = 0.015 + srng() * 0.04;
      this.skyline.push({ x, w, h: 0.015 + srng() * 0.07, seed: srng() });
      x += w + srng() * 0.01;
    }

    this.controller = null;
    this.state = 'idle'; // idle | countdown | playing | ended
    this.flash = 0;
    this.anim = 0;
    this.scroll = 0;
    this.reset();

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();

    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // ---------- lifecycle ----------

  setController(controller) {
    this.controller = controller;
  }

  reset() {
    this.time = 0;
    this.gpus = 0;
    this.objects = this.map.map((o) => ({ ...o, done: false, collected: false, hit: false }));
    this.nextIndex = 0;
    this.laneX = this.controller ? this.controller.lane : 1;
    this.jumpT = -1;
    this.duckAmt = 0;
    this.flash = 0;
    this.scroll = 0;
    this.popups = [];
    this.result = null;
  }

  /** Reset the level and freeze it (shown behind the countdown / calibration). */
  prepare() {
    this.reset();
    this.state = 'countdown';
  }

  play() {
    this.state = 'playing';
  }

  idle() {
    this.controller = null;
    this.reset();
    this.state = 'idle';
  }

  end(won) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    if (!won) this.flash = 1;
    this.result = { won, time: this.time, gpus: this.gpus, totalGpus: this.totalGpus };
    this.updateHud();
    this.onEnd(this.result);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render(0);
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    if (this.state === 'playing') {
      this.update(dt);
    } else if (this.state === 'countdown') {
      // Scene is frozen, but let the player line up (camera lane is live).
      if (this.controller) this.easeLane(dt);
    } else if (this.state === 'idle') {
      this.anim += dt;
      this.scroll += dt / this.cfg.travelSeconds;
    }

    this.render(dt);
  }

  // ---------- simulation ----------

  jumpHeight() {
    if (this.jumpT < 0) return 0;
    return Math.sin(Math.PI * clamp(this.jumpT / this.cfg.jumpSeconds, 0, 1));
  }

  easeLane(dt) {
    const target = this.controller ? this.controller.lane : 1;
    this.laneX += (target - this.laneX) * Math.min(1, dt * this.cfg.laneEase);
  }

  update(dt) {
    const c = this.controller;
    const cfg = this.cfg;
    c.update(dt);

    this.time += dt;
    this.anim += dt;
    this.scroll = this.time / cfg.travelSeconds;
    this.easeLane(dt);

    if (c.consumeJump() && this.jumpT < 0) this.jumpT = 0;
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      if (this.jumpT >= cfg.jumpSeconds) this.jumpT = -1;
    }
    const ducking = c.isDucking();
    this.duckAmt += ((ducking ? 1 : 0) - this.duckAmt) * Math.min(1, dt * 18);
    const jumpH = this.jumpHeight();

    // Collision / pickup: resolve every object that has reached the player (z <= 0).
    while (this.nextIndex < this.objects.length && this.objects[this.nextIndex].arrive <= this.time) {
      const o = this.objects[this.nextIndex++];
      o.done = true;
      if (o.lane !== c.lane) continue;

      if (o.kind === 'gpu') {
        o.collected = true;
        this.gpus++;
        this.popups.push({ t: 0, lane: o.lane });
        continue;
      }

      const safe =
        o.type === 'low' ? jumpH > cfg.jumpSafeHeight :
        o.type === 'high' ? ducking :
        false; // wall: never safe
      if (!safe) {
        o.hit = true;
        this.end(false);
        return;
      }
    }

    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < 0.7);

    if (this.time >= cfg.levelSeconds) {
      this.time = cfg.levelSeconds;
      this.end(true);
    }
  }

  updateHud() {
    const h = this.hud;
    if (!h) return;
    const left = Math.max(0, this.cfg.levelSeconds - this.time);
    const gpuText = String(this.gpus);
    if (h.gpu.textContent !== gpuText) h.gpu.textContent = gpuText;
    const timeText = Math.ceil(left) + 's';
    if (h.time.textContent !== timeText) h.time.textContent = timeText;
    h.bar.style.width = (100 * this.time / this.cfg.levelSeconds).toFixed(2) + '%';
  }

  // ---------- rendering ----------

  layout() {
    const { W, H } = this;
    const horizon = H * 0.36;
    const baseY = H * 0.88;
    const roadWidth = Math.min(W * 0.95, H * 1.25);
    const laneW = roadWidth / 3;
    const P = Math.min(H * 0.27, laneW * 0.95); // player height in px
    return { W, H, cx: W / 2, horizon, baseY, roadWidth, laneW, P };
  }

  project(L, lane, z) {
    const s = 1 / (1 + z * PERSPECTIVE);
    return {
      x: L.cx + (lane - 1) * L.laneW * s,
      y: L.horizon + (L.baseY - L.horizon) * s,
      s,
    };
  }

  render(dt) {
    if (!this.W) return;
    const ctx = this.ctx;
    const L = this.layout();

    const bg = this.bg;
    const interior = !!(bg.ceiling && bg.left && bg.right);
    if (interior) this.drawInterior(ctx, L);
    else this.drawSky(ctx, L);
    this.drawRoad(ctx, L, interior);
    this.drawFinish(ctx, L);

    // Anything nearer than the bottom edge of the screen is off-screen (and z < -1/7 would flip).
    const zMin = this.bottomZ(L) - 0.02;
    const visible = this.objects.filter((o) => {
      if (o.collected) return false;
      const z = (o.arrive - this.time) / this.cfg.travelSeconds;
      o.z = z;
      return z <= 1.05 && z >= zMin;
    });
    visible.sort((a, b) => b.z - a.z); // far -> near

    for (const o of visible) if (o.z > 0) this.drawObject(ctx, L, o);
    this.drawPlayer(ctx, L);
    for (const o of visible) if (o.z <= 0) this.drawObject(ctx, L, o);

    this.drawPopups(ctx, L);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,30,30,${0.5 * this.flash})`;
      ctx.fillRect(0, 0, L.W, L.H);
      this.flash = Math.max(0, this.flash - dt * 1.1);
    }

    if (this.state !== 'idle') this.updateHud();
  }

  drawSky(ctx, L) {
    const { W, H, horizon, cx } = L;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#010403');
    sky.addColorStop(0.6, '#04110a');
    sky.addColorStop(1, '#0d2a17');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon + 1);

    for (const s of this.stars) {
      const a = 0.35 + 0.35 * Math.sin(this.anim * 1.5 + s.tw);
      ctx.fillStyle = `rgba(220,255,220,${a})`;
      ctx.fillRect(s.x * W, s.y * horizon * 0.92, s.r, s.r);
    }

    const glow = ctx.createRadialGradient(cx, horizon, 0, cx, horizon, W * 0.6);
    glow.addColorStop(0, 'rgba(118,185,0,0.28)');
    glow.addColorStop(1, 'rgba(118,185,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, horizon);

    // Distant skyline
    for (const b of this.skyline) {
      const bh = b.h * H;
      ctx.fillStyle = '#030a06';
      ctx.fillRect(b.x * W, horizon - bh, b.w * W + 1, bh);
      ctx.fillStyle = 'rgba(118,185,0,0.35)';
      const cols = Math.max(1, Math.floor(b.w * W / 7));
      const rows = Math.max(1, Math.floor(bh / 8));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (((r * 7 + c * 13 + Math.floor(b.seed * 100)) % 5) === 0) {
          ctx.fillRect(b.x * W + 3 + c * 7, horizon - bh + 3 + r * 8, 2, 3);
        }
      }
    }

    const ground = ctx.createLinearGradient(0, horizon, 0, H);
    ground.addColorStop(0, '#081a0f');
    ground.addColorStop(1, '#040b07');
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, W, H - horizon);
  }

  // HQ interior: ceiling + two walls as 3D planes, drawn in thin screen-space slices.
  // Each slice samples one row/column of the rectified texture at the slice's world depth,
  // offset by this.scroll, so the hall moves exactly with the road and loops forever.
  drawInterior(ctx, L) {
    const bgc = this.cfg.background;
    const { W, H, cx, horizon, baseY, laneW } = L;
    const [fr, fg, fb] = bgc.fog;
    const groundH = baseY - horizon;                       // camera height in px at s = 1
    const wallH = Math.max(bgc.wallHeight * laneW, groundH * 1.6);
    const [wl, wr] = bgc.wallLanes;
    const zEnd = bgc.fadeEnd;
    const sEnd = 1 / (1 + zEnd * PERSPECTIVE);
    const fadeAlpha = (z) => 1 - clamp((z - bgc.fadeStart) / (zEnd - bgc.fadeStart), 0, 1);
    const zOf = (s) => (1 / s - 1) / PERSPECTIVE;

    // Fog backdrop, with a soft NVIDIA-green glow at the vanishing point
    ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(cx, horizon, 0, cx, horizon, W * 0.35);
    glow.addColorStop(0, 'rgba(190,255,120,0.55)');
    glow.addColorStop(1, 'rgba(118,185,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Floor between the walls (the road is drawn on top later)
    const ground = ctx.createLinearGradient(0, horizon, 0, H);
    ground.addColorStop(0, `rgb(${fr},${fg},${fb})`);
    ground.addColorStop(0.25, '#3a403d');
    ground.addColorStop(1, '#1c201e');
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, W, H - horizon);

    ctx.imageSmoothingEnabled = true;
    const STEP = 2; // slice thickness in screen px

    // Ceiling: y_ceil(s) = horizon + (groundH - wallH) * s, above the horizon.
    const ceil = this.bg.ceiling;
    const ck = groundH - wallH; // < 0
    const yEndC = horizon + ck * sEnd;
    const periodC = bgc.period.ceiling;
    for (let y = 0; y < yEndC; y += STEP) {
      const s = (y + STEP / 2 - horizon) / ck;
      if (s <= 0) continue;
      const z = zOf(s);
      ctx.globalAlpha = fadeAlpha(z);
      const row = mirrorFrac((z + this.scroll) / periodC) * (ceil.height - 1);
      const xl = cx + (wl - 1) * laneW * s;
      const xr = cx + (wr - 1) * laneW * s;
      ctx.drawImage(ceil, 0, row, ceil.width, 1, xl, y, xr - xl, STEP + 0.5);
    }

    // Walls: x(s) = cx + (lane - 1) * laneW * s, spanning floor -> ceiling.
    const periodW = bgc.period.walls;
    const drawWall = (tex, lane, x0, x1) => {
      const k = (lane - 1) * laneW;
      for (let x = x0; x < x1; x += STEP) {
        const s = (x + STEP / 2 - cx) / k;
        if (s <= 0) continue;
        const z = zOf(s);
        if (z > zEnd) continue;
        ctx.globalAlpha = fadeAlpha(z);
        const col = mirrorFrac((z + this.scroll) / periodW) * (tex.width - 1);
        const yb = horizon + groundH * s;
        const yt = yb - wallH * s;
        ctx.drawImage(tex, col, 0, 1, tex.height, x, yt, STEP + 0.5, yb - yt);
      }
    };
    drawWall(this.bg.left, wl, 0, cx + (wl - 1) * laneW * sEnd);
    const xStartR = Math.floor((cx + (wr - 1) * laneW * sEnd) / STEP) * STEP;
    drawWall(this.bg.right, wr, xStartR, W);
    ctx.globalAlpha = 1;

    if (bgc.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${bgc.dim})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // z at the bottom edge of the screen (negative = between player and viewer)
  bottomZ(L) {
    const s = (L.H - L.horizon) / (L.baseY - L.horizon);
    return (1 / s - 1) / PERSPECTIVE;
  }

  stripPath(ctx, L, laneA, laneB, zNear, zFar) {
    const a = this.project(L, laneA, zNear);
    const b = this.project(L, laneB, zNear);
    const c = this.project(L, laneB, zFar);
    const d = this.project(L, laneA, zFar);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  }

  drawRoad(ctx, L, interior = false) {
    const zb = this.bottomZ(L) - 0.01;
    const zFar = 1000; // ~ vanishing point

    const road = ctx.createLinearGradient(0, L.horizon, 0, L.H);
    road.addColorStop(0, '#0d1311');
    road.addColorStop(1, '#1b2321');
    ctx.fillStyle = road;
    this.stripPath(ctx, L, -0.5, 2.5, zb, zFar);
    ctx.fill();

    // Current lane highlight
    const hl = ctx.createLinearGradient(0, L.horizon, 0, L.H);
    hl.addColorStop(0, 'rgba(118,185,0,0)');
    hl.addColorStop(1, 'rgba(118,185,0,0.13)');
    ctx.fillStyle = hl;
    this.stripPath(ctx, L, this.laneX - 0.5, this.laneX + 0.5, zb, zFar);
    ctx.fill();

    // Road edges
    ctx.strokeStyle = GREEN;
    ctx.shadowColor = GREEN;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 3;
    for (const edge of [-0.5, 2.5]) {
      const a = this.project(L, edge, zb);
      const b = this.project(L, edge, zFar);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Scrolling lane dashes
    const period = 0.12;
    const dash = 0.055;
    const offset = this.scroll % period;
    ctx.fillStyle = 'rgba(210,230,210,0.55)';
    for (let z = -offset + Math.floor(zb / period) * period; z < 1.6; z += period) {
      const z0 = Math.max(z, zb);
      const z1 = z + dash;
      if (z1 <= z0) continue;
      for (const div of [0.5, 1.5]) {
        this.stripPath(ctx, L, div - 0.012, div + 0.012, z0, z1);
        ctx.fill();
      }
    }

    // Horizon fade so the road melts into the distance
    const fade = ctx.createLinearGradient(0, L.horizon, 0, L.horizon + (L.baseY - L.horizon) * 0.12);
    const fc = interior
      ? this.cfg.background.fog.map((c) => Math.round(c * (1 - this.cfg.background.dim))).join(',')
      : '8,26,15';
    fade.addColorStop(0, `rgba(${fc},1)`);
    fade.addColorStop(1, `rgba(${fc},0)`);
    ctx.fillStyle = fade;
    if (interior) {
      // Only fade the road itself; the walls fade on their own.
      this.stripPath(ctx, L, -0.5, 2.5, zb, zFar);
      ctx.fill();
    } else {
      ctx.fillRect(0, L.horizon, L.W, (L.baseY - L.horizon) * 0.12);
    }
  }

  drawFinish(ctx, L) {
    const z = (this.cfg.levelSeconds - this.time) / this.cfg.travelSeconds;
    if (z > 1.3 || z < this.bottomZ(L) - 0.05) return;
    const depth = 0.035;
    const n = 12;
    for (let i = 0; i < n; i++) {
      for (let r = 0; r < 2; r++) {
        ctx.fillStyle = (i + r) % 2 ? '#f2f2f2' : '#111';
        const la = -0.5 + (3 * i) / n;
        const lb = -0.5 + (3 * (i + 1)) / n;
        this.stripPath(ctx, L, la, lb, z + r * depth / 2, z + (r + 1) * depth / 2);
        ctx.fill();
      }
    }
    // Poles and banner
    const left = this.project(L, -0.65, z);
    const right = this.project(L, 2.65, z);
    const poleH = L.P * 1.5 * left.s;
    ctx.strokeStyle = '#cfd8d3';
    ctx.lineWidth = Math.max(1, 6 * left.s);
    ctx.beginPath();
    ctx.moveTo(left.x, left.y); ctx.lineTo(left.x, left.y - poleH);
    ctx.moveTo(right.x, right.y); ctx.lineTo(right.x, right.y - poleH);
    ctx.stroke();
    const bh = poleH * 0.22;
    ctx.fillStyle = GREEN;
    ctx.fillRect(left.x, left.y - poleH, right.x - left.x, bh);
    ctx.fillStyle = '#071107';
    ctx.font = `900 ${Math.max(6, bh * 0.7)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', (left.x + right.x) / 2, left.y - poleH + bh / 2);
  }

  drawShadow(ctx, x, y, rx, alpha = 0.55) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawEmoji(ctx, emoji, x, y, size) {
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, x, y);
  }

  drawObject(ctx, L, o) {
    const p = this.project(L, o.lane, o.z);
    const s = p.s;
    const alpha = clamp((1.05 - o.z) / 0.2, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;

    if (o.kind === 'gpu') {
      const w = L.laneW * 0.34 * s;
      const h = w * 0.62;
      const bob = Math.sin(this.anim * 5 + o.id) * L.P * 0.05 * s;
      const cy = p.y - L.P * 0.32 * s - bob;
      this.drawShadow(ctx, p.x, p.y, w * 0.45, 0.4);
      const img = this.images.gpu.img;
      if (img) {
        // keep the picture's own aspect ratio
        const iw = L.laneW * (this.cfg.gpu.size || 0.46) * s;
        const ih = iw * img.height / img.width;
        ctx.drawImage(img, p.x - iw / 2, cy - ih / 2, iw, ih);
      } else {
        ctx.shadowColor = GREEN;
        ctx.shadowBlur = 16 * s;
        ctx.fillStyle = GREEN;
        roundRect(ctx, p.x - w / 2, cy - h / 2, w, h, h * 0.18);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#c8f56a';
        ctx.lineWidth = Math.max(1, 2 * s);
        ctx.stroke();
        ctx.fillStyle = '#0a1400';
        ctx.font = `900 ${h * 0.5}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('GPU', p.x, cy + h * 0.03);
      }
      ctx.restore();
      return;
    }

    const def = this.cfg.obstacles[o.type];
    const img = this.images[o.type].img;

    if (o.type === 'low') {
      const size = L.laneW * 0.6 * s;
      this.drawShadow(ctx, p.x, p.y, size * 0.55);
      if (img) ctx.drawImage(img, p.x - size / 2, p.y - size, size, size);
      else this.drawEmoji(ctx, def.emoji, p.x, p.y - size * 0.48, size * 0.95);
    } else if (o.type === 'high') {
      const size = L.laneW * 0.55 * s;
      const cy = p.y - L.P * 0.92 * s + Math.sin(this.anim * 3 + o.id) * L.P * 0.02 * s;
      this.drawShadow(ctx, p.x, p.y, size * 0.5, 0.45);
      // faint tractor beam so it reads as "floating in this lane"
      const beam = ctx.createLinearGradient(0, cy, 0, p.y);
      beam.addColorStop(0, 'rgba(160,255,120,0.25)');
      beam.addColorStop(1, 'rgba(160,255,120,0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(p.x - size * 0.15, cy);
      ctx.lineTo(p.x + size * 0.15, cy);
      ctx.lineTo(p.x + size * 0.45, p.y);
      ctx.lineTo(p.x - size * 0.45, p.y);
      ctx.closePath();
      ctx.fill();
      if (img) ctx.drawImage(img, p.x - size / 2, cy - size / 2, size, size);
      else this.drawEmoji(ctx, def.emoji, p.x, cy, size * 0.95);
    } else {
      const w = L.laneW * 0.86 * s;
      const h = L.P * 1.2 * s;
      this.drawShadow(ctx, p.x, p.y, w * 0.55);
      if (img) {
        ctx.drawImage(img, p.x - w / 2, p.y - h, w, h);
      } else {
        const cols = 2, rows = 3;
        const cw = w / cols, rh = h / rows;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          this.drawEmoji(ctx, def.emoji, p.x - w / 2 + cw * (c + 0.5), p.y - h + rh * (r + 0.5), Math.min(cw, rh) * 1.15);
        }
      }
    }

    if (o.hit) {
      ctx.strokeStyle = '#ff3b3b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y - L.P * 0.5 * s, L.laneW * 0.4 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPopups(ctx, L) {
    for (const pop of this.popups) {
      const p = this.project(L, this.laneX, 0);
      ctx.globalAlpha = 1 - pop.t / 0.7;
      ctx.fillStyle = GREEN;
      ctx.font = `900 ${L.P * 0.16}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+1 GPU', p.x, p.y - L.P * (1.15 + pop.t * 0.6));
      ctx.globalAlpha = 1;
    }
  }

  drawPlayer(ctx, L) {
    const P = L.P;
    const p = this.project(L, this.laneX, 0);
    const jumpH = this.jumpHeight();
    const feetY = L.baseY - jumpH * P * 0.55;
    const running = this.state === 'playing' || this.state === 'idle';
    const phase = running ? this.anim * this.cfg.runCycle : 0;

    this.drawShadow(ctx, p.x, L.baseY, P * 0.2 * (1 - 0.45 * jumpH), 0.6 - 0.3 * jumpH);

    const d = this.duckAmt;

    // Sprite animation (config.runFrames) once every frame has loaded.
    const frames = this.images.run;
    if (frames.length && frames.every((f) => f.img)) {
      const cfg = this.cfg;
      let i = 0;                                                    // standing pose
      if (this.jumpT >= 0) i = Math.min(3, frames.length - 1);      // mid-stride while airborne
      else if (running) i = Math.floor(this.anim * cfg.runFps) % frames.length;
      const img = frames[i].img;
      const k = (P * cfg.runFrameScale) / (img.height * cfg.runFrameBody); // px per source px
      const w = img.width * k, h = img.height * k;
      ctx.save();
      ctx.translate(p.x, feetY);
      ctx.scale(1 + 0.12 * d, 1 - 0.4 * d);                        // duck squash
      ctx.drawImage(img, -w / 2, -h * cfg.runFrameFeet, w, h);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(p.x, feetY);
    ctx.scale(P * (1 + 0.12 * d), P * (1 - 0.4 * d));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // --- stick-figure legs (seen from behind) ---
    const hipY = -0.42;
    for (const side of [-1, 1]) {
      let lift = Math.max(0, Math.sin(phase + (side > 0 ? Math.PI : 0))) * 0.13;
      if (this.jumpT >= 0) lift = 0.09;
      const footX = side * 0.085;
      const footY = -lift;
      const kneeX = side * (0.1 + lift * 0.15);
      const kneeY = -0.21 - lift * 0.45;
      ctx.strokeStyle = '#e9efe9';
      ctx.lineWidth = 0.036;
      ctx.beginPath();
      ctx.moveTo(side * 0.065, hipY);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(footX, footY - 0.02);
      ctx.stroke();
      // shoe (sole faces us when the foot lifts)
      ctx.fillStyle = '#121212';
      ctx.strokeStyle = '#e9efe9';
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.ellipse(footX, footY - 0.012, 0.042, 0.024 + lift * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // --- arms (behind the torso edges, swinging opposite to legs) ---
    for (const side of [-1, 1]) {
      const swing = Math.sin(phase + (side > 0 ? 0 : Math.PI)) * (running ? 1 : 0);
      const sx = side * 0.2, sy = -0.73;
      const hx = side * (0.27 + 0.02 * swing), hy = -0.43 - 0.08 * swing;
      const ex = side * 0.29, ey = (sy + hy) / 2;
      ctx.strokeStyle = '#2b2f2e';
      ctx.lineWidth = 0.088;
      ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = 0.07;
      ctx.stroke();
      ctx.fillStyle = '#d6a47c';
      ctx.beginPath();
      ctx.arc(hx, hy + 0.035, 0.03, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- black leather jacket torso ---
    ctx.beginPath();
    ctx.moveTo(-0.16, -0.39);
    ctx.lineTo(0.16, -0.39);
    ctx.lineTo(0.2, -0.7);
    ctx.quadraticCurveTo(0.2, -0.78, 0.12, -0.79);
    ctx.lineTo(-0.12, -0.79);
    ctx.quadraticCurveTo(-0.2, -0.78, -0.2, -0.7);
    ctx.closePath();
    const jacket = ctx.createLinearGradient(-0.2, 0, 0.2, 0);
    jacket.addColorStop(0, '#050505');
    jacket.addColorStop(0.3, '#262a29');
    jacket.addColorStop(0.45, '#3a3f3d');
    jacket.addColorStop(0.6, '#161817');
    jacket.addColorStop(1, '#040404');
    ctx.fillStyle = jacket;
    ctx.fill();
    ctx.strokeStyle = '#5b625f';
    ctx.lineWidth = 0.008;
    ctx.stroke();
    // seams, yoke and hem
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.006;
    ctx.beginPath();
    ctx.moveTo(-0.18, -0.67); ctx.quadraticCurveTo(0, -0.63, 0.18, -0.67);
    ctx.moveTo(0, -0.63); ctx.lineTo(0, -0.42);
    ctx.stroke();
    ctx.fillStyle = '#0d0e0e';
    ctx.fillRect(-0.16, -0.43, 0.32, 0.04);
    // collar
    ctx.fillStyle = '#1a1c1b';
    ctx.beginPath();
    ctx.moveTo(-0.08, -0.79); ctx.lineTo(0.08, -0.79); ctx.lineTo(0.06, -0.755); ctx.lineTo(-0.06, -0.755);
    ctx.closePath();
    ctx.fill();

    // --- neck + head ---
    ctx.fillStyle = '#c8956d';
    ctx.fillRect(-0.045, -0.83, 0.09, 0.05);

    const head = this.images.head.img;
    if (head) {
      const w = 0.3;
      const h = w * head.height / head.width;
      ctx.drawImage(head, -w / 2, -0.79 - h, w, h);
    } else {
      // placeholder back-of-head: ears + grey hair
      ctx.fillStyle = '#d29f78';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * 0.112, -0.9, 0.028, 0.045, side * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      const hair = ctx.createRadialGradient(-0.03, -0.96, 0.01, 0, -0.9, 0.15);
      hair.addColorStop(0, '#c9cbcb');
      hair.addColorStop(0.6, '#8d9191');
      hair.addColorStop(1, '#5d6161');
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.ellipse(0, -0.91, 0.112, 0.128, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,64,64,0.6)';
      ctx.lineWidth = 0.006;
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) {
        ctx.moveTo(i * 0.03, -1.02);
        ctx.quadraticCurveTo(i * 0.045, -0.92, i * 0.04, -0.8);
      }
      ctx.stroke();
    }

    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
