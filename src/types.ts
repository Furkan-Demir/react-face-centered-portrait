export type FaceCenteredPortraitStatus =
  | "idle"
  | "requesting"
  | "active"
  | "error"
  | "stopped"

export type Point = { x: number; y: number }

export interface FaceCenteredPortraitDebugInfo {
  faceDetected: boolean
  faceCenter: Point | null
  cropCenter: Point | null
  lastDetectionTs: number | null
  renderCount: number
}

export interface FaceCenteredPortraitOptions {
  /** Output canvas width, in pixels. Default: 720. */
  outputWidth?: number
  /** Output canvas height, in pixels. Default: 1280 (9:16 with the default width). */
  outputHeight?: number
  /** Passed to `getUserMedia({ video: ... })`. Default: 1280x720 @ 30fps. */
  videoConstraints?: MediaTrackConstraints
  /** Flip the preview horizontally, like a selfie camera. Default: true. */
  mirror?: boolean
  /** Exponential smoothing factor for the crop center, 0-1. Higher = smoother/slower. Default: 0.85. */
  smoothing?: number
  /** How often MediaPipe runs face detection, in frames per second. Default: 9. */
  detectionFps?: number
  /** How often the portrait canvas is redrawn, in frames per second. Default: 24. */
  renderFps?: number
  /** Initial value of the auto-center-on-face toggle. Default: true. */
  autoCenterDefault?: boolean
  /** Minimum zoom (most zoomed out). Below 1, extra width is revealed via letterbox bars. Default: 0.6. */
  zoomMin?: number
  /** Maximum zoom (most zoomed in). Default: 3. */
  zoomMax?: number
  /** Initial zoom level. Default: 0.85. */
  zoomDefault?: number
  /** URL of the face detector model asset (.tflite). Override to self-host. */
  modelAssetPath?: string
  /** Base URL of the MediaPipe Tasks Vision wasm fileset. Override to self-host. */
  wasmBaseUrl?: string
  /** MediaPipe inference delegate. GPU is faster but less consistently supported (notably in Safari). Default: "CPU". */
  delegate?: "CPU" | "GPU"
  /** Minimum confidence for a detection to be considered a face. Default: 0.5. */
  minDetectionConfidence?: number
}
