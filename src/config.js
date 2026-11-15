// Every tunable value for Jensen Rush lives here.
// Image paths are relative to index.html. Set an `image` to swap an emoji for a picture.

export const CONFIG = {
  // --- Level ---
  levelSeconds: 20,          // length of the map; survive this long to win
  travelSeconds: 1.4,        // time for an object to travel from the horizon to the player
  rowEvery: [1.0, 0.6],      // seconds between obstacle rows [at start, at end] (ramps linearly)
  seed: 20251115,            // RNG seed -> the map is identical every run
  firstRowAt: 0.4,           // seconds into the level before the first row spawns
  doubleObstacleChance: [0.15, 0.6], // chance a row has 2 obstacles [start, end]
  gpuRowChance: 0.55,        // chance a row gets a trail of 3 GPUs in a free lane
  gpuTrailSpacing: 0.12,     // seconds between GPUs in a trail

  // Which moves exist. With both off, every obstacle blocks its lane and the only way
  // to avoid it is to switch lanes (jump/duck controls and hints are hidden).
  moves: { jump: false, duck: false },

  // --- Player ---
  jumpSeconds: 0.75,         // length of a jump (arc = sin(pi * t))
  jumpSafeHeight: 0.35,      // jump height (0..1) needed to clear a low obstacle
  keyboardDuckSeconds: 0.7,  // how long a keyboard duck lasts
  laneEase: 14,              // how fast the player slides between lanes (higher = snappier)
  runCycle: 14,              // leg animation speed in rad/s

  // --- Art ---
  // Running animation: frames are played in order and looped. They must share one canvas
  // size with the feet on the same line. If any frame fails to load, the stick figure is drawn.
  runFrames: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `assets/jensen-run-${i}.webp`),
  runFps: 15,                // animation speed of runFrames
  runFrameFeet: 0.912,       // where the feet are in the frame (0 = top, 1 = bottom)
  runFrameBody: 0.81,        // how much of the frame height the body (head to feet) takes up
  runFrameScale: 1.05,       // body height relative to the stick-figure player
  headImage: null,           // back of the head for the stick-figure fallback, e.g. 'assets/jensen-head.png'
  // Obstacle pictures: `image` is one path, or a list stacked top-to-bottom. null -> emoji.
  obstacles: {
    // low:  { emoji: '🚧', image: 'assets/distract-a.webp' }, // jump over it
    // high: { emoji: '🛸', image: 'assets/distract-b.webp' }, // duck under it
    // switch lanes. stack: true draws all images on top of each other; false picks one per obstacle
    wall: { emoji: '🧱', image: ['assets/distraction-1.png', 'assets/distraction-2.png'], stack: false },
  },
  gpu: { image: 'assets/gpu.webp', size: 0.46 }, // image: null -> green "GPU" card; size in lane widths

  // --- Background: NVIDIA HQ interior ---
  // Each photo is un-warped into a flat strip at load time, mapped onto a 3D plane
  // (ceiling / left wall / right wall) and mirror-tiled along the run so it loops seamlessly.
  // Photo geometry, in source pixels: vp = vanishing point, near/far = distance from the vp
  // (along x for walls, along y for the ceiling) of the slice of photo that is used,
  // a/b = slopes of the two edge rays leaving the vp (wall: top/bottom, ceiling: left/right).
  // If the images fail to load, the old night-sky backdrop is drawn instead.
  background: {
    wallLanes: [-1.1, 3.1],  // lateral position of the left / right wall, in lanes (road is -0.5..2.5)
    wallHeight: 2.3,         // ceiling height in lane widths
    period: { ceiling: 0.42, walls: 0.22, floor: 0.37 }, // length of one tile along the run, in z units (1 = horizon)
    fadeStart: 0.8,          // z where the planes start fading into the fog
    fadeEnd: 2.6,            // z where they are fully faded (nothing drawn past this)
    fog: [150, 160, 155],    // colour at the vanishing point (RGB)
    dim: 0.18,               // darken the backdrop so the road and obstacles stay readable
    ceiling: { src: 'assets/hq-ceiling.jpg', vp: [172, 335], near: 335, far: 120, a: -0.513, b: 0.487 },
    left:    { src: 'assets/hq-left.jpg',    vp: [295, 320], near: 295, far: 100, a: -1.085, b: 0.407 },
    right:   { src: 'assets/hq-right.jpg',   vp: [25, 305],  near: 260, far: 85,  a: -0.96,  b: 0.66 },
    // Carpet, wall to wall under the lanes (vp is above the photo: the camera looks down at it)
    floor:   { src: 'assets/hq-floor.jpg',   vp: [499, -73], near: 559, far: 243, a: -0.74,  b: 0.6 },
  },

  // --- Camera / pose tracking ---
  pose: {
    calibrationSeconds: 3,   // how long to stand still during calibration
    jumpRise: 0.35,          // jump when shoulders rise this many shoulder-widths above baseline
    duckDrop: 0.55,          // duck while nose drops this many shoulder-widths below baseline
    laneHysteresis: 0.03,    // extra distance past a lane line before switching
    smoothing: 0.5,          // EMA factor for the horizontal position (1 = no smoothing)
    minVisibility: 0.5,      // shoulders below this visibility = "can't see you"
    modelUrl: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
};
