// KeyboardController: ←/A →/D change lane, ↑/W/Space jump, ↓/S duck.
// Same interface as CameraController:
//   { lane, start(), stop(), update(elapsed), consumeJump(), isDucking() }

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const JUMP = new Set(['ArrowUp', 'KeyW', 'Space']);
const DUCK = new Set(['ArrowDown', 'KeyS']);

export class KeyboardController {
  constructor(config) {
    this.config = config;
    this.lane = 1;
    this.jumpQueued = false;
    this.duckTimer = 0;
    this.active = false;
    this._onKey = this._onKey.bind(this);
  }

  start() {
    this.lane = 1;
    this.jumpQueued = false;
    this.duckTimer = 0;
    if (!this.active) window.addEventListener('keydown', this._onKey);
    this.active = true;
  }

  stop() {
    window.removeEventListener('keydown', this._onKey);
    this.active = false;
    this.lane = 1;
    this.jumpQueued = false;
    this.duckTimer = 0;
  }

  update(elapsed) {
    this.duckTimer = Math.max(0, this.duckTimer - elapsed);
  }

  consumeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  isDucking() {
    return this.duckTimer > 0;
  }

  _onKey(e) {
    const code = e.code;
    if (LEFT.has(code)) {
      if (!e.repeat) this.lane = Math.max(0, this.lane - 1);
    } else if (RIGHT.has(code)) {
      if (!e.repeat) this.lane = Math.min(2, this.lane + 1);
    } else if (JUMP.has(code)) {
      if (!e.repeat) this.jumpQueued = true;
    } else if (DUCK.has(code)) {
      this.duckTimer = this.config.keyboardDuckSeconds;
    } else {
      return;
    }
    e.preventDefault();
  }
}
