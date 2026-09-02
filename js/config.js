// AuruMask configuration.
// MODEL_PATH is the single swap point for the final tiger asset (see ASSET_CONTRACT.md).
// Set it to a .glb path (e.g. "/assets/tiger.glb"). When null, the procedural
// placeholder tiger is built in code and wired to the same blendshape contract.
export const MODEL_PATH = null;

// Adjustments applied to DOWNLOADED models (the auto-fit path — static .glb
// files without the contract rig). Tweak these if a model loads facing the
// wrong way, too big/small, or off-center. Ignored for contract assets.
export const MODEL_ADJUST = {
  rotateYDeg: 0, // 180 if the model faces away from you, ±90 if sideways
  scale: 1.0, // multiplier on the auto-fitted size
  offset: [0, 0, 0], // cm nudge [x right, y up, z toward camera]
};

// Path to the persona mapping file, tweakable without touching code.
export const MAPPING_PATH = "./mapping.json";

// MediaPipe FaceLandmarker runtime — vendored in-repo, so the app makes no
// external network requests at all: everything is served from this origin
// and runs on-device in the browser.
export const MEDIAPIPE_WASM_BASE = "./vendor/mediapipe/wasm";
export const FACE_LANDMARKER_MODEL_URL = "./vendor/mediapipe/face_landmarker.task";

// MediaPipe's face transformation matrix assumes a vertical FOV of 63 degrees.
export const CAMERA_VERTICAL_FOV_DEG = 63;

// Requested capture constraints. The browser gives us the closest it supports;
// the debug overlay shows what we actually got.
export const VIDEO_CONSTRAINTS = {
  facingMode: "user",
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 60 },
};

// Recording bitrates (bits/second).
export const RECORD_VIDEO_BITRATE = 20_000_000;
export const EXPORT_VIDEO_BITRATE = 60_000_000;
export const RECORD_AUDIO_BITRATE = 128_000;

// Mask scale slider range (1.0 = anatomical fit).
export const MASK_SCALE_MIN = 1.0;
export const MASK_SCALE_MAX = 1.3;
export const MASK_SCALE_DEFAULT = 1.12;

// Smoothing slider default (0..1). Low by default: responsiveness beats smoothness.
export const SMOOTHING_DEFAULT = 0.2;

// Chroma green used by the clean-plate toggle.
export const GREEN_SCREEN_COLOR = 0x00b140;

// Sidecar format version (see js/sidecar.js).
export const SIDECAR_VERSION = 1;
