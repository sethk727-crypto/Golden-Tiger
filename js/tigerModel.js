// Tiger head model. Two paths behind one interface:
//  1. loadTigerModel(): loads the real asset from MODEL_PATH (.glb) and binds
//     its morph targets + bones by the names in ASSET_CONTRACT.md.
//  2. buildProceduralTiger(): the in-code placeholder — a stylized golden
//     tiger head honoring the same blendshape contract, so the real asset
//     is a drop-in swap.
//
// The returned TigerHead exposes:
//   group                 THREE.Group to attach to the face anchor
//   applyPose(pose, headAngularVel, dt)   drives morphs/bones/springs
//   setEnvironmentIntensity(v)
//
// Units are centimeters (MediaPipe's metric camera space).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Spring } from "./spring.js";

const GOLD = 0xd4a017;
const GOLD_BRIGHT = 0xffcf5e;
const DARK_STRIPE = "#3a2408";

/** Procedural gold-with-stripes texture painted on a canvas. */
function makeStripeTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, "#ffd98a");
  grad.addColorStop(0.5, "#e8b545");
  grad.addColorStop(1, "#c98f1e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Tapered tiger stripes, mirrored around the center seam.
  ctx.fillStyle = DARK_STRIPE;
  const rand = mulberry32(0x71ac);
  for (let i = 0; i < 14; i++) {
    const y = 40 + i * 34 + rand() * 12;
    const len = 90 + rand() * 110;
    const w = 8 + rand() * 10;
    for (const side of [0, 1]) {
      ctx.save();
      ctx.translate(side === 0 ? 0 : size, y);
      ctx.scale(side === 0 ? 1 : -1, 1);
      ctx.rotate((rand() - 0.5) * 0.35);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.6, -w, len, 0);
      ctx.quadraticCurveTo(len * 0.6, w, 0, w * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function goldMaterial(texture) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: texture ?? null,
    metalness: 1.0,
    roughness: 0.24,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.2,
  });
}

export class TigerHead {
  constructor(group, bindings, mapping) {
    this.group = group;
    this.b = bindings; // named parts / morph meshes / bones
    this.mapping = mapping;
    const s = mapping.springs;
    this.earSpringL = new Spring(s.ear.stiffness, s.ear.damping);
    this.earSpringR = new Spring(s.ear.stiffness, s.ear.damping);
    this.whiskerSpringL = new Spring(s.whisker.stiffness, s.whisker.damping);
    this.whiskerSpringR = new Spring(s.whisker.stiffness, s.whisker.damping);
  }

  /**
   * @param {object} pose         PersonaPose from PersonaMapping.update()
   * @param {THREE.Vector3} headAngVel  head angular velocity (rad/s)
   * @param {number} dt           seconds since last frame
   */
  applyPose(pose, headAngVel, dt) {
    const b = this.b;

    // 1) Morph targets by contract name (real asset path).
    if (b.morphMeshes) {
      for (const mesh of b.morphMeshes) {
        const dict = mesh.morphTargetDictionary;
        for (const [name, value] of Object.entries(pose.shapes)) {
          const idx = dict[name];
          if (idx !== undefined) mesh.morphTargetInfluences[idx] = value;
        }
      }
    }

    // 2) Jaw bone: base + additive roar range (computed by PersonaMapping).
    if (b.jaw) {
      b.jaw.rotation.x = b.jawRestX + pose.jawRadians;
    }

    // 3) Ears: persona target (flatten beats perk) + spring wobble from head
    //    rotation velocity.
    const earTarget =
      -pose.earFlatten * this.mapping.ears.flattenRadians +
      pose.earPerk * this.mapping.ears.perkRadians * (1 - pose.earFlatten);
    const impulseGain = this.mapping.headVelocityToImpulse.ear;
    const earImpulse = (headAngVel.y + headAngVel.x) * impulseGain;
    const earL = this.earSpringL.step(earTarget, dt, earImpulse);
    const earR = this.earSpringR.step(earTarget, dt, -earImpulse);
    if (b.earL) b.earL.rotation.x = b.earLRest + earL;
    if (b.earR) b.earR.rotation.x = b.earRRest + earR;

    // 4) Whiskers: stiff, lightly damped metal — they ring on fast head turns.
    const wGain = this.mapping.headVelocityToImpulse.whisker;
    const wL = this.whiskerSpringL.step(0, dt, headAngVel.y * wGain);
    const wR = this.whiskerSpringR.step(0, dt, -headAngVel.y * wGain);
    if (b.whiskersL) b.whiskersL.rotation.z = wL * 0.25;
    if (b.whiskersR) b.whiskersR.rotation.z = -wR * 0.25;

    // 5) Placeholder-only expression rig (real asset does this via morphs).
    if (b.eyelidL) {
      const blinkL = pose.shapes.eyeBlinkLeft;
      const blinkR = pose.shapes.eyeBlinkRight;
      b.eyelidL.scale.y = 0.12 + blinkL * 1.0;
      b.eyelidR.scale.y = 0.12 + blinkR * 1.0;
      b.eyelidL.visible = blinkL > 0.05;
      b.eyelidR.visible = blinkR > 0.05;
    }
    if (b.browL) {
      const browUp =
        (pose.shapes.browOuterUpLeft + pose.shapes.browInnerUp) * 0.5;
      const browDn = pose.shapes.browDownLeft;
      b.browL.position.y = b.browRestY + (browUp - browDn) * 0.9;
      const browUpR =
        (pose.shapes.browOuterUpRight + pose.shapes.browInnerUp) * 0.5;
      b.browR.position.y = b.browRestY + (browUpR - pose.shapes.browDownRight) * 0.9;
    }
    if (b.noseTip) {
      const sneer = (pose.shapes.noseSneerLeft + pose.shapes.noseSneerRight) / 2;
      b.noseTip.position.y = b.noseRestY + sneer * 0.4 + pose.roar * 0.3;
    }
    if (b.eyes) {
      // Roar: eyes flare brighter, pupils narrow to slits.
      const flare = 0.55 + pose.roar * 1.6;
      for (const eye of b.eyes) eye.material.emissiveIntensity = flare;
      if (b.pupils) {
        for (const p of b.pupils) p.scale.x = 0.55 - pose.roar * 0.3;
      }
    }
  }

  setEnvironmentIntensity(v) {
    this.group.traverse((o) => {
      if (o.isMesh && o.material?.envMapIntensity !== undefined) {
        o.material.envMapIntensity = v;
      }
    });
  }
}

/** Builds the stylized placeholder tiger. Everything in cm, +Z toward camera. */
export function buildProceduralTiger(mapping) {
  const group = new THREE.Group();
  group.name = "TigerHead(placeholder)";
  const tex = makeStripeTexture();
  const gold = goldMaterial(tex);
  const goldPlain = goldMaterial(null);
  goldPlain.color.set(GOLD_BRIGHT);
  const darkGold = new THREE.MeshPhysicalMaterial({
    color: 0x6b4a12,
    metalness: 1,
    roughness: 0.45,
  });
  const innerMouth = new THREE.MeshStandardMaterial({
    color: 0x2a0d06,
    metalness: 0.2,
    roughness: 0.9,
  });

  const bindings = {};

  // Cranium — wider than tall, flattened front.
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(9.2, 48, 32), gold);
  cranium.scale.set(1.18, 1.0, 0.95);
  group.add(cranium);

  // Cheek ruff — flattened cones fanning out around the lower head.
  const ruff = new THREE.Group();
  const ruffGeo = new THREE.ConeGeometry(2.2, 7, 6);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.25 && Math.cos(a) > 0) continue; // gap at muzzle
    const spike = new THREE.Mesh(ruffGeo, gold);
    spike.position.set(Math.cos(a) * 9.5, Math.sin(a) * 8.2 - 1.5, -2.0);
    spike.rotation.z = a - Math.PI / 2;
    spike.scale.z = 0.45;
    ruff.add(spike);
  }
  group.add(ruff);

  // Muzzle.
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(4.6, 32, 24), gold);
  muzzle.position.set(0, -2.6, 6.4);
  muzzle.scale.set(1.25, 0.85, 1.0);
  group.add(muzzle);

  // Nose.
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 16), goldPlain);
  nose.position.set(0, -0.9, 10.4);
  nose.scale.set(1.25, 0.8, 0.7);
  group.add(nose);
  bindings.noseTip = nose;
  bindings.noseRestY = nose.position.y;

  // Inner mouth cavity.
  const cavity = new THREE.Mesh(new THREE.SphereGeometry(3.6, 24, 16), innerMouth);
  cavity.position.set(0, -4.2, 5.2);
  group.add(cavity);

  // Upper fangs.
  const fangGeo = new THREE.ConeGeometry(0.55, 3.2, 12);
  for (const x of [-2.4, 2.4]) {
    const fang = new THREE.Mesh(fangGeo, goldPlain);
    fang.position.set(x, -4.6, 8.2);
    fang.rotation.x = Math.PI; // point down
    group.add(fang);
  }
  // Upper small teeth row.
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 8), goldPlain);
    t.position.set(i * 0.9, -4.4, 8.8);
    t.rotation.x = Math.PI;
    group.add(t);
  }

  // Jaw group — pivot at the jaw hinge (back of the skull, below ears).
  const jawGroup = new THREE.Group();
  jawGroup.position.set(0, -3.4, -0.5);
  const lowerJaw = new THREE.Mesh(new THREE.SphereGeometry(3.9, 32, 24), gold);
  lowerJaw.position.set(0, -1.8, 6.6);
  lowerJaw.scale.set(1.1, 0.55, 1.05);
  jawGroup.add(lowerJaw);
  const chinTuft = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.4, 8), gold);
  chinTuft.position.set(0, -3.2, 6.8);
  chinTuft.rotation.x = Math.PI * 0.95;
  jawGroup.add(chinTuft);
  // Lower fangs + teeth ride the jaw.
  for (const x of [-2.0, 2.0]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.4, 12), goldPlain);
    fang.position.set(x, -0.6, 8.0);
    jawGroup.add(fang);
  }
  for (let i = -2; i <= 2; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 8), goldPlain);
    t.position.set(i * 0.8, -0.8, 8.4);
    jawGroup.add(t);
  }
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(1.8, 20, 14), innerMouth);
  tongue.position.set(0, -1.1, 6.2);
  tongue.scale.set(0.9, 0.35, 1.4);
  jawGroup.add(tongue);
  group.add(jawGroup);
  bindings.jaw = jawGroup;
  bindings.jawRestX = 0.06;
  jawGroup.rotation.x = bindings.jawRestX;

  // Eyes — amber, emissive, with slit pupils and gold lids for blinks.
  bindings.eyes = [];
  bindings.pupils = [];
  const eyeMatBase = new THREE.MeshPhysicalMaterial({
    color: 0xffb52e,
    emissive: 0xff8c00,
    emissiveIntensity: 0.55,
    metalness: 0.1,
    roughness: 0.15,
  });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1.7, 24, 16), eyeMatBase.clone());
    eye.position.set(side * 4.0, 1.6, 6.8);
    group.add(eye);
    bindings.eyes.push(eye);

    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x120a02 })
    );
    // Proud of the eye surface so the slit reads from the front.
    pupil.position.set(side * 4.0, 1.6, 8.55);
    pupil.scale.set(0.55, 1.0, 0.35);
    group.add(pupil);
    bindings.pupils.push(pupil);

    const lid = new THREE.Mesh(new THREE.SphereGeometry(1.85, 24, 16), gold);
    lid.position.copy(eye.position);
    lid.position.z += 0.15;
    lid.scale.set(1.05, 0.12, 1.05);
    lid.visible = false;
    group.add(lid);
    if (side === -1) bindings.eyelidL = lid;
    else bindings.eyelidR = lid;
  }

  // Brow ridges.
  bindings.browRestY = 3.6;
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.SphereGeometry(2.0, 20, 14), gold);
    brow.position.set(side * 4.0, bindings.browRestY, 6.4);
    brow.scale.set(1.3, 0.42, 0.8);
    group.add(brow);
    if (side === -1) bindings.browL = brow;
    else bindings.browR = brow;
  }

  // Ears — pivoted groups so springs rotate them naturally.
  for (const side of [-1, 1]) {
    const earGroup = new THREE.Group();
    earGroup.position.set(side * 6.8, 7.6, -1.5);
    earGroup.rotation.z = side * -0.35;
    const outer = new THREE.Mesh(new THREE.ConeGeometry(2.6, 4.6, 24), gold);
    outer.scale.z = 0.55;
    outer.position.y = 2.3;
    earGroup.add(outer);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.2, 20), darkGold);
    inner.scale.z = 0.4;
    inner.position.set(0, 1.9, 0.7);
    earGroup.add(inner);
    group.add(earGroup);
    if (side === -1) {
      bindings.earL = earGroup;
      bindings.earLRest = 0;
    } else {
      bindings.earR = earGroup;
      bindings.earRRest = 0;
    }
  }

  // Whiskers — metal wires as thin curved tubes, grouped per side for springs.
  const whiskerMat = new THREE.MeshPhysicalMaterial({
    color: 0xfff3c4,
    metalness: 1,
    roughness: 0.1,
  });
  for (const side of [-1, 1]) {
    const wGroup = new THREE.Group();
    wGroup.position.set(side * 3.4, -2.2, 8.6);
    for (let i = 0; i < 4; i++) {
      const spread = (i - 1.5) * 0.28;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(side * 4.5, spread * 2.0 + 0.4, 1.2),
        new THREE.Vector3(side * 9.5, spread * 5.0, 0.6),
      ]);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 12, 0.09, 6),
        whiskerMat
      );
      wGroup.add(tube);
    }
    group.add(wGroup);
    if (side === -1) bindings.whiskersL = wGroup;
    else bindings.whiskersR = wGroup;
  }

  // Anchor alignment: MediaPipe's face origin sits roughly behind the nose
  // bridge. Nudge the head back and up so it wraps the real skull.
  group.position.set(0, 1.0, -2.0);

  const inner = new THREE.Group();
  inner.add(group);
  inner.name = "TigerHeadRoot";
  return new TigerHead(inner, bindings, mapping);
}

/**
 * Loads the real tiger asset (.glb) from MODEL_PATH and binds by contract
 * names. Falls back to the procedural placeholder on any failure.
 */
export async function loadTigerModel(modelPath, mapping) {
  if (!modelPath) return buildProceduralTiger(mapping);
  try {
    const gltf = await new GLTFLoader().loadAsync(modelPath);
    const root = gltf.scene;
    const bindings = { morphMeshes: [] };
    root.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary) bindings.morphMeshes.push(o);
      if (o.isBone || o.isObject3D) {
        if (o.name === "jaw") {
          bindings.jaw = o;
          bindings.jawRestX = o.rotation.x;
        }
        if (o.name === "ear_L") {
          bindings.earL = o;
          bindings.earLRest = o.rotation.x;
        }
        if (o.name === "ear_R") {
          bindings.earR = o;
          bindings.earRRest = o.rotation.x;
        }
        if (o.name === "whiskers_L") bindings.whiskersL = o;
        if (o.name === "whiskers_R") bindings.whiskersR = o;
      }
    });
    const inner = new THREE.Group();
    inner.add(root);
    inner.name = "TigerHeadRoot";
    console.info(
      `[AuruMask] Loaded model ${modelPath}: ${bindings.morphMeshes.length} morph mesh(es).`
    );
    return new TigerHead(inner, bindings, mapping);
  } catch (err) {
    console.warn(
      `[AuruMask] Failed to load ${modelPath} (${err.message}); using procedural placeholder.`
    );
    return buildProceduralTiger(mapping);
  }
}
