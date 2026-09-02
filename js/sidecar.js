// Sidecar tracking-data serializer. Persists per-frame timestamps, the full
// blendshape vector, and the 4x4 head transform alongside a recorded take, so
// the take can be re-rendered offline at 4K through the same rendering stack.
// Pure module — unit-tested under node (tests/sidecar.test.mjs).

import { ARKIT_BLENDSHAPES } from "./blendshapeNames.js";
import { SIDECAR_VERSION } from "./config.js";

// Coefficients are quantized to 4 decimal places and stored as flat arrays in
// contract order — ~6x smaller than name-keyed objects at 60fps.
const Q = 10000;

export class SidecarRecorder {
  /**
   * @param {{width:number, height:number, fps:number}} meta capture metadata
   */
  constructor(meta = {}) {
    this.meta = meta;
    this.frames = [];
    this.startTime = null;
  }

  /**
   * @param {number} t        absolute time in seconds
   * @param {Object} shapes   name → 0..1 (post-smoothing, pre-persona)
   * @param {ArrayLike} matrix 16-element column-major head transform
   */
  addFrame(t, shapes, matrix) {
    if (this.startTime === null) this.startTime = t;
    const coeffs = new Array(ARKIT_BLENDSHAPES.length);
    for (let i = 0; i < ARKIT_BLENDSHAPES.length; i++) {
      coeffs[i] = Math.round((shapes[ARKIT_BLENDSHAPES[i]] ?? 0) * Q) / Q;
    }
    const m = new Array(16);
    for (let i = 0; i < 16; i++) m[i] = Math.round(matrix[i] * Q) / Q;
    this.frames.push({ t: Math.round((t - this.startTime) * Q) / Q, c: coeffs, m });
  }

  get frameCount() {
    return this.frames.length;
  }

  /** Serializes to the versioned sidecar JSON string. */
  serialize() {
    return JSON.stringify({
      format: "aurumask-sidecar",
      version: SIDECAR_VERSION,
      recordedAt: new Date().toISOString(),
      meta: this.meta,
      blendshapeOrder: ARKIT_BLENDSHAPES,
      frames: this.frames,
    });
  }

  reset() {
    this.frames = [];
    this.startTime = null;
  }
}

/**
 * Parses and validates a sidecar JSON string.
 * Returns { meta, frames: [{t, shapes, matrix}] } with shapes re-keyed by name.
 * Throws with a human-readable message on any malformed input.
 */
export function parseSidecar(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON.");
  }
  if (doc?.format !== "aurumask-sidecar") {
    throw new Error("Not an AuruMask sidecar file (missing format tag).");
  }
  if (doc.version !== SIDECAR_VERSION) {
    throw new Error(
      `Unsupported sidecar version ${doc.version} (expected ${SIDECAR_VERSION}).`
    );
  }
  const order = doc.blendshapeOrder;
  if (!Array.isArray(order) || order.length === 0) {
    throw new Error("Sidecar is missing its blendshape order table.");
  }
  if (!Array.isArray(doc.frames) || doc.frames.length === 0) {
    throw new Error("Sidecar contains no frames.");
  }
  const frames = doc.frames.map((f, idx) => {
    if (
      typeof f?.t !== "number" ||
      !Array.isArray(f.c) ||
      f.c.length !== order.length ||
      !Array.isArray(f.m) ||
      f.m.length !== 16
    ) {
      throw new Error(`Frame ${idx} is malformed.`);
    }
    const shapes = {};
    for (let i = 0; i < order.length; i++) shapes[order[i]] = f.c[i];
    return { t: f.t, shapes, matrix: f.m };
  });
  return { meta: doc.meta ?? {}, frames };
}
