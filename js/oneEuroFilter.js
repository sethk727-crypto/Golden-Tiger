// One-euro filter (Casiez, Roussel, Vogel — CHI 2012).
// Adaptive low-pass: heavy smoothing at low speeds, low latency at high speeds.
// Pure module, no DOM — unit-testable under node.

function smoothingFactor(dt, cutoff) {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
}

export class LowPassFilter {
  constructor() {
    this.initialized = false;
    this.value = 0;
  }
  filter(x, alpha) {
    if (!this.initialized) {
      this.initialized = true;
      this.value = x;
      return x;
    }
    this.value = alpha * x + (1 - alpha) * this.value;
    return this.value;
  }
  reset() {
    this.initialized = false;
  }
}

export class OneEuroFilter {
  /**
   * @param {number} minCutoff  base cutoff Hz — lower = smoother at rest
   * @param {number} beta       speed coefficient — higher = snappier on fast motion
   * @param {number} dCutoff    cutoff for the derivative estimate
   */
  constructor(minCutoff = 1.0, beta = 0.05, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPassFilter();
    this.dx = new LowPassFilter();
    this.lastTime = null;
  }

  /**
   * @param {number} value  raw sample
   * @param {number} t      timestamp in seconds
   */
  filter(value, t) {
    if (this.lastTime === null || t <= this.lastTime) {
      this.lastTime = t;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = t - this.lastTime;
    this.lastTime = t;
    const prev = this.x.initialized ? this.x.value : value;
    const rawDx = (value - prev) / dt;
    const edx = this.dx.filter(rawDx, smoothingFactor(dt, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, smoothingFactor(dt, cutoff));
  }

  setMinCutoff(minCutoff) {
    this.minCutoff = minCutoff;
  }

  reset() {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }
}

/**
 * Maps the UI smoothing strength (0..1) to a one-euro minCutoff.
 * 0   → 5.0 Hz (nearly raw)
 * 1   → 0.3 Hz (heavy smoothing)
 */
export function minCutoffForStrength(strength) {
  const s = Math.min(1, Math.max(0, strength));
  return 5.0 * Math.pow(0.3 / 5.0, s);
}
