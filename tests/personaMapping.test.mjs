import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PersonaMapping,
  normalizeMapping,
  DEFAULT_MAPPING,
} from "../js/personaMapping.js";
import { ARKIT_BLENDSHAPES } from "../js/blendshapeNames.js";

function signal(t, shapes) {
  return { t, shapes };
}

test("outputs every contract blendshape, clamped to [0,1]", () => {
  const pm = new PersonaMapping(DEFAULT_MAPPING);
  const pose = pm.update(signal(0, { jawOpen: 5, browDownLeft: -2 }));
  assert.equal(Object.keys(pose.shapes).length, ARKIT_BLENDSHAPES.length);
  assert.equal(pose.shapes.jawOpen, 1);
  assert.equal(pose.shapes.browDownLeft, 0);
  for (const name of ARKIT_BLENDSHAPES) {
    assert.ok(pose.shapes[name] >= 0 && pose.shapes[name] <= 1, name);
  }
});

test("gain multipliers scale raw coefficients", () => {
  const pm = new PersonaMapping(
    normalizeMapping({ gains: { mouthSmileLeft: 0.5 } })
  );
  const pose = pm.update(signal(0, { mouthSmileLeft: 0.8 }));
  assert.ok(Math.abs(pose.shapes.mouthSmileLeft - 0.4) < 1e-9);
});

test("jaw rotation is linear below the additive threshold", () => {
  const pm = new PersonaMapping(DEFAULT_MAPPING);
  const pose = pm.update(signal(0, { jawOpen: 0.5 }));
  assert.ok(
    Math.abs(pose.jawRadians - 0.5 * DEFAULT_MAPPING.jaw.baseRadians) < 1e-9
  );
});

test("jaw gains additive range past the threshold", () => {
  const pm = new PersonaMapping(DEFAULT_MAPPING);
  const at = pm.update(signal(0, { jawOpen: 0.7 })).jawRadians;
  pm.reset();
  const full = pm.update(signal(0, { jawOpen: 1.0 })).jawRadians;
  const expectedFull =
    DEFAULT_MAPPING.jaw.baseRadians + DEFAULT_MAPPING.jaw.roarExtraRadians;
  assert.ok(full > at + 0.1, "full open should exceed threshold pose");
  assert.ok(Math.abs(full - expectedFull) < 1e-9);
});

test("ears flatten from averaged browDown, perk from browInnerUp", () => {
  const pm = new PersonaMapping(DEFAULT_MAPPING);
  const flat = pm.update(
    signal(0, { browDownLeft: 0.6, browDownRight: 0.2 })
  );
  assert.ok(Math.abs(flat.earFlatten - 0.4) < 1e-9);
  pm.reset();
  const perk = pm.update(signal(0, { browInnerUp: 0.5 }));
  assert.ok(
    Math.abs(
      perk.earPerk - 0.5 * DEFAULT_MAPPING.ears.perkFromBrowInnerUp
    ) < 1e-9
  );
});

test("roar requires sustained jawOpen past holdMs", () => {
  const pm = new PersonaMapping(DEFAULT_MAPPING);
  // A single spike does not trigger.
  let pose = pm.update(signal(0.0, { jawOpen: 0.95 }));
  pose = pm.update(signal(0.05, { jawOpen: 0.95 }));
  assert.ok(pose.roar < 0.05, "no roar before holdMs");
  // Held past holdMs (250ms default) → envelope attacks toward 1.
  for (let t = 0.1; t <= 1.2; t += 0.05) {
    pose = pm.update(signal(t, { jawOpen: 0.95 }));
  }
  assert.ok(pose.roar > 0.8, `roar should engage, got ${pose.roar}`);
  // Jaw closes → envelope releases.
  for (let t = 1.25; t <= 3.0; t += 0.05) {
    pose = pm.update(signal(t, { jawOpen: 0.1 }));
  }
  assert.ok(pose.roar < 0.1, `roar should release, got ${pose.roar}`);
});

test("roar does not trigger from repeated short spikes", () => {
  const pm = new PersonaMapping(DEFAULT_MAPPING);
  let pose;
  for (let i = 0; i < 20; i++) {
    const base = i * 0.2;
    pose = pm.update(signal(base, { jawOpen: 0.95 }));
    pose = pm.update(signal(base + 0.1, { jawOpen: 0.1 }));
  }
  assert.ok(pose.roar < 0.1, `spikes must not roar, got ${pose.roar}`);
});

test("normalizeMapping deep-merges partial files over defaults", () => {
  const m = normalizeMapping({ roar: { threshold: 0.9 } });
  assert.equal(m.roar.threshold, 0.9);
  assert.equal(m.roar.holdMs, DEFAULT_MAPPING.roar.holdMs);
  assert.equal(m.springs.whisker.stiffness, DEFAULT_MAPPING.springs.whisker.stiffness);
});

test("shipped mapping.json parses and normalizes cleanly", async () => {
  const raw = JSON.parse(
    await readFile(new URL("../mapping.json", import.meta.url), "utf8")
  );
  const m = normalizeMapping(raw);
  assert.equal(m.version, 1);
  assert.ok(m.springs.whisker.stiffness > m.springs.ear.stiffness,
    "metal whiskers should be stiffer than ears");
  assert.ok(m.springs.whisker.damping < m.springs.ear.damping,
    "metal whiskers should be less damped than ears");
  const pm = new PersonaMapping(m);
  const pose = pm.update(signal(0, { jawOpen: 1 }));
  assert.ok(pose.jawRadians > 0);
});
