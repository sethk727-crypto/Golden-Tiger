// Spring-damper integrator for secondary motion (ears, whiskers).
// Semi-implicit Euler with substepping so high stiffness stays stable at
// variable frame times. Pure module — unit-testable under node.

export class Spring {
  /**
   * @param {number} stiffness  spring constant k (1/s^2 toward target)
   * @param {number} damping    damping coefficient c (1/s)
   */
  constructor(stiffness, damping, value = 0) {
    this.stiffness = stiffness;
    this.damping = damping;
    this.value = value;
    this.velocity = 0;
  }

  /**
   * Advances the spring toward `target` over `dt` seconds.
   * `impulse` adds instantaneous velocity (e.g. from head rotation velocity).
   */
  step(target, dt, impulse = 0) {
    this.velocity += impulse;
    // Substep: keep k*h^2 small enough for stability at 420+ stiffness.
    const maxH = 1 / 240;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 1e-6) {
      const h = Math.min(maxH, remaining);
      const accel =
        this.stiffness * (target - this.value) - this.damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    return this.value;
  }

  reset(value = 0) {
    this.value = value;
    this.velocity = 0;
  }
}
