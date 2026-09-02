// AuruMask entry point: owns the camera, the render loop, and the UI wiring.

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
  startButton: $("start-button"),
  controls: $("controls"),
  debugOverlay: $("debug-overlay"),
  debugText: $("debug-text"),
  btnMask: $("btn-mask"),
  btnStudio: $("btn-studio"),
  btnGreen: $("btn-green"),
  btnDebug: $("btn-debug"),
  btnExport: $("btn-export"),
  sliderSmooth: $("slider-smooth"),
  sliderScale: $("slider-scale"),
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
  debug: false,
  lastFrameTime: 0,
  renderFps: 0,
  fpsWindow: [],
  droppedBudget: 0,
  lastTake: null,
  sidecarText: null,
  captureFps: 30,
};

let tracker, persona, tiger, sceneRenderer, recorder, exporter, mapping;

function toast(msg, ms = 3200) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (els.toast.hidden = true), ms);
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

async function start() {
  els.startButton.disabled = true;
  els.startButton.textContent = "Loading…";

  try {
    // 1) Camera first — the permission prompt needs the user gesture fresh.
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

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    state.captureFps = settings.frameRate || 30;
    console.info(
      `[AuruMask] Capture format: ${settings.width}x${settings.height}@${settings.frameRate}fps`
    );

    // 2) Heavy pieces in parallel: tracker model, persona mapping, tiger.
    els.startButton.textContent = "Loading tracker…";
    mapping = await loadMapping();
    tracker = new FaceTracker();
    const trackerInit = tracker.init();
    sceneRenderer = new SceneRenderer(els.canvas);
    tiger = await loadTigerModel(MODEL_PATH, mapping);
    sceneRenderer.setTiger(tiger);
    sceneRenderer.attachVideo(els.video);
    await trackerInit;

    persona = new PersonaMapping(mapping);
    recorder = new TakeRecorder(els.canvas);
    exporter = new Exporter(sceneRenderer, tiger, mapping);

    // 3) Apply defaults.
    setSmoothing(SMOOTHING_DEFAULT);
    els.sliderSmooth.value = Math.round(SMOOTHING_DEFAULT * 100);
    sceneRenderer.setMaskScale(MASK_SCALE_DEFAULT);
    els.sliderScale.value = Math.round(MASK_SCALE_DEFAULT * 100);
    sceneRenderer.setStudioLook(true);

    // Automation/debug hook (harmless in production, no UI surface).
    window.__aurumask = { sceneRenderer, tiger, persona, tracker, recorder };

    els.startOverlay.hidden = true;
    els.controls.hidden = false;
    state.running = true;
    state.lastFrameTime = performance.now();
    loopToken++;
    requestAnimationFrame((t) => loop(t, loopToken));
    toast("Face the camera — the tiger follows you");
  } catch (err) {
    console.error(err);
    els.startButton.disabled = false;
    els.startButton.textContent = "Start camera";
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

  // Render-FPS window (for the debug overlay and drop detection).
  state.fpsWindow.push(now);
  while (state.fpsWindow.length && now - state.fpsWindow[0] > 1000) {
    state.fpsWindow.shift();
  }
  state.renderFps = state.fpsWindow.length;

  const signal = tracker.detect(els.video, now);

  if (signal?.tracked && signal.matrix) {
    const angVel = sceneRenderer.updateFaceTransform(signal.matrix, dt);
    const pose = persona.update(signal);
    tiger.applyPose(pose, angVel, dt);
    if (recorder.isRecording) {
      recorder.captureFrame(now / 1000, signal.shapes, signal.matrix);
    }
  }

  sceneRenderer.updateAdaptiveLighting();
  sceneRenderer.render();

  if (state.debug) updateDebugOverlay(signal);
  if (recorder.isRecording) updateRecTime();

  requestAnimationFrame((t) => loop(t, token));
}

function updateDebugOverlay(signal) {
  const v = els.video;
  const jaw = signal?.shapes?.jawOpen ?? 0;
  const roarBar = "#".repeat(Math.round(jaw * 20)).padEnd(20, "·");
  els.debugText.textContent =
    `capture  ${v.videoWidth}x${v.videoHeight}@${Math.round(state.captureFps)}\n` +
    `render   ${state.renderFps} fps\n` +
    `tracking ${tracker.trackingFps} fps  face:${signal?.tracked ? "LOCK" : "----"}\n` +
    `jawOpen  ${jaw.toFixed(3)} [${roarBar}]\n` +
    `smooth   ${(Number(els.sliderSmooth.value) / 100).toFixed(2)}  ` +
    `scale ${(Number(els.sliderScale.value) / 100).toFixed(2)}\n` +
    `mime     ${recorder?.mimeType ?? "n/a"}`;
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
    } catch (err) {
      toast(`Recording failed: ${err.message}`, 5000);
    }
  } else {
    const take = await recorder.stop();
    els.btnRecord.classList.remove("recording");
    els.recTime.hidden = true;
    if (take) {
      state.lastTake = take;
      els.saveSummary.textContent =
        `${(take.videoBlob.size / 1e6).toFixed(1)} MB video (.${take.extension})` +
        ` · ${take.frameCount} tracked frames`;
      els.saveSheet.hidden = false;
    }
  }
}

// ---- UI wiring ----

els.startButton.addEventListener("click", start);
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
els.btnDebug.addEventListener("click", () => {
  state.debug = !state.debug;
  els.debugOverlay.hidden = !state.debug;
  els.btnDebug.dataset.active = state.debug;
});

els.sliderSmooth.addEventListener("input", () => {
  setSmoothing(Number(els.sliderSmooth.value) / 100);
});
els.sliderScale.addEventListener("input", () => {
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
els.btnExport.addEventListener("click", () => (els.exportSheet.hidden = false));
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
