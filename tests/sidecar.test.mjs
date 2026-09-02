import { test } from "node:test";
import assert from "node:assert/strict";
import { SidecarRecorder, parseSidecar } from "../js/sidecar.js";
import { ARKIT_BLENDSHAPES, emptyShapes } from "../js/blendshapeNames.js";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test("round-trips frames through serialize/parse", () => {
  const rec = new SidecarRecorder({ width: 1280, height: 720, fps: 60 });
  const shapes = emptyShapes();
  shapes.jawOpen = 0.5;
  shapes.eyeBlinkRight = 0.25;
  rec.addFrame(10.0, shapes, IDENTITY);
  shapes.jawOpen = 0.9;
  rec.addFrame(10.016, shapes, IDENTITY);

  const { meta, frames } = parseSidecar(rec.serialize());
  assert.equal(meta.width, 1280);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].t, 0); // timestamps rebased to take start
  assert.ok(Math.abs(frames[1].t - 0.016) < 1e-3);
  assert.equal(frames[0].shapes.jawOpen, 0.5);
  assert.equal(frames[1].shapes.jawOpen, 0.9);
  assert.equal(frames[0].shapes.eyeBlinkRight, 0.25);
  assert.deepEqual(frames[0].matrix, IDENTITY);
});

test("stores the full contract vector per frame", () => {
  const rec = new SidecarRecorder({});
  rec.addFrame(0, emptyShapes(), IDENTITY);
  const doc = JSON.parse(rec.serialize());
  assert.deepEqual(doc.blendshapeOrder, ARKIT_BLENDSHAPES);
  assert.equal(doc.frames[0].c.length, ARKIT_BLENDSHAPES.length);
});

test("quantizes coefficients to 4 decimals", () => {
  const rec = new SidecarRecorder({});
  const shapes = emptyShapes();
  shapes.jawOpen = 0.123456789;
  rec.addFrame(0, shapes, IDENTITY);
  const { frames } = parseSidecar(rec.serialize());
  assert.equal(frames[0].shapes.jawOpen, 0.1235);
});

test("rejects non-JSON input", () => {
  assert.throws(() => parseSidecar("not json"), /Not valid JSON/);
});

test("rejects foreign JSON without the format tag", () => {
  assert.throws(
    () => parseSidecar(JSON.stringify({ hello: "world" })),
    /format tag/
  );
});

test("rejects unsupported versions", () => {
  assert.throws(
    () =>
      parseSidecar(
        JSON.stringify({
          format: "aurumask-sidecar",
          version: 999,
          blendshapeOrder: ARKIT_BLENDSHAPES,
          frames: [{ t: 0, c: [], m: IDENTITY }],
        })
      ),
    /version/
  );
});

test("rejects malformed frames with a frame index", () => {
  const rec = new SidecarRecorder({});
  rec.addFrame(0, emptyShapes(), IDENTITY);
  const doc = JSON.parse(rec.serialize());
  doc.frames.push({ t: 1, c: [0.5], m: IDENTITY }); // wrong coeff count
  assert.throws(() => parseSidecar(JSON.stringify(doc)), /Frame 1 is malformed/);
});

test("rejects empty takes", () => {
  const rec = new SidecarRecorder({});
  assert.throws(() => parseSidecar(rec.serialize()), /no frames/);
});

test("reset clears frames and rebasing", () => {
  const rec = new SidecarRecorder({});
  rec.addFrame(5, emptyShapes(), IDENTITY);
  rec.reset();
  assert.equal(rec.frameCount, 0);
  rec.addFrame(20, emptyShapes(), IDENTITY);
  const { frames } = parseSidecar(rec.serialize());
  assert.equal(frames[0].t, 0);
});
