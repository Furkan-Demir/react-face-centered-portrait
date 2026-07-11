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

/** How the crop is vertically anchored to the tracked point. */
export type FramingMode = "center" | "ruleOfThirds"

export interface BackgroundEffectOptions {
  /** `"blur"` softens the real background; `"image"` replaces it with `imageUrl`. */
  mode: "blur" | "image"
  /** Blur radius in pixels, used when `mode` is `"blur"`. Default: 16. */
  blurPx?: number
  /**
   * URL of the replacement background image, used when `mode` is `"image"`.
   * Must be served with CORS headers allowing this origin (e.g.
   * `Access-Control-Allow-Origin: *`) — cross-origin images without CORS
   * taint the canvas, which silently breaks `captureStream()`/export. Scaled
   * to cover the frame (like CSS `object-fit: cover`), cropping overflow.
   */
  imageUrl?: string
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
  /** How the crop is vertically anchored to the tracked point. `"ruleOfThirds"` leaves headroom above the face instead of dead-centering it. Default: "center". */
  framing?: FramingMode
  /**
   * Enables background blur or replacement via MediaPipe's selfie
   * segmentation model. Omit (default) to skip loading the segmentation
   * model entirely — this is an opt-in cost on top of face detection. Can be
   * set/changed at any time, including while the camera is already running.
   */
  background?: BackgroundEffectOptions
  /** How often background segmentation runs, in frames per second. Default: 9. */
  segmentationFps?: number
  /** URL of the segmentation model asset (.tflite). Override to self-host. */
  segmentationModelAssetPath?: string
  /** Called once `start()` has successfully begun streaming. */
  onStart?: () => void
  /** Called when `stop()` is invoked (not on internal error cleanup — see `onError`). */
  onStop?: () => void
  /** Called with a human-readable message whenever `status` transitions to `"error"`. */
  onError?: (message: string) => void
  /** Called once when a face newly appears (transition from not-detected to detected), with its center in source-video pixel coordinates. */
  onFaceDetected?: (point: Point) => void
  /** Called once when a previously-detected face disappears. */
  onFaceLost?: () => void
}
