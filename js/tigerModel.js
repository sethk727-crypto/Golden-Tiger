// Tiger head model. Two paths behind one interface:
//  1. loadTigerModel(): loads the real asset from MODEL_PATH (.glb) and binds
//     its morph targets + bones by the names in ASSET_CONTRACT.md.
//  2. buildProceduralTiger(): the in-code placeholder — a gold tiger head
//     modeled on the reference statue (broad striped forehead, cheek ruff,
//     cupped ears, dark-rimmed amber eyes, whisker pads, long canines),
//     honoring the same blendshape contract so the real asset is a drop-in.
//
// The returned TigerHead exposes:
//   group                 THREE.Group to attach to the face anchor
//   applyPose(pose, headAngularVel, dt)   drives morphs/bones/springs
//   setEnvironmentIntensity(v)
//
// Units are centimeters (MediaPipe's metric camera space). Front is +Z.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Spring } from "./spring.js";

/* ------------------------------ textures ------------------------------ */

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

// Equirect fur map for the skull/muzzle spheres. Sphere UV puts the face
// front (+Z) at u=0.25, so the pattern is authored around canvas x = w/4:
// radiating forehead stripes above, cheek chevrons at the sides, whisker
// dot rows low on the front, generic stripes around the back.
function makeFurTexture() {
  const w = 1024, h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(0x9137);
  const FRONT = w * 0.25;

  // Base gold with vertical tonal variation.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#f4c964");
  grad.addColorStop(0.35, "#e2ac3c");
  grad.addColorStop(0.7, "#cf9526");
  grad.addColorStop(1, "#b57d1a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Fine fur strokes: thousands of short vertical flicks, light and dark.
  for (let i = 0; i < 5200; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const len = 5 + rand() * 13;
    const dark = rand() > 0.48;
    ctx.strokeStyle = dark
      ? `rgba(74, 46, 8, ${0.05 + rand() * 0.08})`
      : `rgba(255, 232, 160, ${0.05 + rand() * 0.08})`;
    ctx.lineWidth = 0.8 + rand() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 4, y + len);
    ctx.stroke();
  }

  const stripe = (x, y, len, wdt, ang) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(wdt, len * 0.55, 0, len);
    ctx.quadraticCurveTo(-wdt, len * 0.55, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  ctx.fillStyle = "#31210a";

  // Forehead: dense thin stripes radiating down from the crown, mirrored.
  for (let i = 0; i < 9; i++) {
    const off = (i + 0.5) * 13 + rand() * 4;
    const len = 66 - i * 4 + rand() * 16;
    const wdt = 4.5 + rand() * 2.5;
    const ang = (i + 1) * 0.05;
    stripe(FRONT - off, h * 0.06, len, wdt, -ang);
    stripe(FRONT + off, h * 0.06, len, wdt, ang);
  }
  // Center crown stripe.
  stripe(FRONT, h * 0.04, 84, 5.5, 0);

  // Cheek chevrons: angled stripes sweeping back from the eyes.
  for (let i = 0; i < 5; i++) {
    const off = w * (0.09 + i * 0.032);
    const y = h * (0.34 + i * 0.05) + rand() * 8;
    const len = 74 + rand() * 26;
    const wdt = 6 + rand() * 3;
    stripe(FRONT - off, y, len, wdt, -1.05 - i * 0.06);
    stripe(FRONT + off, y, len, wdt, 1.05 + i * 0.06);
  }

  // Back and sides of the head: classic vertical stripes.
  for (let i = 0; i < 13; i++) {
    const x = w * 0.52 + i * (w * 0.036) + rand() * 8;
    const y = h * 0.12 + rand() * h * 0.28;
    stripe(x % w, y, 90 + rand() * 60, 7 + rand() * 4, (rand() - 0.5) * 0.3);
  }

  // Whisker-pad dot rows, low on the face front.
  ctx.fillStyle = "rgba(42, 28, 8, 0.7)";
  for (const side of [-1, 1]) {
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 4; i++) {
        const x = FRONT + side * (w * 0.03 + i * w * 0.02) + (rand() - 0.5) * 6;
        const y = h * (0.61 + r * 0.045) + (rand() - 0.5) * 8;
        ctx.beginPath();
        ctx.arc(x, y, 1.6 + rand() * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Radial amber iris for a flat disc in front of the eyeball.
function makeIrisTexture() {
  const s = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(s / 2, s / 2, 6, s / 2, s / 2, s / 2);
  g.addColorStop(0, "#ffd98f");
  g.addColorStop(0.35, "#f5a52a");
  g.addColorStop(0.72, "#b4650a");
  g.addColorStop(0.9, "#5e3305");
  g.addColorStop(1, "#20130a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // Radial fibers.
  const rand = mulberry32(0x51ce);
  ctx.strokeStyle = "rgba(60, 30, 4, 0.25)";
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2;
    ctx.lineWidth = 0.8 + rand();
    ctx.beginPath();
    ctx.moveTo(s / 2 + Math.cos(a) * 14, s / 2 + Math.sin(a) * 14);
    ctx.lineTo(s / 2 + Math.cos(a) * (s * 0.46), s / 2 + Math.sin(a) * (s * 0.46));
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------ geometry ------------------------------ */

// Displaces vertices along their normals with layered sine "clump" noise —
// turns clean spheres into fur-like sculpted masses (as on the statue).
function furDisplace(geometry, amount, freq = 1) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const x = v.x * freq, y = v.y * freq, z = v.z * freq;
    const n =
      (Math.sin(x * 1.7 + z * 2.3) +
        Math.sin(y * 2.9 + x * 3.1 + 1.7) +
        Math.sin(z * 4.3 + y * 1.9 + 4.2)) / 3;
    const fine = Math.sin(x * 9.1 + y * 7.7 + z * 8.3) * 0.35;
    const d = 1 + (n + fine) * amount;
    pos.setXYZ(i, v.x * d, v.y * d, v.z * d);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/* ------------------------------ materials ----------------------------- */

function makeMaterials() {
  const furTex = makeFurTexture();
  return {
    fur: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: furTex,
      bumpMap: furTex,
      bumpScale: 0.6,
      metalness: 1.0,
      roughness: 0.34,
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
      envMapIntensity: 1.25,
    }),
    smoothGold: new THREE.MeshPhysicalMaterial({
      color: 0xf3c968,
      metalness: 1.0,
      roughness: 0.14,
      clearcoat: 0.7,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.4,
    }),
    enamel: new THREE.MeshPhysicalMaterial({
      color: 0xfff0c8,
      metalness: 0.85,
      roughness: 0.1,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.5,
    }),
    darkGold: new THREE.MeshPhysicalMaterial({
      color: 0x4a2f0a,
      metalness: 1.0,
      roughness: 0.5,
      envMapIntensity: 0.8,
    }),
    rim: new THREE.MeshPhysicalMaterial({
      color: 0x241503,
      metalness: 1.0,
      roughness: 0.42,
      envMapIntensity: 0.7,
    }),
    innerMouth: new THREE.MeshPhysicalMaterial({
      color: 0x571f0c,
      metalness: 0.6,
      roughness: 0.55,
      clearcoat: 0.5,
      envMapIntensity: 0.7,
    }),
    tongue: new THREE.MeshPhysicalMaterial({
      color: 0x9a5a1e,
      metalness: 0.85,
      roughness: 0.38,
      clearcoat: 0.6,
      envMapIntensity: 1.0,
    }),
    whisker: new THREE.MeshPhysicalMaterial({
      color: 0xfff3c4,
      metalness: 1,
      roughness: 0.12,
      envMapIntensity: 1.4,
    }),
  };
}

/* ------------------------------ TigerHead ----------------------------- */

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
    const s = pose.shapes;

    // 1) Morph targets by contract name (real asset path).
    if (b.morphMeshes) {
      for (const mesh of b.morphMeshes) {
        const dict = mesh.morphTargetDictionary;
        for (const [name, value] of Object.entries(s)) {
          const idx = dict[name];
          if (idx !== undefined) mesh.morphTargetInfluences[idx] = value;
        }
      }
    }

    // 2) Jaw bone: base + additive roar range (computed by PersonaMapping).
    if (b.jaw) {
      b.jaw.rotation.x = b.jawRestX + pose.jawRadians;
      // Smile widens the jaw a touch; keeps talking lively.
      const smile = (s.mouthSmileLeft + s.mouthSmileRight) / 2;
      b.jaw.scale.x = 1 + smile * 0.06;
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
      const blinkL = s.eyeBlinkLeft;
      const blinkR = s.eyeBlinkRight;
      b.eyelidL.scale.y = 0.12 + blinkL * 1.0;
      b.eyelidR.scale.y = 0.12 + blinkR * 1.0;
      b.eyelidL.visible = blinkL > 0.05;
      b.eyelidR.visible = blinkR > 0.05;
    }
    if (b.browL) {
      const browUpL = (s.browOuterUpLeft + s.browInnerUp) * 0.5;
      const browUpR = (s.browOuterUpRight + s.browInnerUp) * 0.5;
      b.browL.position.y = b.browRestY + (browUpL - s.browDownLeft) * 0.9;
      b.browR.position.y = b.browRestY + (browUpR - s.browDownRight) * 0.9;
    }
    if (b.noseTip) {
      const sneer =
        (s.noseSneerLeft + s.noseSneerRight) / 2 + s.mouthShrugUpper * 0.5;
      b.noseTip.position.y = b.noseRestY + sneer * 0.45 + pose.roar * 0.35;
    }

    // Gaze: eyeballs follow the eyeLook coefficients.
    if (b.eyeGroupL) {
      const pitch =
        ((s.eyeLookDownLeft + s.eyeLookDownRight) -
          (s.eyeLookUpLeft + s.eyeLookUpRight)) * 0.5 * 0.30;
      b.eyeGroupL.rotation.x = pitch;
      b.eyeGroupR.rotation.x = pitch;
      b.eyeGroupL.rotation.y = (s.eyeLookInLeft - s.eyeLookOutLeft) * 0.35;
      b.eyeGroupR.rotation.y = (s.eyeLookOutRight - s.eyeLookInRight) * 0.35;
    }

    // Lip shapes: pucker/funnel purse the muzzle forward and narrow.
    if (b.muzzleGroup) {
      const purse = Math.max(s.mouthPucker, s.mouthFunnel);
      b.muzzleGroup.scale.x = 1 - purse * 0.1;
      b.muzzleGroup.position.z = b.muzzleRestZ + purse * 0.55;
    }

    // Roar: eyes flare, pupils narrow to slits.
    if (b.eyeMats) {
      const flare = 0.35 + pose.roar * 1.5;
      for (const m of b.eyeMats) m.emissiveIntensity = flare;
      if (b.pupils) {
        for (const p of b.pupils) p.scale.x = p.userData.baseX * (1 - pose.roar * 0.45);
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

/* ------------------------- procedural build --------------------------- */

export function buildProceduralTiger(mapping) {
  const group = new THREE.Group();
  group.name = "TigerHead(placeholder)";
  const M = makeMaterials();
  const bindings = {};

  /* Skull: wide, flat-fronted, fur-displaced. */
  const skullGeo = new THREE.SphereGeometry(9.4, 96, 64);
  {
    const pos = skullGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      let { x, y, z } = v;
      x *= 1.24;                          // broad cheeks
      if (z > 0) z *= 0.86;               // flat face
      y *= 0.92;                          // wider-than-tall head
      if (y > 0) y *= 0.94;               // flatter crown
      if (y < -3 && z > 2) z *= 0.82;     // clear room for muzzle/jaw
      pos.setXYZ(i, x, y, z);
    }
    skullGeo.computeVertexNormals();
  }
  furDisplace(skullGeo, 0.016, 0.9);
  const skull = new THREE.Mesh(skullGeo, M.fur);
  group.add(skull);

  /* Cheek ruff: two rings of tapered fur spikes framing the face. */
  const rand = mulberry32(0x77aa);
  for (const [radius, baseLen, z] of [[9.6, 5.2, -1.8], [10.4, 4.0, -0.6]]) {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + rand() * 0.08;
      if (Math.sin(a) > 0.72) continue; // crown stays clear for the ears
      const bottom = Math.sin(a) < -0.6; // shorter under the chin
      const len = (bottom ? baseLen * 0.5 : baseLen) * (0.75 + rand() * 0.4);
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(2.0 + rand() * 0.8, len, 7),
        M.fur
      );
      spike.position.set(
        Math.cos(a) * radius * 1.18,
        Math.sin(a) * radius * 0.88 - 1.2,
        z + rand() * 0.8
      );
      spike.rotation.z = a - Math.PI / 2 + (rand() - 0.5) * 0.25;
      spike.rotation.x = -0.12;
      spike.scale.z = 0.35;
      group.add(spike);
    }
  }

  /* Muzzle group (moves for pucker/funnel). */
  const muzzleGroup = new THREE.Group();
  const muzzleGeo = furDisplace(new THREE.SphereGeometry(4.9, 64, 48), 0.012, 1.1);
  const muzzle = new THREE.Mesh(muzzleGeo, M.fur);
  muzzle.position.set(0, -2.5, 7.0);
  muzzle.scale.set(1.3, 0.82, 1.0);
  muzzleGroup.add(muzzle);
  // Whisker pads.
  for (const side of [-1, 1]) {
    const pad = new THREE.Mesh(
      furDisplace(new THREE.SphereGeometry(2.5, 40, 28), 0.015, 1.4),
      M.fur
    );
    pad.position.set(side * 2.1, -2.1, 9.0);
    pad.scale.set(1.12, 0.78, 0.85);
    muzzleGroup.add(pad);
  }
  // Nose bridge (striped).
  const bridge = new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 24), M.fur);
  bridge.position.set(0, 0.9, 8.5);
  bridge.scale.set(1.05, 1.7, 0.75);
  muzzleGroup.add(bridge);
  // Nose: rounded triangle, glossy.
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.5, 28, 20), M.smoothGold);
  nose.position.set(0, -0.8, 10.8);
  nose.scale.set(1.35, 0.85, 0.6);
  muzzleGroup.add(nose);
  bindings.noseTip = nose;
  bindings.noseRestY = nose.position.y;
  group.add(muzzleGroup);
  bindings.muzzleGroup = muzzleGroup;
  bindings.muzzleRestZ = 0;

  /* Mouth interior + upper teeth. */
  const cavity = new THREE.Mesh(new THREE.SphereGeometry(3.7, 28, 20), M.innerMouth);
  cavity.position.set(0, -4.0, 5.0);
  cavity.scale.set(1.1, 0.9, 1.1);
  group.add(cavity);
  for (const side of [-1, 1]) {
    const canine = new THREE.Mesh(new THREE.ConeGeometry(0.68, 5.2, 14), M.enamel);
    canine.position.set(side * 2.6, -5.3, 8.2);
    canine.rotation.set(-0.1, 0, Math.PI + side * 0.1);
    group.add(canine);
  }
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.3, 10), M.enamel);
    t.position.set(i * 0.72, -4.7, 9.2 - Math.abs(i) * 0.25);
    t.rotation.x = Math.PI;
    group.add(t);
  }

  /* Jaw group — pivot at the hinge. */
  const jawGroup = new THREE.Group();
  jawGroup.position.set(0, -3.1, -0.8);
  const lowerJawGeo = furDisplace(new THREE.SphereGeometry(4.1, 48, 36), 0.012, 1.2);
  const lowerJaw = new THREE.Mesh(lowerJawGeo, M.fur);
  lowerJaw.position.set(0, -1.7, 6.9);
  lowerJaw.scale.set(1.12, 0.58, 1.1);
  jawGroup.add(lowerJaw);
  // Chin tuft.
  for (let i = -2; i <= 2; i++) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6 + Math.abs(i) * -0.3, 6), M.fur);
    tuft.position.set(i * 1.1, -3.3, 6.9 - Math.abs(i) * 0.4);
    tuft.rotation.x = Math.PI * 0.93;
    tuft.scale.z = 0.5;
    jawGroup.add(tuft);
  }
  for (const side of [-1, 1]) {
    const canine = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.6, 12), M.enamel);
    canine.position.set(side * 2.05, 0.7, 8.3);
    canine.rotation.z = side * -0.08;
    jawGroup.add(canine);
  }
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.05, 8), M.enamel);
    t.position.set(i * 0.66, 0.35, 8.8 - Math.abs(i) * 0.22);
    jawGroup.add(t);
  }
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(1.95, 28, 20), M.tongue);
  tongue.position.set(0, -0.8, 5.9);
  tongue.scale.set(0.95, 0.4, 1.5);
  jawGroup.add(tongue);
  group.add(jawGroup);
  bindings.jaw = jawGroup;
  bindings.jawRestX = 0.05;
  jawGroup.rotation.x = bindings.jawRestX;

  /* Eyes: dark rims, ivory ball, amber iris disc, slit pupil, gold lids. */
  bindings.eyeMats = [];
  bindings.pupils = [];
  const irisTex = makeIrisTexture();
  for (const side of [-1, 1]) {
    const socket = new THREE.Group();
    socket.position.set(side * 3.7, 2.1, 7.1);
    // Dark rim (eye liner as on the statue).
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.28, 12, 32), M.rim);
    rim.scale.set(1.08, 0.88, 0.5);
    rim.position.z = 0.65;
    socket.add(rim);

    const eyeGroup = new THREE.Group();
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0xf7ecd2,
      metalness: 0.35,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      emissive: 0xff9418,
      emissiveIntensity: 0.12,
      envMapIntensity: 1.2,
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.5, 40, 28), eyeMat);
    eyeGroup.add(ball);
    const iris = new THREE.Mesh(
      new THREE.CircleGeometry(1.3, 32),
      new THREE.MeshPhysicalMaterial({
        map: irisTex,
        metalness: 0.25,
        roughness: 0.2,
        clearcoat: 1.0,
        emissive: 0xdd7708,
        emissiveMap: irisTex,
        emissiveIntensity: 0.35,
      })
    );
    iris.position.z = 1.58;
    eyeGroup.add(iris);
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x0b0602 })
    );
    pupil.position.z = 1.62;
    pupil.scale.set(0.5, 1.0, 0.24);
    pupil.userData.baseX = 0.5;
    eyeGroup.add(pupil);
    socket.add(eyeGroup);
    group.add(socket);

    const lid = new THREE.Mesh(new THREE.SphereGeometry(1.78, 28, 20), M.fur);
    lid.position.set(side * 3.7, 2.25, 7.35);
    lid.scale.set(1.05, 0.12, 1.0);
    lid.visible = false;
    group.add(lid);

    bindings.eyeMats.push(eyeMat, iris.material);
    bindings.pupils.push(pupil);
    if (side === -1) {
      bindings.eyeGroupL = eyeGroup;
      bindings.eyelidL = lid;
    } else {
      bindings.eyeGroupR = eyeGroup;
      bindings.eyelidR = lid;
    }
  }

  /* Brow ridges. */
  bindings.browRestY = 4.15;
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(
      furDisplace(new THREE.SphereGeometry(1.9, 32, 22), 0.02, 1.5),
      M.fur
    );
    brow.position.set(side * 3.8, bindings.browRestY, 6.6);
    brow.scale.set(1.35, 0.42, 0.72);
    group.add(brow);
    if (side === -1) bindings.browL = brow;
    else bindings.browR = brow;
  }

  /* Ears: rounded solid tiger ears with dark inner cups. */
  for (const side of [-1, 1]) {
    const earGroup = new THREE.Group();
    earGroup.position.set(side * 6.9, 6.8, -1.2);
    earGroup.rotation.set(0.1, 0, side * -0.3);
    const outer = new THREE.Mesh(
      furDisplace(new THREE.SphereGeometry(3.3, 40, 30), 0.02, 1.2),
      M.fur
    );
    outer.scale.set(1.0, 1.3, 0.42);
    outer.position.y = 2.2;
    earGroup.add(outer);
    const innerEar = new THREE.Mesh(new THREE.SphereGeometry(2.3, 28, 20), M.darkGold);
    innerEar.scale.set(0.78, 1.0, 0.3);
    innerEar.position.set(0, 2.0, 1.1);
    earGroup.add(innerEar);
    group.add(earGroup);
    if (side === -1) {
      bindings.earL = earGroup;
      bindings.earLRest = earGroup.rotation.x;
    } else {
      bindings.earR = earGroup;
      bindings.earRRest = earGroup.rotation.x;
    }
  }

  /* Whiskers: 6 muzzle wires + 2 brow wires per side. */
  for (const side of [-1, 1]) {
    const wGroup = new THREE.Group();
    wGroup.position.set(side * 3.3, -2.0, 8.2);
    for (let i = 0; i < 6; i++) {
      const spread = (i - 2.5) * 0.45;
      const len = 9 + (i % 3) * 2 + i * 0.4;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, spread * 0.25, 0),
        new THREE.Vector3(side * len * 0.45, spread * 1.3 + 0.3, 1.1),
        new THREE.Vector3(side * len, spread * 2.6 - 0.6, 0.2),
      ]);
      wGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.075, 6), M.whisker));
    }
    group.add(wGroup);
    if (side === -1) bindings.whiskersL = wGroup;
    else bindings.whiskersR = wGroup;
  }

  // Anchor alignment: MediaPipe's face origin sits roughly behind the nose
  // bridge. Nudge the head back and up so it wraps the real skull.
  group.position.set(0, 1.0, -2.0);

  const root = new THREE.Group();
  root.add(group);
  root.name = "TigerHeadRoot";
  return new TigerHead(root, bindings, mapping);
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
    const wrapper = new THREE.Group();
    wrapper.add(root);
    wrapper.name = "TigerHeadRoot";
    console.info(
      `[AuruMask] Loaded model ${modelPath}: ${bindings.morphMeshes.length} morph mesh(es).`
    );
    return new TigerHead(wrapper, bindings, mapping);
  } catch (err) {
    console.warn(
      `[AuruMask] Failed to load ${modelPath} (${err.message}); using procedural placeholder.`
    );
    return buildProceduralTiger(mapping);
  }
}
