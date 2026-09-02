import { test } from "node:test";
import assert from "node:assert/strict";
import { OneEuroFilter, minCutoffForStrength } from "../js/oneEuroFilter.js";
import { Spring } from "../js/spring.js";

test("one-euro passes the first sample through unchanged", () => {
  const f = new OneEuroFilter(1.0);
  assert.equal(f.filter(0.7, 0), 0.7);
});

test("one-euro converges to a held value", () => {
  const f = new OneEuroFilter(1.0);
  let v = f.filter(0, 0);
  for (let t = 1 / 60; t < 3; t += 1 / 60) v = f.filter(1, t);
  assert.ok(Math.abs(v - 1) < 0.01, `should converge, got ${v}`);
});

test("one-euro smooths more at higher strength", () => {
  const step = (cutoff) => {
    const f = new OneEuroFilter(cutoff, 0); // beta 0: fixed cutoff
    f.filter(0, 0);
    return f.filter(1, 1 / 60); // response to a unit step after one frame
  };
  const responsive = step(minCutoffForStrength(0));
  const smooth = step(minCutoffForStrength(1));
  assert.ok(responsive > smooth, `${responsive} !> ${smooth}`);
});

test("one-euro tracks fast motion with low lag (beta effect)", () => {
  const noBeta = new OneEuroFilter(0.5, 0);
  const withBeta = new OneEuroFilter(0.5, 1.0);
  let a = 0, b = 0;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    a = noBeta.filter(t, t); // ramp signal
    b = withBeta.filter(t, t);
  }
  assert.ok(Math.abs(b - 1) < Math.abs(a - 1), "beta should reduce lag");
});

test("spring settles at its target", () => {
  const s = new Spring(140, 16);
  let v = 0;
  for (let i = 0; i < 600; i++) v = s.step(1, 1 / 60);
  assert.ok(Math.abs(v - 1) < 0.01, `should settle, got ${v}`);
});

test("stiff, lightly damped spring overshoots (whisker ring)", () => {
  const s = new Spring(420, 6);
  let peak = 0;
  for (let i = 0; i < 300; i++) {
    const v = s.step(1, 1 / 60);
    peak = Math.max(peak, v);
  }
  assert.ok(peak > 1.1, `metal whiskers should ring past target, got ${peak}`);
});

test("spring stays finite under large impulses at odd dt", () => {
  const s = new Spring(420, 6);
  for (let i = 0; i < 100; i++) {
    s.step(0, 0.033 + (i % 7) * 0.005, i % 10 === 0 ? 5 : 0);
    assert.ok(Number.isFinite(s.value), "spring must stay stable");
    assert.ok(Math.abs(s.value) < 100, "spring must not explode");
  }
});
