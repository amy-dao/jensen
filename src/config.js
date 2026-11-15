// Every tunable value for Jensen Run lives here.
// Image paths are relative to index.html. Set an `image` to swap an emoji for a picture.

export const CONFIG = {
  // --- Level ---
  levelSeconds: 90,          // length of the map; survive this long to win
  travelSeconds: 1.8,        // time for an object to travel from the horizon to the player
  rowEvery: [1.4, 0.8],      // seconds between obstacle rows [at start, at end] (ramps linearly)
  seed: 20251115,            // RNG seed -> the map is identical every run
  firstRowAt: 0.6,           // seconds into the level before the first row spawns
  doubleObstacleChance: [0.15, 0.6], // chance a row has 2 obstacles [start, end]
  gpuRowChance: 0.55,        // chance a row gets a trail of 3 GPUs in a free lane
  gpuTrailSpacing: 0.18,     // seconds between GPUs in a trail

  // --- Player ---
  jumpSeconds: 0.75,         // length of a jump (arc = sin(pi * t))
  jumpSafeHeight: 0.35,      // jump height (0..1) needed to clear a low obstacle
  keyboardDuckSeconds: 0.7,  // how long a keyboard duck lasts
  laneEase: 14,              // how fast the player slides between lanes (higher = snappier)
  runCycle: 14,              // leg animation speed in rad/s

  // --- Art ---
  headImage: 'assets/jensen-head.png', // back of the head; placeholder is drawn if missing
  obstacles: {
    low:  { emoji: '🚧', image: null }, // jump over it
    high: { emoji: '🛸', image: null }, // duck under it
    wall: { emoji: '🧱', image: null }, // switch lanes
  },
  gpu: { image: null },      // null -> green "GPU" card

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
