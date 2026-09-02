// TakeRecorder: captures the composite canvas + microphone into the best
// video container the browser offers (MP4/H.264 or HEVC on Safari, WebM
// elsewhere), and writes the sidecar tracking JSON in parallel.
//
// Web-platform honesty (see README): browsers expose MediaRecorder, not
// AVAssetWriter. Safari records .mp4; Chrome records .webm. True HEVC .mov
// with guaranteed 1080p60 belongs to the native iOS phase.

import { RECORD_VIDEO_BITRATE, RECORD_AUDIO_BITRATE } from "./config.js";
import { SidecarRecorder } from "./sidecar.js";

const MIME_CANDIDATES = [
  'video/mp4;codecs="hvc1"',
  'video/mp4;codecs="avc1.640028"',
  "video/mp4",
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  "video/webm",
];

export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

export class TakeRecorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.recorder = null;
    this.chunks = [];
    this.sidecar = null;
    this.mimeType = pickMimeType();
    this.audioStream = null;
    this.isRecording = false;
  }

  /**
   * @param {{width:number, height:number, fps:number}} meta for the sidecar
   * @param {boolean} withAudio
   */
  async start(meta, withAudio = true) {
    if (this.isRecording) return;
    if (!this.mimeType) {
      throw new Error("This browser does not support MediaRecorder video.");
    }
    const fps = meta.fps || 30;
    const stream = this.canvas.captureStream(fps);

    if (withAudio) {
      try {
        this.audioStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        for (const track of this.audioStream.getAudioTracks()) {
          stream.addTrack(track);
        }
      } catch (err) {
        console.warn("[AuruMask] Mic unavailable, recording video-only:", err.message);
      }
    }

    this.chunks = [];
    this.sidecar = new SidecarRecorder(meta);
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: RECORD_VIDEO_BITRATE,
      audioBitsPerSecond: RECORD_AUDIO_BITRATE,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000); // 1s chunks so long takes don't buffer in one blob
    this.isRecording = true;
    this.startedAt = performance.now();
  }

  /** Called once per rendered frame while recording. */
  captureFrame(t, shapes, matrix) {
    if (this.isRecording && this.sidecar && matrix) {
      this.sidecar.addFrame(t, shapes, matrix);
    }
  }

  /** @returns {Promise<{videoBlob: Blob, sidecarBlob: Blob, extension: string}>} */
  stop() {
    if (!this.isRecording) return Promise.resolve(null);
    this.isRecording = false;
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        const videoBlob = new Blob(this.chunks, { type: this.mimeType });
        const sidecarBlob = new Blob([this.sidecar.serialize()], {
          type: "application/json",
        });
        this.audioStream?.getTracks().forEach((tr) => tr.stop());
        this.audioStream = null;
        resolve({
          videoBlob,
          sidecarBlob,
          extension: this.mimeType.startsWith("video/mp4") ? "mp4" : "webm",
          frameCount: this.sidecar.frameCount,
        });
      };
      this.recorder.stop();
    });
  }
}

/**
 * Hands a finished file to the user. On iOS the share sheet is the only
 * path into the Photos app; elsewhere a download link does the job.
 */
export async function deliverFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      if (err.name === "AbortError") return "cancelled";
      // Fall through to download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}

export function takeName(prefix, ext) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
    d.getDate()
  )}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}
