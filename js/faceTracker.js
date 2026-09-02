// FaceTracker: wraps MediaPipe FaceLandmarker and emits FaceSignal objects —
// the ARKit-named 52-blendshape vector plus a 4x4 head transform — with
// one-euro temporal smoothing on every channel.

import {
  FilesetResolver,
  FaceLandmarker,
} from "../vendor/mediapipe/vision_bundle.mjs";
import {
  MEDIAPIPE_WASM_BASE,
  FACE_LANDMARKER_MODEL_URL,
} from "./config.js";
import { ARKIT_BLENDSHAPES, emptyShapes } from "./blendshapeNames.js";
import { OneEuroFilter, minCutoffForStrength } from "./oneEuroFilter.js";

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.shapeFilters = new Map();
    for (const name of ARKIT_BLENDSHAPES) {
      this.shapeFilters.set(name, new OneEuroFilter(4.0, 0.08));
    }
    // Head translation gets its own filters; rotation is smoothed downstream
    // by the renderer via quaternion slerp using the same strength.
    this.posFilters = [
      new OneEuroFilter(4.0, 0.05),
      new OneEuroFilter(4.0, 0.05),
      new OneEuroFilter(4.0, 0.05),
    ];
    this.smoothingStrength = 0;
    this.lastVideoTime = -1;
    this.lastSignal = null;
    this.trackingFps = 0;
    this._fpsWindow = [];
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  }

  /** @param {number} strength 0..1 from the smoothing slider */
  setSmoothing(strength) {
    this.smoothingStrength = strength;
    const cutoff = minCutoffForStrength(strength);
    for (const f of this.shapeFilters.values()) f.setMinCutoff(cutoff);
    for (const f of this.posFilters) f.setMinCutoff(cutoff);
  }

  /**
   * Runs detection for the current video frame.
   * @param {HTMLVideoElement} video
   * @param {number} nowMs performance.now()
   * @returns {null | {t:number, shapes:Object, matrix:number[], tracked:boolean}}
   */
  detect(video, nowMs) {
    if (!this.landmarker || video.readyState < 2) return this.lastSignal;
    if (video.currentTime === this.lastVideoTime) return this.lastSignal;
    this.lastVideoTime = video.currentTime;

    const res = this.landmarker.detectForVideo(video, nowMs);
    const t = nowMs / 1000;

    this._fpsWindow.push(nowMs);
    while (this._fpsWindow.length && nowMs - this._fpsWindow[0] > 1000) {
      this._fpsWindow.shift();
    }
    this.trackingFps = this._fpsWindow.length;

    const cats = res.faceBlendshapes?.[0]?.categories;
    const mat = res.facialTransformationMatrixes?.[0]?.data;
    if (!cats || !mat) {
      this.lastSignal = { ...(this.lastSignal ?? { shapes: emptyShapes(), matrix: null }), t, tracked: false };
      return this.lastSignal;
    }

    const shapes = emptyShapes();
    for (const c of cats) {
      // MediaPipe names match ARKit identifiers ("_neutral" is skipped).
      if (c.categoryName in shapes) {
        shapes[c.categoryName] = this.shapeFilters
          .get(c.categoryName)
          .filter(c.score, t);
      }
    }

    const matrix = Array.from(mat);
    // Smooth translation (units are cm in MediaPipe's metric camera space).
    matrix[12] = this.posFilters[0].filter(matrix[12], t);
    matrix[13] = this.posFilters[1].filter(matrix[13], t);
    matrix[14] = this.posFilters[2].filter(matrix[14], t);

    this.lastSignal = { t, shapes, matrix, tracked: true };
    return this.lastSignal;
  }
}
