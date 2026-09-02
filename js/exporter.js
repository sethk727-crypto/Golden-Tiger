// Offline 4K re-render. Replays a sidecar JSON through the same SceneRenderer
// at 3840×2160 (or a chosen resolution) into a high-bitrate file.
//
// Web-platform honesty (see README): ProRes encoding does not exist in
// browsers. This uses MediaRecorder at 60 Mbps (H.264/HEVC on Safari, VP9
// elsewhere), replaying in real time — a 30s take renders in ~30s. The
// native iOS phase replaces this with AVAssetWriter ProRes.

import { EXPORT_VIDEO_BITRATE } from "./config.js";
import { parseSidecar } from "./sidecar.js";
import { PersonaMapping } from "./personaMapping.js";
import { pickMimeType } from "./recorder.js";
import * as THREE from "three";

export class Exporter {
  /**
   * @param {import("./sceneRenderer.js").SceneRenderer} sceneRenderer
   * @param {import("./tigerModel.js").TigerHead} tiger
   * @param {object} mapping normalized mapping.json contents
   */
  constructor(sceneRenderer, tiger, mapping) {
    this.sr = sceneRenderer;
    this.tiger = tiger;
    this.mapping = mapping;
    this.aborted = false;
  }

  /**
   * @param {string} sidecarText  raw sidecar JSON
   * @param {{width:number, height:number, background:"green"|"black", onProgress:(p:number)=>void}} opts
   * @returns {Promise<{blob: Blob, extension: string}>}
   */
  async export(sidecarText, opts) {
    const { frames } = parseSidecar(sidecarText);
    const mimeType = pickMimeType();
    if (!mimeType) throw new Error("MediaRecorder is unavailable in this browser.");

    const sr = this.sr;
    const prev = {
      width: sr.baseWidth,
      height: sr.baseHeight,
      green: sr.greenScreen,
    };

    // Reconfigure the live stage for the offline pass (exact pixels, no
    // supersampling on top of the chosen export resolution).
    sr.resizeExact(opts.width, opts.height);
    sr.bgMaterial.map = null;
    sr.bgMaterial.color.set(opts.background === "black" ? 0x000000 : 0x00b140);
    sr.bgMaterial.needsUpdate = true;

    const persona = new PersonaMapping(this.mapping);
    const stream = sr.canvas.captureStream(60);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: EXPORT_VIDEO_BITRATE,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(1000);

    this.aborted = false;
    const duration = frames[frames.length - 1].t;
    const t0 = performance.now();
    let frameIdx = 0;
    const angVel = new THREE.Vector3(0, 0, 0);

    await new Promise((resolve) => {
      const tick = () => {
        if (this.aborted) return resolve();
        const elapsed = (performance.now() - t0) / 1000;
        // Advance to the sidecar frame matching wall-clock replay time.
        while (frameIdx < frames.length - 1 && frames[frameIdx + 1].t <= elapsed) {
          frameIdx++;
        }
        const f = frames[frameIdx];
        const vel = sr.updateFaceTransform(f.matrix, 1 / 60) ?? angVel;
        const pose = persona.update({ t: f.t, shapes: f.shapes });
        this.tiger.applyPose(pose, vel, 1 / 60);
        sr.render();
        opts.onProgress?.(Math.min(1, elapsed / duration));
        if (elapsed >= duration + 0.25) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.stop();
    });

    // Restore the live stage.
    sr.resize(prev.width, prev.height);
    sr.setGreenScreen(prev.green);

    if (this.aborted) throw new Error("Export cancelled.");
    return {
      blob,
      extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
    };
  }

  abort() {
    this.aborted = true;
  }
}
