# AuruMask Asset Contract — the Golden Tiger

This document defines **exactly** what the final tiger export must contain so
that swapping it in is drop-in: change `MODEL_PATH` in `js/config.js`
(web) or `TigerAsset.path` (native, later) and nothing else.

Two deliverables from the same Blender scene:

| Target | Format | Used by |
|---|---|---|
| Web edition (this repo) | **`.glb`** (glTF binary, embedded textures) | `js/tigerModel.js` via GLTFLoader |
| Native iOS (later phase) | **`.usdz`** | RealityKit |

Blender exports both (glTF is built in; USD via File → Export → USD, then
`usdzip`/Reality Converter). Keep one master scene; export twice.

---

## 1. Scale, units, orientation

- **Units: meters** in the master scene. A real tiger head: the skull shell
  should be ~**0.24 m wide, 0.22 m tall, 0.26 m deep** (slightly larger than
  a human head — the app adds 100–130 % user scaling on top, so author at
  anatomical fit, not oversized).
- **Origin** at the point that should sit at the tracked face origin — the
  skull center directly behind the nose bridge (roughly between the ears,
  4–5 cm behind the eyes). Get this right; it is the single most common
  reason a mask "floats".
- **Forward axis: +Z** (face/nose pointing +Z), **up: +Y** in the exported
  glTF/USDZ. (In Blender author -Y forward / +Z up as usual and let the glTF
  exporter's defaults handle the conversion — verify in a glTF viewer that
  the tiger looks at the camera at identity transform.)
- Apply all transforms before export (Ctrl+A → All Transforms). No
  non-uniform scale on bones.

## 2. Morph targets (shape keys) — the blendshape contract

- **All 52 ARKit blendshape identifiers, named exactly** — the full list is
  in [`js/blendshapeNames.js`](js/blendshapeNames.js): `jawOpen`,
  `browDownLeft`, `browDownRight`, `browInnerUp`, `eyeBlinkLeft`,
  `eyeBlinkRight`, `mouthSmileLeft`, … through `tongueOut`.
- Case-sensitive, no prefixes, no namespacing (`jawOpen`, **not**
  `Key.jawOpen` or `JawOpen`).
- Neutral (all zeros) must be the resting sculpt.
- Each target is authored at **coefficient = 1.0** (fully engaged). The app
  feeds 0–1 continuously; in-betweens are linear.
- Export with **shape key normals** and check "Export Deformation Bones" +
  "Shape Keys" in the glTF exporter.
- Note for the web tracker: `tongueOut` is never driven (MediaPipe lacks
  it) — author it anyway; the native app uses it.

## 3. Skeleton

Required bones, named exactly:

```
head                    root of the head rig (child of armature root)
└── jaw                 pivot at the jaw hinge (below/behind the ear canal)
├── ear.L  → exported as ear_L
├── ear.R  → exported as ear_R
├── whiskers.L → whiskers_L   (one bone per side is enough; the app rotates
└── whiskers.R → whiskers_R    the group — individual whisker bones optional)
```

- Blender's `.L/.R` suffixes become `_L/_R` in glTF depending on exporter
  settings — **the app binds `jaw`, `ear_L`, `ear_R`, `whiskers_L`,
  `whiskers_R`**, so verify the exported names (open the .glb in a viewer or
  rename in Blender to use underscores directly).
- `jaw` rest pose = mouth closed. The app **adds** rotation around the bone's
  local X for the roar range on top of the `jawOpen` morph, so keep the jaw
  skinned to the bone even though `jawOpen` also exists as a morph.
- Ears/whiskers get spring-driven rotation added at runtime — skin them
  fully to their bones (no partial weights bleeding into the skull).

## 4. Materials & textures (PBR metal-rough)

One primary material (`tiger_gold`) with these slots, all as embedded PNGs
(or JPEG for baseColor if flawless):

| Slot | Content | Resolution |
|---|---|---|
| baseColor | gold with dark stripe pattern | 4096² max |
| normal | fur/sculpt detail (OpenGL convention, +Y green) | 4096² |
| metallicRoughness | **packed**: G = roughness, B = metallic (glTF standard) | 2048² |
| occlusion (AO) | may share the metallicRoughness texture's R channel | 2048² |
| emissive | **eyes only** — amber iris glow; black elsewhere | 1024² |

- Metallic ≈ 1.0 on the gold; roughness ~0.2–0.35 with variation in stripes.
- Eyes may be a second material if the emissive needs its own intensity.
- No transparency except (optionally) whisker tips; alpha-blended fur cards
  will sort badly — prefer opaque geometry.

## 5. Budget & hygiene

- **≤ 120 000 triangles** total (the web edition is happiest ≤ 80 k).
- ≤ 2 materials, ≤ 6 textures, no 8k maps.
- Single mesh for the morphing head (morph targets on multiple meshes work
  but keep it to head + eyes at most).
- No animations baked in the file (the app drives everything).
- No lights, no cameras, no extra nodes in the export.
- File size target: ≤ 25 MB `.glb`.

## 6. How to verify before sending

1. Drop the `.glb` into https://gltf-viewer.donmccurdy.com/ — check
   orientation (facing you), scale (~0.25 m), materials, and that the morph
   target list shows all 52 names.
2. In the repo: set `MODEL_PATH` in `js/config.js` to the file's path (e.g.
   `"/assets/tiger.glb"`, with the file committed under `assets/`), deploy,
   open the app, enable the 📊 debug overlay, and speak — `jawOpen` should
   move the jaw with no other setup.
3. The browser console logs
   `[AuruMask] Loaded model …: N morph mesh(es)` on success, or a warning +
   procedural fallback on any mismatch.
