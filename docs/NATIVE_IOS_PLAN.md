# AuruMask — Native iOS Plan (Phase N)

The web edition (this repo) is the fast feedback loop: it proves the persona,
the asset contract, and the tuning on your actual face with zero App Store
friction. The native app is where the platform-only capabilities land. This
document preserves the original phased plan and maps what carries over.

## What carries over from the web edition, unchanged

- **The 52-blendshape contract** (`js/blendshapeNames.js`) — identical names
  in ARKit's `ARFaceAnchor.BlendShapeLocation`.
- **`mapping.json`** — same schema read by a Swift `PersonaMapping` struct;
  gains, roar envelope, ear rules, spring constants transfer as-is.
- **The sidecar format** (`js/sidecar.js`) — same JSON the native recorder
  writes and the 4K re-renderer replays.
- **The tiger asset** — same master scene, exported `.usdz` per
  `ASSET_CONTRACT.md` (the web takes the `.glb` twin).
- **Persona tuning you validated live** — thresholds, spring feel, scale.

## What the native app adds (web can't)

| Capability | Native mechanism |
|---|---|
| True depth-tested head occlusion | `ARFaceTrackingConfiguration` occlusion mesh / `ARSCNFaceGeometry` depth write |
| Guaranteed 1080p60 (4K on Pro devices) | `ARFaceTrackingConfiguration.supportedVideoFormats` — pick max |
| HEVC `.mov` with mic audio to Photos | `AVAssetWriter` (HEVC) + `PHPhotoLibrary` |
| ProRes 4K offline re-render | `AVAssetWriter` ProRes 422 at 3840×2160/60 |
| `tongueOut` and full-fidelity coefficients | TrueDepth blendshapes |
| Thermal state in debug overlay | `ProcessInfo.thermalState` |
| Environment-texture reflections | ARKit environment texturing probes |

## Phases (as originally specified)

- **Phase 0 — Scaffold**: `xcodegen` project, SwiftUI lifecycle, permission
  strings, README with exact signing/run clicks for a non-engineer. Ends:
  raw front camera feed on device.
- **Phase 1 — Tracking online**: `ARFaceTrackingConfiguration`, highest
  supported format logged + debug overlay (resolution, fps, thermal,
  `jawOpen`). Blendshapes → `FaceSignal` actor with one-euro smoothing,
  strength user-adjustable 0–100 %, default low.
- **Phase 2 — Mask rendering**: RealityKit entity on the face anchor, all 52
  coefficients → morph targets by name, additive jaw rotation past
  `jawOpen > 0.7`, occlusion geometry, mask scale 100–130 %, environment
  texturing ON + bundled HDR "studio look".
  *(Fallback note: if RealityKit's morph-target API proves insufficient on
  iOS 17, SceneKit `SCNMorpher` is the sanctioned fallback — justify in the
  phase summary.)*
- **Phase 3 — Persona logic**: Swift `PersonaMapping` (pure, unit-tested)
  reading the same `mapping.json`; spring-damper ears/whiskers from head
  angular velocity.
- **Phase 4 — Recording**: composited HEVC .mov + mic → Photos; sustain the
  session's native frame rate on iPhone 13+; signpost profiling; clean-plate
  green toggle.
- **Phase 5 — 4K offline re-render**: sidecar JSON per take; export screen
  replaying through the same render stack offscreen at 3840×2160/60 to
  ProRes/high-bitrate HEVC. UI explicit that live capture is sensor-native.
- **Phase 6 — Polish**: minimal dark UI (same layout as the web edition),
  app icon, final README pass.

## Engineering standards (unchanged)

Swift concurrency (`async/await`, actor recording pipeline), no third-party
dependencies without written justification, unit tests for `PersonaMapping`
and the sidecar serializer, `TESTING.md` manual checklist (the web edition's
checklist is the template), every phase ends buildable and runnable.
