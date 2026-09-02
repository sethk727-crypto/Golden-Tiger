// PersonaMapping: the pure layer between raw face signals and the tiger model.
// No DOM, no three.js — unit-tested under node (tests/personaMapping.test.mjs).
//
// Input:  FaceSignal { t (seconds), shapes {name: 0..1}, matrix (16 numbers) }
// Output: PersonaPose {
//   shapes        gain-scaled, clamped coefficients for morph targets
//   jawRadians    jaw bone rotation (base + additive roar range)
//   earFlatten    0..1 — ears pinned back (from averaged browDown)
//   earPerk       0..1 — ears perked (from browInnerUp)
//   roar          0..1 — composite roar pose envelope (sustained jawOpen)
// }

import { ARKIT_BLENDSHAPES } from "./blendshapeNames.js";

export const DEFAULT_MAPPING = {
  version: 1,
  gains: {},
  jaw: { baseRadians: 0.5, additiveThreshold: 0.7, roarExtraRadians: 0.38 },
  ears: {
    flattenFromBrowDown: 1.0,
    perkFromBrowInnerUp: 0.8,
    flattenRadians: 0.9,
    perkRadians: 0.35,
  },
  roar: { threshold: 0.8, holdMs: 250, attackMs: 120, releaseMs: 400 },
  springs: {
    ear: { stiffness: 140, damping: 16 },
    whisker: { stiffness: 420, damping: 6 },
  },
  headVelocityToImpulse: { ear: 0.06, whisker: 0.12 },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Deep-merges a user mapping over the defaults so partial files stay valid. */
export function normalizeMapping(raw) {
  const m = raw && typeof raw === "object" ? raw : {};
  return {
    version: m.version ?? DEFAULT_MAPPING.version,
    gains: { ...(m.gains ?? {}) },
    jaw: { ...DEFAULT_MAPPING.jaw, ...(m.jaw ?? {}) },
    ears: { ...DEFAULT_MAPPING.ears, ...(m.ears ?? {}) },
    roar: { ...DEFAULT_MAPPING.roar, ...(m.roar ?? {}) },
    springs: {
      ear: { ...DEFAULT_MAPPING.springs.ear, ...(m.springs?.ear ?? {}) },
      whisker: {
        ...DEFAULT_MAPPING.springs.whisker,
        ...(m.springs?.whisker ?? {}),
      },
    },
    headVelocityToImpulse: {
      ...DEFAULT_MAPPING.headVelocityToImpulse,
      ...(m.headVelocityToImpulse ?? {}),
    },
  };
}

export class PersonaMapping {
  constructor(mapping = DEFAULT_MAPPING) {
    this.mapping = normalizeMapping(mapping);
    this._jawAboveSince = null; // timestamp when jawOpen first crossed threshold
    this._roar = 0;
  }

  /**
   * @param {{t: number, shapes: Object<string, number>}} signal
   * @returns PersonaPose
   */
  update(signal) {
    const m = this.mapping;
    const raw = signal.shapes ?? {};

    const shapes = {};
    for (const name of ARKIT_BLENDSHAPES) {
      const gain = m.gains[name] ?? 1.0;
      shapes[name] = clamp01((raw[name] ?? 0) * gain);
    }

    // Jaw: linear base rotation, plus an additive exaggeration band past the
    // threshold so a wide-open mouth reads as a roar.
    const jawOpen = shapes.jawOpen;
    let jawRadians = jawOpen * m.jaw.baseRadians;
    if (jawOpen > m.jaw.additiveThreshold) {
      const overshoot =
        (jawOpen - m.jaw.additiveThreshold) / (1 - m.jaw.additiveThreshold);
      // Ease-in so the extra range ramps smoothly instead of kinking.
      jawRadians += overshoot * overshoot * m.jaw.roarExtraRadians;
    }

    const browDown = (shapes.browDownLeft + shapes.browDownRight) / 2;
    const earFlatten = clamp01(browDown * m.ears.flattenFromBrowDown);
    const earPerk = clamp01(shapes.browInnerUp * m.ears.perkFromBrowInnerUp);

    // Roar envelope: jawOpen must stay above threshold for holdMs before the
    // pose engages; it then attacks/releases with its own time constants.
    const t = signal.t;
    if (jawOpen > m.roar.threshold) {
      if (this._jawAboveSince === null) this._jawAboveSince = t;
    } else {
      this._jawAboveSince = null;
    }
    const sustained =
      this._jawAboveSince !== null &&
      (t - this._jawAboveSince) * 1000 >= m.roar.holdMs;
    const dt = this._lastT === undefined ? 0 : Math.max(0, t - this._lastT);
    this._lastT = t;
    const tau = sustained ? m.roar.attackMs / 1000 : m.roar.releaseMs / 1000;
    const target = sustained ? 1 : 0;
    if (dt > 0 && tau > 0) {
      const alpha = 1 - Math.exp(-dt / tau);
      this._roar += (target - this._roar) * alpha;
    } else if (dt > 0) {
      this._roar = target;
    }
    this._roar = clamp01(this._roar);

    return {
      shapes,
      jawRadians,
      earFlatten,
      earPerk,
      roar: this._roar,
    };
  }

  reset() {
    this._jawAboveSince = null;
    this._roar = 0;
    this._lastT = undefined;
  }
}
