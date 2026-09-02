# AuruMask 🐯

A live augmented-reality **golden tiger** face mask. Point your front camera at
yourself and a photoreal-styled gold tiger head tracks your face: open your
mouth and the jaw roars, blink and it blinks, frown and the ears pin back.
Record takes with audio, export green-screen clean plates, and re-render takes
at 4K offline.

**This is the web edition** — it runs entirely in the browser, deploys to
Vercel in about two minutes, and you test it on your iPhone in Safari with no
Xcode and no app install. Everything after the first page load runs on-device;
there are no accounts, no analytics, and no server.

> The full native iOS app (ARKit + TrueDepth + RealityKit + HEVC/ProRes) is
> planned in [`docs/NATIVE_IOS_PLAN.md`](docs/NATIVE_IOS_PLAN.md). The web
> edition deliberately uses the **same 52-blendshape contract, the same
> `mapping.json`, and the same sidecar format**, so the tiger asset and persona
> tuning carry over 1:1.

---

## Deploy it on Vercel (non-engineer steps)

You need: this repository on GitHub (it already is), and a free
[vercel.com](https://vercel.com) account.

1. Go to **vercel.com** and click **Sign Up** → **Continue with GitHub**.
   Approve the popup that asks to connect your GitHub account.
2. On your Vercel dashboard, click **Add New… → Project**.
3. Find **Golden-Tiger** in the repository list and click **Import**.
   (If it isn't listed, click **Adjust GitHub App Permissions** and grant
   access to the repository.)
4. On the configure screen change **nothing** — if it asks for a Framework
   Preset, pick **Other**. Click **Deploy**.
5. Wait ~30 seconds. Vercel shows you a URL like
   `https://golden-tiger-xxxx.vercel.app`. Tap it — that's your app.

### Run it on your iPhone

1. Open that URL **in Safari** on your iPhone (camera access works best there).
2. Tap anywhere on the entry screen and allow camera access when asked.
3. Face the camera. The tiger head should lock onto your face within a second.
4. Optional: tap the **Share** button in Safari → **Add to Home Screen** to get
   an app-style icon that opens full screen.

### Run it locally on a computer (optional)

```bash
npm start        # serves the folder at http://localhost:3000
npm test         # runs the unit tests (persona mapping, sidecar, filters)
```

Camera access requires HTTPS **or** `localhost`, so the local server works on
the same machine; to test on a phone use the Vercel URL.

---

## Using the app

The viewport stays clean: just the render, the record button, and a drawer
handle at the bottom edge. Tap **anywhere** on the entry screen to start —
that single tap is the entire onboarding (the UX rationale, journey timings,
and wireframes live in [`docs/UX_ARCHITECTURE.md`](docs/UX_ARCHITECTURE.md)).
A dashed gold **alignment ring** guides you while no face is locked, fades
away on lock, and pulses back if tracking drops.

Everything secondary is in the **drawer** (tap the handle or swipe up):

| Control | What it does |
|---|---|
| **Red button** | Start/stop recording (video + your mic audio). Opening a recording closes the drawer. |
| **MASK** | Tiger on/off. |
| **STUDIO** | Studio light: consistent gold-flattering lighting. Off = the mask picks up your room's light color. |
| **PLATE** | Clean plate: renders the tiger over solid chroma green instead of your camera (for OBS/Resolve keying). |
| **HUD** | Telemetry: capture format, codec, render fps, tracking Hz, and live gauges (JAW, BROW, blinks, ROAR). Never appears in recordings. |
| **SMOOTH** | Tracking smoothing 0–100 % (one-euro filter). Default is low — responsiveness beats smoothness. |
| **SCALE** | Mask scale 100–130 % so the tiger fully covers your real head and hair. |
| **4K MASTER RENDER** | The offline re-render screen (see below). |

**After a take** you get two files:

- **Save video** — the composited recording. On iPhone this opens the share
  sheet: choose **Save Video** to put it in Photos.
- **Save tracking data (.json)** — the sidecar: per-frame timestamps, all 52
  blendshape coefficients, and the head transform. Keep it if you want a 4K
  version later.

**4K re-render**: drawer → **4K MASTER RENDER**, pick a saved tracking `.json`, choose resolution
and background, tap **Render**. The take replays through the same renderer at
up to 3840×2160 and saves a high-bitrate file. The UI says this plainly and
it bears repeating here: **live capture records at the camera's native
resolution; the 4K path is this offline re-render.**

---

## How it works

```
Front camera ──► MediaPipe FaceLandmarker (on-device, WASM/GPU)
                    │  52 ARKit-named blendshapes + 4×4 head transform
                    ▼
              One-euro smoothing (per coefficient + head pose)
                    │  FaceSignal
                    ▼
              PersonaMapping (pure JS, unit-tested, mapping.json-driven)
                    │  morph values · jaw angle · ear pose · roar envelope
                    ▼
              three.js stage ── gold tiger (procedural placeholder or your GLB)
                    │            spring-damper ears & whiskers · PBR gold
                    ▼
              One composite canvas ──► live view (mirrored)
                                   ├─► MediaRecorder (camera+mask+mic)
                                   └─► sidecar JSON (for 4K re-render)
```

- **Tracking**: MediaPipe's Face Landmarker emits the same blendshape names
  ARKit does (`jawOpen`, `browDownLeft`, …), which is why the asset contract
  is identical across web and native. One gap: `tongueOut` doesn't exist on
  the web tracker and stays 0 until the native app.
- **Persona logic** lives in [`mapping.json`](mapping.json): per-shape gains,
  roar threshold/hold, ear behavior, and the two spring constants
  (`stiffness`, `damping`) for ears and whiskers — metal whiskers are stiff
  and lightly damped so they ring; edit the JSON and redeploy, no code.
- **Getting a photoreal tiger**: see [`GET_A_TIGER.md`](GET_A_TIGER.md) —
  generate one from your reference image (Meshy/Tripo), download one free
  (Sketchfab), or commission the full rig. Static downloads are auto-fitted
  and **auto-jaw-rigged in code**, so mouth sync works with no 3D software.
- **The tiger**: until the final asset lands, a procedural gold tiger
  (stripes, fangs, emissive amber eyes, ruff, wire whiskers) is built in code
  against the same contract. Swap in the real model by placing a `.glb` in the
  repo and setting `MODEL_PATH` in [`js/config.js`](js/config.js) — one
  constant, per [`ASSET_CONTRACT.md`](ASSET_CONTRACT.md).
- **Recordings are unmirrored** (like the iPhone camera app); the live preview
  is mirrored (like a mirror). That's deliberate.

## Web-platform honesty (what the browser can't do)

Stated plainly rather than silently degraded:

- **No TrueDepth/occlusion geometry.** The web tracker is RGB-only. The mask
  covers your head via the Size slider instead of depth-tested occlusion.
  True occlusion arrives with the native ARKit app.
- **No HEVC `.mov` guarantee.** Browsers record via `MediaRecorder`: Safari
  produces `.mp4` (H.264/HEVC), Chrome produces `.webm`. The recorder picks
  the best container the device offers and the HUD shows which.
- **No ProRes.** The 4K export uses the browser's best encoder at 60 Mbps.
  ProRes belongs to the native `AVAssetWriter` pipeline.
- **Frame rate follows the camera.** Most phone browsers deliver 30 fps from
  `getUserMedia`; the HUD shows the real capture/render/tracking
  rates rather than promising 60.

## Repository layout

```
index.html            app shell (start gate, controls, sheets)
styles.css            dark minimal UI
mapping.json          persona tuning — edit freely, no code changes
js/config.js          MODEL_PATH + all constants
js/faceTracker.js     MediaPipe wrapper → FaceSignal
js/oneEuroFilter.js   temporal smoothing
js/personaMapping.js  signals → persona pose (pure, tested)
js/spring.js          spring-damper for ears/whiskers (pure, tested)
js/tigerModel.js      procedural tiger + GLB loader (contract binding)
js/sceneRenderer.js   three.js stage: video bg, lighting, anchoring, green screen
js/recorder.js        MediaRecorder + sidecar capture + share/download
js/exporter.js        offline 4K re-render from a sidecar
js/sidecar.js         sidecar serializer (pure, tested)
vendor/               vendored runtime deps (see below)
tests/                node --test suites
ASSET_CONTRACT.md     what the final tiger asset must contain
TESTING.md            manual on-device test checklist
docs/NATIVE_IOS_PLAN.md  the phased native ARKit/RealityKit plan
```

**Dependency justification** (the standards require it in writing): two
third-party runtime libraries are used, both vendored into `vendor/` at
pinned versions rather than fetched from CDNs — `three` 0.160.1 (the
de-facto standard web 3D renderer; writing raw WebGL here would be months of
non-product work) and `@mediapipe/tasks-vision` 0.10.14 plus its
`face_landmarker` model (the only production-grade in-browser face tracker
that emits ARKit-named blendshapes). Vendoring means the deployed app makes
**zero external network requests** — every byte is served from your own
Vercel origin and all inference runs on-device.
