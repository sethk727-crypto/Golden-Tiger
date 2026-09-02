# AuruMask — Manual Test Checklist

Run on a physical iPhone (Safari, iOS 17+) at the deployed Vercel URL.
Automated tests (`npm test`) cover PersonaMapping, the sidecar serializer,
and the filters; everything below is what only a human with a face can check.

## Startup

- [ ] Page loads over HTTPS; tap **Start camera** → permission prompt appears.
- [ ] Deny once → clear error toast with recovery hint; re-allow via
      Settings → Safari → Camera, reload, works.
- [ ] Tiger appears locked to your face within ~1 s of facing the camera.
- [ ] 📊 debug overlay shows capture resolution/fps, render fps, tracking fps,
      and a live `jawOpen` meter. Note the numbers for your device.

## Tracking & persona

Speak these phrases slowly, watching the muzzle/jaw — they cover the main
viseme groups:

- [ ] **"mama, papa"** — lips press and pop (jaw small, `mouthPress*`).
- [ ] **"wow"** — strong funnel/pucker shape, jaw swings open and closed.
- [ ] **"cheese"** — wide smile stretch, teeth line visible.
- [ ] Count "one two three four five" — jaw motion tracks syllables with no
      visible lag at Smooth = 20 %.

Expression checks:

- [ ] Blink each eye separately → matching eyelid closes (left/right correct
      in the mirrored preview).
- [ ] Raise brows (surprise) → ears perk up.
- [ ] Frown/scowl (brows down) → ears flatten back.
- [ ] Open mouth wide and **hold** ≥ ¼ s → roar engages: jaw over-rotates,
      eyes flare, pupils slit. Quick mouth pops must NOT trigger it.
- [ ] Shake your head quickly "no" → whiskers ring/oscillate briefly;
      ears wobble and settle (ears settle faster than whiskers).
- [ ] Turn head ±45°, tilt, nod — mask stays glued, no swimming.
- [ ] Walk to a window / change lighting with 💡 off → gold picks up the room
      tint. 💡 on → consistent studio gold regardless of room.

## Controls

- [ ] Smooth at 0 % → snappiest, slight jitter acceptable. At 100 % → visibly
      floaty. Default 20 % → good compromise.
- [ ] Size slider 100→130 % → tiger grows around the head; at your fit point
      your hair/ears disappear behind it.
- [ ] 🐯 toggles the mask; 🟩 swaps camera for flat green (mask + green only —
      **no camera pixels**); 📊 overlay never shows in recordings.

## Recording

- [ ] Record 10 s while talking → stop → **Save video** → share sheet →
      Save Video → appears in Photos, plays with audio in sync.
- [ ] Recording contains camera + tiger, **no UI, no debug overlay**, and is
      unmirrored (text behind you reads correctly).
- [ ] Record with 🟩 on → green background clip; key it in any editor.
- [ ] **Save tracking data (.json)** → file lands in Files/Downloads.
- [ ] During a 60 s recording, render fps (📊) stays at the pre-recording
      value; phone warm is OK, throttling collapse is a fail.

## 4K export

- [ ] **4K** → pick the saved `.json` → 3840×2160 + green → **Render** →
      progress bar advances in ~real time → file saves.
- [ ] Exported clip: jaw/blinks/roar match the original take; resolution is
      2160p (check in Photos → info or on a desktop).
- [ ] Export screen states that live capture is native-resolution and 4K is
      the offline path.
- [ ] Close during a render → cancels cleanly, live view resumes.

## Regression quickies (after any change)

- [ ] `npm test` green.
- [ ] Start → track → record → save → export: the golden path in one pass.
