// AuruMask entry point: owns the camera, the render loop, and the UI wiring.
//
// UX architecture (docs/UX_ARCHITECTURE.md):
// - Straight-line onboarding: every heavy asset (tracker WASM + model, tiger,
//   renderer, mapping) preloads while the entry screen shows. The single tap
//   pays only the browser-mandated camera-permission gesture.
// - Bumper: the alignment ring shows while no face is locked, fades on lock,
//   pulses back on tracking loss (with vibration where the platform has it).
// - Progressive disclosure: the viewport carries the record button and a
//   drawer handle; everything secondary lives in the drawer.

import * as THREE from "three";
import {
  MODEL_PATH,
  MAPPING_PATH,
  VIDEO_CONSTRAINTS,
  MASK_SCALE_DEFAULT,
  SMOOTHING_DEFAULT,
} from "./config.js";
import { FaceTracker } from "./faceTracker.js";
import { PersonaMapping, normalizeMapping, DEFAULT_MAPPING } from "./personaMapping.js";
import { loadTigerModel } from "./tigerModel.js";
import { SceneRenderer } from "./sceneRenderer.js";
import { TakeRecorder, deliverFile, takeName } from "./recorder.js";
import { Exporter } from "./exporter.js";

const $ = (id) => document.getElementById(id);

const els = {
  canvas: $("render-canvas"),
  video: $("camera-video"),
  startOverlay: $("start-overlay"),
  startHint: $("start-hint"),
  controls: $("controls"),
  alignRing: $("align-ring"),
  hud: $("hud"),
  hudFormat: $("hud-format"),
  hudRates: $("hud-rates"),
  gauges: {
    jaw: [$("g-jaw"), $("v-jaw")],
    brow: [$("g-brow"), $("v-brow")],
    blinkl: [$("g-blinkl"), $("v-blinkl")],
    blinkr: [$("g-blinkr"), $("v-blinkr")],
    roar: [$("g-roar"), $("v-roar")],
  },
  drawer: $("drawer"),
  drawerHandle: $("drawer-handle"),
  btnMask: $("btn-mask"),
  btnStudio: $("btn-studio"),
  btnGreen: $("btn-green"),
  btnHud: $("btn-hud"),
  btnExport: $("btn-export"),
  sliderSmooth: $("slider-smooth"),
  sliderScale: $("slider-scale"),
  valSmooth: $("val-smooth"),
  valScale: $("val-scale"),
  btnRecord: $("btn-record"),
  recTime: $("rec-time"),
  saveSheet: $("save-sheet"),
  saveSummary: $("save-summary"),
  btnSaveVideo: $("btn-save-video"),
  btnSaveSidecar: $("btn-save-sidecar"),
  btnDismissSave: $("btn-dismiss-save"),
  exportSheet: $("export-sheet"),
  exportFile: $("export-file"),
  exportFileName: $("export-file-name"),
  exportRes: $("export-res"),
  exportBg: $("export-bg"),
  exportProgress: $("export-progress"),
  exportProgressFill: $("export-progress-fill"),
  btnRunExport: $("btn-run-export"),
  btnCloseExport: $("btn-close-export"),
  toast: $("toast"),
};

const state = {
  running: false,
  maskOn: true,
  studio: true,
  green: false,
  hud: false,
  lastFrameTime: 0,
  renderFps: 0,
  fpsWindow: [],
  frameCounter: 0,
  lastTake: null,
  sidecarText: null,
  captureFps: 30,
  lastPose: null,
  // Ring state machine.
  ringVisible: true,
  lastLockAt: -Infinity,
  everLocked: false,
};

let tracker, persona, tiger, sceneRenderer, recorder, exporter, mapping;

function toast(msg, ms = 3200) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (els.toast.hidden = true), ms);
}

function vibrate(pattern) {
  // Android Chrome only; iOS Safari has no vibration API (see UX doc).
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}

async function loadMapping() {
  try {
    const res = await fetch(MAPPING_PATH, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeMapping(await res.json());
  } catch (err) {
    console.warn("[AuruMask] mapping.json unavailable, using defaults:", err.message);
    return normalizeMapping(DEFAULT_MAPPING);
  }
}

// ---- Preload: starts at page load, before the entry tap ----
// Only getUserMedia needs a user gesture; everything else warms up now so the
// tap-to-tiger path is as short as the platform allows.
const preload = (async () => {
  mapping = await loadMapping();
  sceneRenderer = new SceneRenderer(els.canvas);
  tracker = new FaceTracker();
  const [tigerHead] = await Promise.all([
    loadTigerModel(MODEL_PATH, mapping),
    tracker.init(),
  ]);
  tiger = tigerHead;
  sceneRenderer.setTiger(tiger);
  persona = new PersonaMapping(mapping);
  recorder = new TakeRecorder(els.canvas);
  exporter = new Exporter(sceneRenderer, tiger, mapping);
  console.info("[AuruMask] Preload complete (tracker + tiger + renderer).");
})();
preload.catch((err) => {
  console.error("[AuruMask] Preload failed:", err);
  toast(`Load failed: ${err.message}`, 8000);
});

async function start() {
  els.startOverlay.disabled = true;
  els.startHint.textContent = "STARTING…";

  try {
    // The gesture-fresh call: camera permission.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: VIDEO_CONSTRAINTS,
      audio: false,
    });
    els.video.srcObject = stream;
    await els.video.play();
    await new Promise((r) => {
      if (els.video.videoWidth) return r();
      els.video.onloadedmetadata = r;
    });

    const settings = stream.getVideoTracks()[0].getSettings();
    state.captureFps = settings.frameRate || 30;
    console.info(
      `[AuruMask] Capture format: ${settings.width}x${settings.height}@${settings.frameRate}fps`
    );

    await preload; // usually already resolved by the time the user taps
    sceneRenderer.attachVideo(els.video);

    // Defaults.
    setSmoothing(SMOOTHING_DEFAULT);
    els.sliderSmooth.value = Math.round(SMOOTHING_DEFAULT * 100);
    els.valSmooth.textContent = els.sliderSmooth.value;
    sceneRenderer.setMaskScale(MASK_SCALE_DEFAULT);
    els.sliderScale.value = Math.round(MASK_SCALE_DEFAULT * 100);
    els.valScale.textContent = els.sliderScale.value;
    sceneRenderer.setStudioLook(true);

    // Automation/debug hook (harmless in production, no UI surface).
    window.__aurumask = { sceneRenderer, tiger, persona, tracker, recorder };

    els.startOverlay.hidden = true;
    els.controls.hidden = false;
    els.alignRing.hidden = false; // bumper on until first lock
    state.running = true;
    state.lastFrameTime = performance.now();
    loopToken++;
    requestAnimationFrame((t) => loop(t, loopToken));
  } catch (err) {
    console.error(err);
    els.startOverlay.disabled = false;
    els.startHint.textContent = "TAP TO ENTER";
    toast(
      err.name === "NotAllowedError"
        ? "Camera permission denied. Enable it in Settings → Safari → Camera."
        : `Could not start: ${err.message}`,
      6000
    );
  }
}

function setSmoothing(strength) {
  tracker.setSmoothing(strength);
  sceneRenderer.setRotationSmoothing(strength);
}

let loopToken = 0;

function loop(now, token = loopToken) {
  if (!state.running || token !== loopToken) return;
  const dt = Math.min(0.1, (now - state.lastFrameTime) / 1000);
  state.lastFrameTime = now;
  state.frameCounter++;

  state.fpsWindow.push(now);
  while (state.fpsWindow.length && now - state.fpsWindow[0] > 1000) {
    state.fpsWindow.shift();
  }
  state.renderFps = state.fpsWindow.length;

  const signal = tracker.detect(els.video, now);

  if (signal?.tracked && signal.matrix) {
    const angVel = sceneRenderer.updateFaceTransform(signal.matrix, dt);
    const pose = persona.update(signal);
    state.lastPose = pose;
    tiger.applyPose(pose, angVel, dt);
    if (recorder.isRecording) {
      recorder.captureFrame(now / 1000, signal.shapes, signal.matrix);
    }
  }

  updateAlignRing(!!signal?.tracked, now);
  sceneRenderer.updateAdaptiveLighting();
  sceneRenderer.render();

  if (state.hud && state.frameCounter % 3 === 0) updateHud(signal);
  if (recorder.isRecording) updateRecTime();

  requestAnimationFrame((t) => loop(t, token));
}

// ---- Alignment ring state machine ----
// Locked → ring fades out. Unlocked > 600ms → ring returns with a pulse.
function updateAlignRing(tracked, now) {
  if (tracked) {
    state.lastLockAt = now;
    if (state.ringVisible) {
      state.ringVisible = false;
      els.alignRing.classList.add("fading");
      setTimeout(() => {
        if (!state.ringVisible) els.alignRing.hidden = true;
      }, 380);
      if (!state.everLocked) {
        state.everLocked = true;
        vibrate(12); // "the mask is on" — where the platform supports it
      }
    }
  } else if (
    !state.ringVisible &&
    state.everLocked &&
    now - state.lastLockAt > 600
  ) {
    state.ringVisible = true;
    els.alignRing.hidden = false;
    // Force a reflow so the fade-in transition restarts cleanly.
    void els.alignRing.offsetWidth;
    els.alignRing.classList.remove("fading");
    vibrate([10, 60, 10]);
  }
}

// ---- Telemetry HUD ----
function updateHud(signal) {
  const v = els.video;
  const s = signal?.shapes ?? {};
  els.hudFormat.textContent =
    `CAM ${v.videoWidth}x${v.videoHeight}·${Math.round(state.captureFps)}  ` +
    `${recorder?.mimeType?.split(";")[0] ?? "n/a"}`;
  els.hudRates.textContent =
    `RDR ${String(state.renderFps).padStart(2)}fps  ` +
    `TRK ${String(tracker.trackingFps).padStart(2)}Hz  ` +
    `${signal?.tracked ? "LOCK" : "····"}`;
  setGauge("jaw", s.jawOpen ?? 0);
  setGauge("brow", ((s.browDownLeft ?? 0) + (s.browDownRight ?? 0)) / 2);
  setGauge("blinkl", s.eyeBlinkLeft ?? 0);
  setGauge("blinkr", s.eyeBlinkRight ?? 0);
  setGauge("roar", state.lastPose?.roar ?? 0);
}

function setGauge(name, value) {
  const [bar, label] = els.gauges[name];
  bar.style.width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  label.textContent = value.toFixed(2);
}

function updateRecTime() {
  const s = Math.floor((performance.now() - recorder.startedAt) / 1000);
  els.recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---- Recording ----

async function toggleRecord() {
  if (!recorder.isRecording) {
    try {
      await recorder.start(
        {
          width: els.canvas.width,
          height: els.canvas.height,
          fps: Math.round(state.captureFps),
        },
        true
      );
      els.btnRecord.classList.add("recording");
      els.recTime.hidden = false;
      setDrawer(false); // clean viewport while rolling
      vibrate(8);
    } catch (err) {
      toast(`Recording failed: ${err.message}`, 5000);
    }
  } else {
    const take = await recorder.stop();
    els.btnRecord.classList.remove("recording");
    els.recTime.hidden = true;
    vibrate(8);
    if (take) {
      state.lastTake = take;
      els.saveSummary.textContent =
        `${(take.videoBlob.size / 1e6).toFixed(1)} MB video (.${take.extension})` +
        ` · ${take.frameCount} tracked frames`;
      els.saveSheet.hidden = false;
    }
  }
}

// ---- Drawer ----
function setDrawer(open) {
  els.drawer.classList.toggle("open", open);
}

els.drawerHandle.addEventListener("click", () => {
  setDrawer(!els.drawer.classList.contains("open"));
});
// Swipe on the drawer: up opens, down closes.
let touchStartY = null;
els.drawer.addEventListener("touchstart", (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });
els.drawer.addEventListener("touchend", (e) => {
  if (touchStartY === null) return;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (dy < -24) setDrawer(true);
  else if (dy > 24) setDrawer(false);
  touchStartY = null;
}, { passive: true });

// ---- UI wiring ----

els.startOverlay.addEventListener("click", start);
els.btnRecord.addEventListener("click", toggleRecord);

els.btnMask.addEventListener("click", () => {
  state.maskOn = !state.maskOn;
  sceneRenderer.setMaskVisible(state.maskOn);
  els.btnMask.dataset.active = state.maskOn;
});
els.btnStudio.addEventListener("click", () => {
  state.studio = !state.studio;
  sceneRenderer.setStudioLook(state.studio);
  els.btnStudio.dataset.active = state.studio;
});
els.btnGreen.addEventListener("click", () => {
  state.green = !state.green;
  sceneRenderer.setGreenScreen(state.green);
  els.btnGreen.dataset.active = state.green;
});
els.btnHud.addEventListener("click", () => {
  state.hud = !state.hud;
  els.hud.hidden = !state.hud;
  els.btnHud.dataset.active = state.hud;
});

els.sliderSmooth.addEventListener("input", () => {
  els.valSmooth.textContent = els.sliderSmooth.value;
  setSmoothing(Number(els.sliderSmooth.value) / 100);
});
els.sliderScale.addEventListener("input", () => {
  els.valScale.textContent = els.sliderScale.value;
  sceneRenderer.setMaskScale(Number(els.sliderScale.value) / 100);
});

// Save sheet.
els.btnSaveVideo.addEventListener("click", async () => {
  const t = state.lastTake;
  if (!t) return;
  const how = await deliverFile(t.videoBlob, takeName("aurumask", t.extension));
  if (how === "shared") toast("Use “Save Video” in the share sheet for Photos");
});
els.btnSaveSidecar.addEventListener("click", async () => {
  const t = state.lastTake;
  if (!t) return;
  await deliverFile(t.sidecarBlob, takeName("aurumask-tracking", "json"));
});
els.btnDismissSave.addEventListener("click", () => (els.saveSheet.hidden = true));

// Export sheet.
els.btnExport.addEventListener("click", () => {
  setDrawer(false);
  els.exportSheet.hidden = false;
});
els.btnCloseExport.addEventListener("click", () => {
  exporter?.abort();
  els.exportSheet.hidden = true;
});
els.exportFile.addEventListener("change", async () => {
  const file = els.exportFile.files?.[0];
  if (!file) return;
  state.sidecarText = await file.text();
  els.exportFileName.textContent = file.name;
  els.btnRunExport.disabled = false;
});
els.btnRunExport.addEventListener("click", async () => {
  if (!state.sidecarText) return;
  const [w, h] = els.exportRes.value.split("x").map(Number);
  els.btnRunExport.disabled = true;
  els.exportProgress.hidden = false;
  state.running = false; // pause the live loop; exporter drives the renderer
  try {
    const result = await exporter.export(state.sidecarText, {
      width: w,
      height: h,
      background: els.exportBg.value,
      onProgress: (p) =>
        (els.exportProgressFill.style.width = `${Math.round(p * 100)}%`),
    });
    await deliverFile(
      result.blob,
      takeName(`aurumask-${h}p`, result.extension)
    );
    toast("Export complete");
  } catch (err) {
    toast(`Export failed: ${err.message}`, 5000);
  } finally {
    els.exportProgress.hidden = true;
    els.exportProgressFill.style.width = "0%";
    els.btnRunExport.disabled = false;
    state.running = true;
    state.lastFrameTime = performance.now();
    loopToken++;
    requestAnimationFrame((t) => loop(t, loopToken));
  }
});

// Keep canvas render size matched to the camera (portrait/rotation changes).
window.addEventListener("resize", () => {
  if (sceneRenderer && els.video.videoWidth) {
    sceneRenderer.resize(els.video.videoWidth, els.video.videoHeight);
  }
});

// Secure-context guard: getUserMedia needs HTTPS (Vercel) or localhost.
if (!window.isSecureContext) {
  toast("Open over HTTPS — camera access requires a secure context.", 8000);
}
