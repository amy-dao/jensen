# Jensen Run

A 3-lane runner in the browser. Play it with the **keyboard**, or with **your whole body** through the webcam (MediaPipe pose tracking, all on-device).

It's a static site: plain HTML and vanilla JS ES modules drawing to one `<canvas>`. There's no backend and no build step.

## Run locally

```bash
npx serve .
```

Then open http://localhost:3000.

> Opening `index.html` straight from disk won't work. ES modules need an HTTP server, and the webcam only works on `localhost` or `https`.

## Controls

| Action | Keyboard | Camera |
| --- | --- | --- |
| Change lane | ← / A, → / D | Step left / right |
| Jump (🚧) | ↑ / W / Space | Jump |
| Duck (🛸) | ↓ / S (lasts 0.7 s) | Crouch (held) |
| Avoid wall (🧱) | Switch lanes | Switch lanes |

Run through the green **GPU** cards to collect them. Survive the full 90 s to reach the finish line. On the end screen, Enter or Space retries and Esc returns to the menu.

## Deploy to Vercel

Option A, CLI:

```bash
npx vercel          # first time: link/create the project, preview deploy
npx vercel --prod   # production deploy
```

When it asks for settings, choose framework preset **Other**, leave the **build command empty**, and keep the output directory as the project root (`.`).

Option B: push this folder to GitHub and use **Add New → Project** on vercel.com to import the repo, with the same settings (preset "Other", no build command).

Vercel serves over https, so camera mode works on the deployed site.

## Project layout

```
index.html        canvas, HUD, webcam preview, menu / calibration / countdown / end screens, CSS
src/config.js     every tunable value (level length, speeds, seed, pose thresholds, images…)
src/game.js       Game class: update loop, seeded map, collision, rendering
src/keyboard.js   KeyboardController
src/camera.js     CameraController (webcam + pose + calibration + preview overlay)
src/main.js       menu wiring, mode switching, countdown, end screen (onEnd)
assets/           images the game loads (WebP run frames, GPU, menu art, HQ photos)
assets-src/       full-size originals of the images (not deployed)
vendor/mediapipe/ @mediapipe/tasks-vision 0.10.14 (vision_bundle.mjs + wasm/)
```

Both controllers expose the same interface, `{ lane, start(), stop(), update(elapsed), consumeJump(), isDucking() }`, so the game doesn't know which one is driving it.

## Customising

- **Jensen's head**: put a back-of-head picture at `assets/jensen-head.png`, ideally a transparent PNG. Until it exists the game draws a placeholder and the browser console logs a harmless 404.
- **Background (NVIDIA HQ interior)**: `assets/hq-ceiling.jpg`, `hq-left.jpg` and `hq-right.jpg` are un-warped at load time and mapped onto a 3D ceiling and walls that scroll with the road, mirror-tiled so the hall loops without seams. To swap a photo, update its `vp` / `near` / `far` / `a` / `b` in `background` in `src/config.js`. If the photos fail to load, the old night-sky backdrop is drawn.
- **Image masters**: full-size originals live in `assets-src/`; the game loads the smaller `.webp` copies in `assets/`. `assets-src/` is listed in `.vercelignore`, so it isn't deployed.
- **Obstacle / GPU pictures**: set `image` in `src/config.js`, for example `obstacles.low.image = 'assets/cone.png'`.
- **Difficulty**: `levelSeconds`, `travelSeconds`, `rowEvery`, `doubleObstacleChance` and `seed` in `src/config.js`.
- **Camera sensitivity**: `pose.jumpRise` (lower makes jumping easier) and `pose.duckDrop` (lower makes ducking easier).

## Notes

- The MediaPipe library and its wasm are vendored, so they never come from a CDN. Only the pose model (`pose_landmarker_lite.task`, ~5 MB) is downloaded from Google's model storage, and only in camera mode.
- Keyboard mode never downloads MediaPipe, because it's loaded with a dynamic `import()`.
- No video ever leaves the browser.
