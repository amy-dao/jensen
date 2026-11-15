// Menu wiring, mode switching, calibration, countdown and the end screen.

import { CONFIG } from './config.js';
import { Game } from './game.js';
import { KeyboardController } from './keyboard.js';
import { CameraController, CameraError } from './camera.js';

const $ = (id) => document.getElementById(id);

const els = {
  hud: $('hud'),
  keyhint: $('keyhint'),
  cam: $('cam'),
  screens: { menu: $('menu'), calib: $('calib'), countdown: $('countdown'), end: $('end') },
  calibMsg: $('calib-msg'),
  calibCount: $('calib-count'),
  calibStatus: $('calib-status'),
  countdownNum: $('countdown-num'),
  endTitle: $('end-title'),
  endTime: $('end-time'),
  endGpus: $('end-gpus'),
  btnRecal: $('btn-recal'),
};

const game = new Game($('game'), CONFIG, {
  onEnd,
  hud: { gpu: $('hud-gpu'), time: $('hud-time'), bar: $('progress-fill') },
});

const keyboard = new KeyboardController(CONFIG);
let camera = null; // created lazily so keyboard mode never touches MediaPipe
let controller = null;
let mode = null; // 'keyboard' | 'camera'
let session = 0; // bumps whenever a flow is abandoned, so stale async steps bail out
let countdownTimer = null;

function show(name) {
  for (const [key, el] of Object.entries(els.screens)) el.classList.toggle('hidden', key !== name);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

// ---------- modes ----------

function startKeyboard() {
  session++;
  mode = 'keyboard';
  controller = keyboard;
  game.setController(controller);
  els.cam.classList.add('hidden');
  els.keyhint.classList.remove('hidden');
  els.hud.classList.remove('hidden');
  els.btnRecal.classList.add('hidden');
  countdown();
}

async function startCamera() {
  const my = ++session;
  mode = 'camera';
  els.keyhint.classList.add('hidden');
  els.hud.classList.remove('hidden');
  els.btnRecal.classList.remove('hidden');
  els.cam.classList.remove('hidden');
  game.prepare();
  show('calib');
  els.calibMsg.innerHTML = 'Getting the camera ready…';
  els.calibCount.textContent = '';
  els.calibStatus.className = 'small';

  if (!camera) camera = new CameraController(CONFIG, { wrap: els.cam, video: $('cam-video'), overlay: $('cam-overlay') });
  try {
    await camera.init((msg) => { if (my === session) els.calibStatus.textContent = msg; });
  } catch (err) {
    if (my !== session) return;
    console.error(err);
    camera.release();
    els.cam.classList.add('hidden');
    els.calibMsg.textContent = 'Camera mode could not start.';
    els.calibStatus.textContent = err instanceof CameraError ? err.message : String(err);
    els.calibStatus.className = 'error';
    return;
  }
  if (my !== session) return;

  controller = camera;
  game.setController(controller);
  if (await calibrate(my)) countdown();
}

/** Runs camera calibration. Returns false if the flow was abandoned. */
async function calibrate(my) {
  game.prepare();
  show('calib');
  els.calibMsg.innerHTML = 'Stand in the <b>MIDDLE</b> lane, ~2&nbsp;m back, stay still.';
  els.calibStatus.className = 'small';
  els.calibStatus.textContent = '';
  try {
    await camera.calibrate(({ seeing, remaining }) => {
      els.calibCount.textContent = seeing ? Math.ceil(remaining) : '';
      els.calibStatus.textContent = seeing ? 'Hold still…' : "Can't see you — step back so your shoulders are in view";
    });
  } catch {
    return false;
  }
  return my === session;
}

// ---------- countdown & play ----------

function countdown() {
  const my = ++session;
  clearTimeout(countdownTimer);
  controller.stop();
  game.prepare();
  show('countdown');
  let n = 3;
  const tick = () => {
    if (my !== session) return;
    if (n === 0) {
      show(null);
      controller.start();
      game.play();
      return;
    }
    els.countdownNum.textContent = n;
    // restart the CSS pop animation
    els.countdownNum.style.animation = 'none';
    void els.countdownNum.offsetWidth;
    els.countdownNum.style.animation = '';
    n--;
    countdownTimer = setTimeout(tick, 1000);
  };
  tick();
}

/**
 * Single place that decides what happens when a level ends.
 * result = { won, time, gpus, totalGpus }
 * (Failing currently just shows the end screen — we'll decide later what it should do.)
 */
function onEnd(result) {
  controller.stop();
  const endEl = els.screens.end;
  endEl.classList.toggle('failed', !result.won);
  els.endTitle.textContent = result.won ? 'Level complete! 🏁' : 'Level failed 💥';
  els.endTime.textContent = result.time.toFixed(1) + 's';
  els.endGpus.textContent = result.gpus;
  els.btnRecal.classList.toggle('hidden', mode !== 'camera');
  show('end');
}

function retry() {
  if (!controller) return;
  countdown();
}

async function recalibrate() {
  if (mode !== 'camera' || !camera) return;
  const my = ++session;
  if (await calibrate(my)) countdown();
}

function toMenu() {
  session++;
  clearTimeout(countdownTimer);
  if (controller) controller.stop();
  if (camera) camera.release(); // stop webcam tracks; the model stays loaded
  controller = null;
  mode = null;
  game.idle();
  els.hud.classList.add('hidden');
  els.keyhint.classList.add('hidden');
  els.cam.classList.add('hidden');
  show('menu');
}

// ---------- wiring ----------

function play() {
  const picked = document.querySelector('input[name="mode"]:checked');
  const picker = $('mode-picker');
  if (!picked) {
    $('mode-hint').textContent = 'pick a mode first!';
    picker.classList.remove('shake');
    void picker.offsetWidth; // restart the animation
    picker.classList.add('shake');
    return;
  }
  $('mode-hint').textContent = '';
  if (picked.value === 'camera') startCamera();
  else startKeyboard();
}

$('btn-play').addEventListener('click', play);
for (const r of document.querySelectorAll('input[name="mode"]')) {
  r.addEventListener('change', () => { $('mode-hint').textContent = ''; });
}
$('btn-calib-back').addEventListener('click', toMenu);
$('btn-retry').addEventListener('click', retry);
$('btn-recal').addEventListener('click', recalibrate);
$('btn-menu').addEventListener('click', toMenu);

window.addEventListener('keydown', (e) => {
  if (!els.screens.end.classList.contains('hidden') && (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter')) {
    e.preventDefault();
    if (!e.repeat) retry();
  } else if (!els.screens.menu.classList.contains('hidden') && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
    e.preventDefault();
    if (!e.repeat) play();
  } else if (e.code === 'Escape' && els.screens.menu.classList.contains('hidden')) {
    e.preventDefault();
    toMenu();
  }
});

// Handy for debugging / automated tests.
window.jensen = { game, keyboard, get camera() { return camera; }, get mode() { return mode; } };
