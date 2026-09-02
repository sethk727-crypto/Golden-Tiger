# AuruMask — UX Architecture

How the four product principles map onto the shipped app, with the exact
user journey, wireframes, and the platform constraints stated honestly.

Positioning frame: AuruMask is presented as a **theatrical mask engine /
creator avatar utility**, not a toy filter. Concretely that means: recording-
software conventions (telemetry gauges, monospace type, a serious record
button), zero cartoon chrome, and copy that talks about takes, plates, and
masters — not "fun filters".

---

## 1. Straight-line onboarding

**Principle**: every step between launch and the "aha" (seeing yourself as
the gold tiger) is ability debt. Remove all of it that the platform allows.

**The one red light we cannot remove**: browsers refuse camera access
without a user gesture (a security requirement, not a design choice). So the
entry screen is a single full-screen button — the whole screen is the tap
target — and that tap is the entire onboarding. No profiles, no walls, no
tutorial cards, no permission pre-prompts.

**What the tap costs is only the permission dialog**, because everything
else preloads while the entry screen is visible:

| t (from page load) | What happens | User sees |
|---|---|---|
| 0 ms | Page paints; preload starts (tracker WASM + model, tiger build, renderer, mapping.json) | Entry screen: wordmark, breathing gold ring, "TAP TO ENTER" |
| ~1–3 s | Preload completes in the background (cached: < 500 ms) | Same screen — no spinner, nothing to wait for |
| **T** (user taps) | `getUserMedia` — the only gesture-gated call | OS camera permission dialog (first run only) |
| T + ~200 ms | Camera stream live, preload already resolved | Own face, full screen |
| T + ~300–700 ms | First face lock → tiger snaps on, alignment ring fades | **Aha: the golden tiger head, tracking** |

Target: **tap → tiger in under 1 second** on an iPhone 12 or newer (repeat
visit, permission already granted). The HUD's TRK rate verifies it live.

## 2. The alignment ring (product bumper)

No tutorial text, no error dialogs. A dashed gold face-outline ellipse:

- **Shown** on entry (before the first lock) with the microcopy
  "CENTER YOUR FACE" — it demonstrates the fix, not the failure.
- **Fades out** (350 ms) the moment tracking locks — progressive disclosure:
  when the product works, only the product is on screen.
- **Returns with a pulse** if tracking is lost for > 600 ms (turned away,
  covered camera, left frame), and a short vibration where the platform has
  it. No "tracking lost" alerts, ever.

**Haptics honesty**: iOS Safari has no vibration/haptics API. On iPhone the
"pulse" is visual (the ring's 1.8 s breathe animation); `navigator.vibrate`
fires on Android Chrome. True CoreHaptics cues are specified for the native
app (docs/NATIVE_IOS_PLAN.md).

State machine (implemented in `updateAlignRing`, js/main.js):

```
        first lock            lock lost > 600 ms
SEARCHING ────────► LOCKED ────────────────────► SEARCHING (pulse + vibrate)
 ring on   fade out  ring off      ring back on
```

## 3. Progressive disclosure — the theatrical cockpit

The permanent viewport carries exactly three things: the composited render,
the record button, and a 4 px drawer handle. Everything else is deferred:

- **Bottom drawer** (glassmorphic, blur + gold accents; tap the handle or
  swipe up): MASK / STUDIO / PLATE / HUD toggles, SMOOTH and SCALE sliders,
  and the 4K MASTER RENDER action. Starting a recording auto-closes it.
- **Telemetry HUD** (off by default, toggled in the drawer): capture format,
  codec, render fps, tracking Hz, lock state, and live gauges for JAW, BROW,
  BLK·L/R and the ROAR envelope. Monospace, top-left, DOM-only — it can
  never appear in a recording by construction.
- **Sheets** (post-take save, 4K export) appear only in response to a user
  action and dismiss to a clean viewport.

## 4. Wireframes & layout spec

Idle (locked, drawer closed):          Searching (no lock):

┌──────────────────────────┐           ┌──────────────────────────┐
│                          │           │      ·· ─ ─ ─ ··         │
│                          │           │    ·             ·       │
│                          │           │   ·   (dashed     ·      │
│      [tiger on face]     │           │   ·    gold       ·      │
│                          │           │    ·   ellipse)  ·       │
│                          │           │      ·· ─ ─ ─ ··         │
│                          │           │    CENTER YOUR FACE      │
│           (●)            │           │           (●)            │
│         ━━━━━━           │           │         ━━━━━━           │
└──────────────────────────┘           └──────────────────────────┘

Drawer open:                           HUD on (top-left):

┌──────────────────────────┐           ┌──────────────────────────┐
│                          │           │┌────────────────┐        │
│      [tiger on face]     │           ││CAM 1280x720·30 │        │
│                          │           ││RDR 60fps TRK 57│        │
│           (●)            │           ││JAW  ▓▓▓▓▓░ 0.48│        │
│ ┌──────────────────────┐ │           ││BROW ▓░░░░░ 0.12│        │
│ │ MASK STUDIO PLATE HUD│ │           ││ROAR ▓▓░░░░ 0.31│        │
│ │ SMOOTH ───●────── 20 │ │           │└────────────────┘        │
│ │ SCALE  ─────●──── 112│ │           │                          │
│ │ [ 4K MASTER RENDER ] │ │           │           (●)            │
│ └──────────────────────┘ │           │         ━━━━━━           │
└──────────────────────────┘           └──────────────────────────┘

| Element | Position | Size | Behavior |
|---|---|---|---|
| Record button | bottom center, 58 px above safe area | 74 px ⌀ | tap toggles; morphs to rounded square while recording |
| Rec timer | top center | pill | visible only while recording |
| Drawer handle | bottom edge, full width | 34 px tall | tap/swipe-up opens; swipe-down closes |
| Drawer body | bottom sheet | ≤ 430 px wide | toggles row, 2 sliders, 1 action; auto-closes on record |
| Alignment ring | viewport center | min(62vw, 340px) | dashed ellipse, 1.8 s pulse, 350 ms fade |
| HUD | top-left safe area | ~205 px | monospace panel, 20 Hz refresh, DOM-only |
| Toast | top center | pill | transient status, 3.2 s |

## 5. What deliberately does NOT exist

- No launch/splash/landing screen beyond the tap gate the browser mandates.
- No account, profile, email, or name entry anywhere.
- No tutorial overlay, coach marks, or text-heavy cards.
- No settings screen — the drawer is the entire settings surface.
- No error dialogs for tracking loss — the ring is the recovery UI.
- No visible telemetry by default — the render is the interface.
