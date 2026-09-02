# Getting the Real Tiger Model

The app ships with a procedural gold tiger built in code. To go photoreal you
drop in a downloaded or generated `.glb` — and since real downloads are
usually **static** (no facial rig), the app now includes a **universal
adapter**: any static `.glb` is automatically scaled and centered to head
size, and a jaw is **auto-rigged in code** (the lower-front of the model is
skinned to a generated jaw bone), so **mouth sync works with zero 3D-software
work**. Blinks, ears, and the full 52 expressions still require the authored
asset described in [`ASSET_CONTRACT.md`](ASSET_CONTRACT.md) — that's the
final-quality tier.

## Option A — Generate it from your reference image (fastest, ~5 minutes)

AI image-to-3D services turn your golden-tiger reference picture into a
textured 3D model. This is the closest match to *your* exact tiger:

1. Go to **[Meshy](https://www.meshy.ai)**, **[Tripo](https://www.tripo3d.ai)**,
   or **[Rodin / Hyper3D](https://hyper3d.ai)** (all have free credits).
2. Choose *Image to 3D*, upload your tiger image (a head-on shot works best;
   crop to just the head if you can).
3. Generate, then **download as `.glb`** (pick the highest quality / textured
   option).
4. Add it to the app (see "Install the file" below).

Tip: generate from the **open-mouth** reference — the auto-jaw rig looks
best when the model already has a visible mouth opening and teeth.

## Option B — Download a ready-made model (free)

**[Sketchfab](https://sketchfab.com)** (free account required to download):

- ["Tiger Roar" by operabook555](https://sketchfab.com/3d-models/tiger-roar-563686c6b79f478182b86c5fefffcf06) —
  realistic sculpt with an open roaring mouth; downloadable `.glb`.
- ["Tiger head" by Pedro B. Goulart](https://sketchfab.com/3d-models/tiger-head-5b98e6b4e98e4a2bb27bed44887de723) — free download.
- Browse more: [sketchfab.com/tags/tiger-head](https://sketchfab.com/tags/tiger-head) —
  filter by **Downloadable**.

**Check the license badge on each model page**: CC0 = do anything; CC-BY =
credit the artist (a line in your README/app is enough); **CC-BY-NC = no
commercial use** (fine for personal experiments, not for a paid app).
A full-body tiger works too — the auto-fit will size it, but a **head or
bust reads much better** on a face.

Also free/CC0 but stylized (low-poly, not realistic): [Quaternius animal
packs](https://quaternius.com) and [poly.pizza](https://poly.pizza).

## Option C — Buy or commission (best quality)

- **Buy**: [CGTrader](https://www.cgtrader.com) or
  [TurboSquid](https://www.turbosquid.com) — search "tiger head", filter
  glTF/GLB or FBX (FBX converts to GLB in Blender in one export). $10–80
  for excellent sculpts. Royalty-free licenses allow app use.
- **Commission the full contract asset** (the 52-blendshape rig from
  `ASSET_CONTRACT.md`): find a character/rigging artist on
  [Fiverr](https://www.fiverr.com) or [ArtStation](https://www.artstation.com/marketplace)
  — search **"ARKit blendshapes"** or "face rig morph targets". Hand them
  `ASSET_CONTRACT.md` as the spec; it contains everything they need.
  This unlocks blinks, brows, lips, ears — the works.

## Install the file

1. Put the file in the repo as `assets/tiger.glb` (on GitHub: **Add file →
   Upload files** inside an `assets` folder).
2. Edit `js/config.js`: `export const MODEL_PATH = "/assets/tiger.glb";`
3. Commit — Vercel redeploys automatically.

**Preview without committing**: host the file anywhere in the repo and open
`https://your-app.vercel.app/?model=/assets/tiger.glb` — the `?model=` URL
parameter overrides `MODEL_PATH` for that visit.

**If it loads wrong**: facing backwards / too small / off-center → tweak
`MODEL_ADJUST` in `js/config.js` (`rotateYDeg: 180`, `scale`, `offset`) —
no Blender needed. The browser console logs what the auto-fit and auto-jaw
rig decided.

## What each tier gets you

| Tier | Mouth sync | Blinks/brows/ears | Look |
|---|---|---|---|
| Procedural (shipped) | ✅ full | ✅ approximated | stylized gold |
| Static download + auto-rig | ✅ jaw | ❌ | as good as the model |
| Contract asset (commissioned) | ✅ full 52 shapes | ✅ | final quality |
