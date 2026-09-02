// SceneRenderer: the three.js stage. Renders the camera feed as a background
// plane (or chroma green for clean-plate), anchors the tiger to the tracked
// head transform, and owns lighting (studio PMREM environment + adaptive tint
// from the room). One canvas carries the full composite, so recording and the
// 4K export capture exactly what the user sees — minus the debug overlay,
// which is DOM and never touches the canvas.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CAMERA_VERTICAL_FOV_DEG, GREEN_SCREEN_COLOR } from "./config.js";

const BG_DISTANCE = 800; // cm — far behind any plausible head position

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_VERTICAL_FOV_DEG,
      1,
      1,
      5000
    );
    this.camera.position.set(0, 0, 0);

    // Studio environment: three's RoomEnvironment through PMREM — a neutral
    // softbox look that makes gold read as gold in any room.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.studioEnv;

    // Adaptive room tint: a directional key + ambient whose color tracks the
    // average camera pixel, so the mask sits in the room's light when the
    // studio toggle is off.
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.keyLight.position.set(30, 60, 90);
    this.scene.add(this.keyLight);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(this.ambient);

    // Face anchor: tiger group parents here; its matrix comes from tracking.
    this.faceAnchor = new THREE.Group();
    this.faceAnchor.matrixAutoUpdate = false;
    this.scene.add(this.faceAnchor);

    // Background plane (video or green), sized each resize to fill the frustum.
    this.bgMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.bgMaterial);
    this.bgMesh.position.z = -BG_DISTANCE;
    this.scene.add(this.bgMesh);

    this.videoTexture = null;
    this.greenScreen = false;
    this.studioLook = true;
    this.maskScale = 1.0;

    this._tintCanvas = document.createElement("canvas");
    this._tintCanvas.width = this._tintCanvas.height = 8;
    this._tintCtx = this._tintCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    this._tintFrame = 0;

    this._prevQuat = new THREE.Quaternion();
    this._targetMatrix = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
    this._prevEuler = new THREE.Euler();
    this.headAngularVelocity = new THREE.Vector3();
    this.rotationSmoothing = 0;
  }

  attachVideo(video) {
    this.video = video;
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.bgMaterial.map = this.videoTexture;
    this.bgMaterial.needsUpdate = true;
    this.resize(video.videoWidth, video.videoHeight);
  }

  setTiger(tigerHead) {
    if (this.tiger) this.faceAnchor.remove(this.tiger.group);
    this.tiger = tigerHead;
    this.faceAnchor.add(tigerHead.group);
  }

  /** Canvas render size — matches capture video by default, 4K for export. */
  resize(width, height) {
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Fill the frustum at BG_DISTANCE, cover-cropping the video texture.
    const h = 2 * BG_DISTANCE * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const w = h * this.camera.aspect;
    this.bgMesh.scale.set(w, h, 1);
    if (this.videoTexture && this.video?.videoWidth) {
      const videoAspect = this.video.videoWidth / this.video.videoHeight;
      const planeAspect = w / h;
      const tex = this.videoTexture;
      if (videoAspect > planeAspect) {
        tex.repeat.set(planeAspect / videoAspect, 1);
        tex.offset.set((1 - tex.repeat.x) / 2, 0);
      } else {
        tex.repeat.set(1, videoAspect / planeAspect);
        tex.offset.set(0, (1 - tex.repeat.y) / 2);
      }
    }
  }

  setGreenScreen(on) {
    this.greenScreen = on;
    if (on) {
      this.bgMaterial.map = null;
      this.bgMaterial.color.set(GREEN_SCREEN_COLOR);
    } else {
      this.bgMaterial.map = this.videoTexture;
      this.bgMaterial.color.set(0xffffff);
    }
    this.bgMaterial.needsUpdate = true;
  }

  setStudioLook(on) {
    this.studioLook = on;
    if (on) {
      this.keyLight.color.set(0xffffff);
      this.ambient.color.set(0xffffff);
      this.keyLight.intensity = 1.4;
      this.tiger?.setEnvironmentIntensity(1.2);
    } else {
      this.tiger?.setEnvironmentIntensity(0.7);
    }
  }

  setMaskScale(s) {
    this.maskScale = s;
  }

  setMaskVisible(v) {
    this.faceAnchor.visible = v;
  }

  /** 0..1 from the smoothing slider — drives rotation slerp strength. */
  setRotationSmoothing(s) {
    this.rotationSmoothing = s;
  }

  /**
   * Applies a tracked head matrix (16 numbers, MediaPipe camera space, cm)
   * to the face anchor, with rotation smoothing and mask scaling.
   * Returns head angular velocity (rad/s) for secondary motion.
   */
  updateFaceTransform(matrixArray, dt) {
    this._targetMatrix.fromArray(matrixArray);
    this._targetMatrix.decompose(this._pos, this._quat, this._scl);

    // Rotation smoothing: slerp previous → target. Strength 0 keeps it raw.
    if (this.rotationSmoothing > 0 && dt > 0) {
      const rate = THREE.MathUtils.lerp(60, 8, this.rotationSmoothing);
      const alpha = 1 - Math.exp(-rate * dt);
      this._prevQuat.slerp(this._quat, alpha);
    } else {
      this._prevQuat.copy(this._quat);
    }

    // Angular velocity estimate from euler delta (good enough for springs).
    const e = new THREE.Euler().setFromQuaternion(this._prevQuat);
    if (dt > 0) {
      this.headAngularVelocity.set(
        (e.x - this._prevEuler.x) / dt,
        (e.y - this._prevEuler.y) / dt,
        (e.z - this._prevEuler.z) / dt
      );
    }
    this._prevEuler.copy(e);

    const s = this.maskScale;
    this.faceAnchor.matrix.compose(
      this._pos,
      this._prevQuat,
      this._scl.multiplyScalar(s)
    );
    this.faceAnchor.matrixWorldNeedsUpdate = true;
    return this.headAngularVelocity;
  }

  /** Samples the camera feed's average color into the key/ambient lights. */
  updateAdaptiveLighting() {
    if (this.studioLook || !this.video || this.video.readyState < 2) return;
    // Every 15th frame — a GPU readback this small is cheap but not free.
    if (this._tintFrame++ % 15 !== 0) return;
    try {
      this._tintCtx.drawImage(this.video, 0, 0, 8, 8);
      const d = this._tintCtx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2];
      }
      const n = d.length / 4;
      const col = new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
      const brightness = Math.max(0.25, col.getHSL({}).l * 2);
      col.multiplyScalar(1 / Math.max(col.r, col.g, col.b, 0.01));
      this.keyLight.color.copy(col);
      this.ambient.color.copy(col);
      this.keyLight.intensity = 1.1 * brightness;
    } catch {
      // Canvas taint or decode hiccup — keep last light state.
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
