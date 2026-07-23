"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { RefObject } from "react"
import { FaceDetector, FilesetResolver, type Detection } from "@mediapipe/tasks-vision"

import { BackgroundEffectEngine } from "./backgroundEffect"
import type {
  FaceCenteredPortraitDebugInfo,
  FaceCenteredPortraitOptions,
  FaceCenteredPortraitStatus,
  Point,
} from "./types"

const DEFAULT_OUTPUT_WIDTH = 720
const DEFAULT_OUTPUT_HEIGHT = 1280
const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: 1280,
  height: 720,
  frameRate: 30,
}
const DEFAULT_SMOOTHING = 0.85
const DEFAULT_DETECTION_FPS = 9
const DEFAULT_RENDER_FPS = 24
const DEFAULT_SEGMENTATION_FPS = 9
const DEFAULT_ZOOM_MIN = 0.6
const DEFAULT_ZOOM_MAX = 3
const DEFAULT_ZOOM_DEFAULT = 0.85
const DEFAULT_MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
const DEFAULT_SEGMENTATION_MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite"
const DEFAULT_WASM_BASE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
const DEFAULT_DELEGATE: "CPU" | "GPU" = "CPU"
const DEFAULT_MIN_DETECTION_CONFIDENCE = 0.5
// Vertical fraction (from the top of the crop) the tracked point is pinned
// to under "ruleOfThirds" framing — leaves headroom above the face instead
// of dead-centering it.
const RULE_OF_THIRDS_VERTICAL_ANCHOR = 0.38

const EMPTY_DEBUG_INFO: FaceCenteredPortraitDebugInfo = {
  faceDetected: false,
  faceCenter: null,
  cropCenter: null,
  lastDetectionTs: null,
  renderCount: 0,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export interface UseFaceCenteredPortraitResult {
  /** Attach to a `<video>` element. Required, must stay mounted (it can be visually hidden). */
  videoRef: RefObject<HTMLVideoElement | null>
  /** Attach to a `<canvas>` element sized `outputWidth` x `outputHeight`. This renders the portrait preview. */
  canvasRef: RefObject<HTMLCanvasElement | null>
  status: FaceCenteredPortraitStatus
  error: string | null
  /** Requests camera permission, loads the face detector, and starts the render loop. */
  start: () => Promise<void>
  /** Stops all media tracks, cancels the render loop, and resets state. */
  stop: () => void
  autoCenter: boolean
  setAutoCenter: (value: boolean | ((prev: boolean) => boolean)) => void
  zoom: number
  setZoom: (value: number | ((prev: number) => number)) => void
  zoomMin: number
  zoomMax: number
  debugInfo: FaceCenteredPortraitDebugInfo
  outputWidth: number
  outputHeight: number
  /** Available video input devices. Populated after the first successful `start()` and kept in sync via `devicechange`. Build any UI you want on top of this — or use `CameraDevicePicker` for a default `<select>`. */
  devices: MediaDeviceInfo[]
  /** `deviceId` of the currently active camera, or `null` before the first `start()`. */
  deviceId: string | null
  /** Switches the active camera mid-session without reloading the face detector. */
  selectDevice: (deviceId: string) => Promise<void>
  /** Re-runs `navigator.mediaDevices.enumerateDevices()`. Called automatically after `start()` and on `devicechange`; exposed for manual refresh. */
  refreshDevices: () => Promise<void>
}

/**
 * Headless hook driving a MediaPipe face-detected, auto-centered 9:16
 * portrait crop of a webcam feed. Bring your own `<video>`/`<canvas>` and UI
 * — see `FaceCenteredPortrait` for a batteries-included component.
 */
export function useFaceCenteredPortrait(
  options: FaceCenteredPortraitOptions = {},
): UseFaceCenteredPortraitResult {
  const outputWidth = options.outputWidth ?? DEFAULT_OUTPUT_WIDTH
  const outputHeight = options.outputHeight ?? DEFAULT_OUTPUT_HEIGHT
  const outputAspect = outputWidth / outputHeight
  const zoomMin = options.zoomMin ?? DEFAULT_ZOOM_MIN
  const zoomMax = options.zoomMax ?? DEFAULT_ZOOM_MAX

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const rafIdRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<FaceDetector | null>(null)
  const backgroundEngineRef = useRef<BackgroundEffectEngine | null>(null)
  const backgroundEngineLoadingRef = useRef(false)

  const latestFaceRef = useRef<{ x: number; y: number; detected: boolean }>({
    x: 0,
    y: 0,
    detected: false,
  })
  const smoothedCenterRef = useRef<Point | null>(null)

  const lastDetectionTimeRef = useRef(0)
  const lastSegmentationTimeRef = useRef(0)
  const lastRenderTimeRef = useRef(0)
  const renderCountRef = useRef(0)
  const lastDetectionTsRef = useRef<number | null>(null)
  const cropCenterRef = useRef<Point | null>(null)

  // Mirrors of user-controlled state, readable from inside the rAF loop
  // without stale closures. Config that's only read once at start (model
  // URLs, video constraints, etc.) is read directly from `options` there.
  const autoCenterRef = useRef(options.autoCenterDefault ?? true)
  const zoomRef = useRef(options.zoomDefault ?? DEFAULT_ZOOM_DEFAULT)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const [status, setStatus] = useState<FaceCenteredPortraitStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [autoCenter, setAutoCenter] = useState(options.autoCenterDefault ?? true)
  const [zoom, setZoom] = useState(options.zoomDefault ?? DEFAULT_ZOOM_DEFAULT)
  const [debugInfo, setDebugInfo] = useState<FaceCenteredPortraitDebugInfo>(EMPTY_DEBUG_INFO)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(null)

  useEffect(() => {
    autoCenterRef.current = autoCenter
  }, [autoCenter])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  const reportError = useCallback((message: string) => {
    setError(message)
    optionsRef.current.onError?.(message)
  }, [])

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === "videoinput"))
    } catch (err) {
      console.error("[react-face-centered-portrait] failed to enumerate devices", err)
    }
  }, [])

  // Keep the device list in sync as cameras are plugged/unplugged.
  useEffect(() => {
    if (!navigator.mediaDevices) return
    const handler = () => void refreshDevices()
    navigator.mediaDevices.addEventListener("devicechange", handler)
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler)
  }, [refreshDevices])

  const runDetection = useCallback((now: number) => {
    const video = videoRef.current
    const detector = detectorRef.current
    if (!video || !detector) return

    try {
      const result = detector.detectForVideo(video, now)
      const best: Detection | undefined = result.detections[0]
      const wasDetected = latestFaceRef.current.detected

      if (best?.boundingBox) {
        const { originX, originY, width, height } = best.boundingBox
        const point = { x: originX + width / 2, y: originY + height / 2 }
        latestFaceRef.current = { ...point, detected: true }
        if (!wasDetected) optionsRef.current.onFaceDetected?.(point)
      } else {
        latestFaceRef.current = { ...latestFaceRef.current, detected: false }
        if (wasDetected) optionsRef.current.onFaceLost?.()
      }

      lastDetectionTsRef.current = now
    } catch (err) {
      console.error("[react-face-centered-portrait] face detection failed", err)
    }
  }, [])

  const ensureBackgroundEngine = useCallback(async () => {
    if (backgroundEngineRef.current || backgroundEngineLoadingRef.current) return
    if (!optionsRef.current.background) return
    backgroundEngineLoadingRef.current = true
    try {
      const engine = new BackgroundEffectEngine()
      await engine.ensure(
        optionsRef.current.wasmBaseUrl ?? DEFAULT_WASM_BASE_URL,
        optionsRef.current.segmentationModelAssetPath ?? DEFAULT_SEGMENTATION_MODEL_ASSET_PATH,
        optionsRef.current.delegate ?? DEFAULT_DELEGATE,
      )
      backgroundEngineRef.current = engine
    } catch (err) {
      console.error("[react-face-centered-portrait] failed to load background segmentation model", err)
    } finally {
      backgroundEngineLoadingRef.current = false
    }
  }, [])

  const drawFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    if (!smoothedCenterRef.current) {
      smoothedCenterRef.current = { x: vw / 2, y: vh / 2 }
    }

    const smoothingFactor = optionsRef.current.smoothing ?? DEFAULT_SMOOTHING
    const target: Point =
      autoCenterRef.current && latestFaceRef.current.detected
        ? { x: latestFaceRef.current.x, y: latestFaceRef.current.y }
        : { x: vw / 2, y: vh / 2 }

    const smoothed = smoothedCenterRef.current
    smoothed.x = smoothed.x * smoothingFactor + target.x * (1 - smoothingFactor)
    smoothed.y = smoothed.y * smoothingFactor + target.y * (1 - smoothingFactor)

    // Widest crop obtainable from the source without padding (uses the
    // source's full height or width, whichever is the limiting dimension).
    const videoAspect = vw / vh
    let baseCropW: number
    let baseCropH: number
    if (videoAspect > outputAspect) {
      baseCropH = vh
      baseCropW = vh * outputAspect
    } else {
      baseCropW = vw
      baseCropH = vw / outputAspect
    }

    const zoomFactor = clamp(zoomRef.current, zoomMin, zoomMax)
    const desiredCropW = baseCropW / zoomFactor
    const desiredCropH = baseCropH / zoomFactor

    // Clamp the source rect to what the video actually has. When zoom < 1
    // this clips the height to vh, leaving the desired width wider than a
    // pure 9:16 slice would allow — that excess is shown via letterbox bars
    // below rather than cropped out.
    const contentCropW = Math.min(desiredCropW, vw)
    const contentCropH = Math.min(desiredCropH, vh)

    const verticalAnchor =
      (optionsRef.current.framing ?? "center") === "ruleOfThirds" ? RULE_OF_THIRDS_VERTICAL_ANCHOR : 0.5

    const sx = clamp(smoothed.x - contentCropW / 2, 0, vw - contentCropW)
    const sy = clamp(smoothed.y - contentCropH * verticalAnchor, 0, vh - contentCropH)

    // "Contain" fit: scale the content into the canvas without distortion,
    // padding with black bars on whichever axis has leftover space.
    const fitScale = Math.min(canvas.width / contentCropW, canvas.height / contentCropH)
    const drawW = contentCropW * fitScale
    const drawH = contentCropH * fitScale
    const dx = (canvas.width - drawW) / 2
    const dy = (canvas.height - drawH) / 2

    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Background blur/replace runs on the full source frame before cropping,
    // so the segmentation mask stays aligned with unmodified video pixels.
    let source: CanvasImageSource = video
    const backgroundOptions = optionsRef.current.background
    if (backgroundOptions && backgroundEngineRef.current) {
      const composited = backgroundEngineRef.current.composite(video, vw, vh, backgroundOptions)
      if (composited) source = composited
    }

    const mirror = optionsRef.current.mirror ?? true
    ctx.save()
    if (mirror) {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(source, sx, sy, contentCropW, contentCropH, dx, dy, drawW, drawH)
    ctx.restore()

    cropCenterRef.current = { x: sx + contentCropW / 2, y: sy + contentCropH / 2 }
    renderCountRef.current += 1
  }, [outputAspect, zoomMin, zoomMax])

  // Mechanical teardown, shared by the public `stop()` and the internal
  // error-recovery path in `start()` (which should not fire `onStop`).
  const cleanup = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    smoothedCenterRef.current = null
    latestFaceRef.current = { x: 0, y: 0, detected: false }
    setStatus((prev) => (prev === "error" ? prev : "stopped"))
    setDebugInfo(EMPTY_DEBUG_INFO)
  }, [])

  const stop = useCallback(() => {
    cleanup()
    optionsRef.current.onStop?.()
  }, [cleanup])

  const selectDevice = useCallback(
    async (id: string) => {
      const video = videoRef.current
      if (!video) return
      try {
        const constraints: MediaTrackConstraints = {
          ...(optionsRef.current.videoConstraints ?? DEFAULT_VIDEO_CONSTRAINTS),
          deviceId: { exact: id },
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false })
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = stream
        video.srcObject = stream
        await video.play()
        setDeviceId(id)
      } catch (err) {
        console.error("[react-face-centered-portrait] failed to switch camera", err)
        reportError(err instanceof Error ? err.message : "Failed to switch camera")
      }
    },
    [reportError],
  )

  const start = useCallback(async () => {
    setError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error")
      reportError("This browser does not support camera access.")
      return
    }

    setStatus("requesting")

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: optionsRef.current.videoConstraints ?? DEFAULT_VIDEO_CONSTRAINTS,
        audio: false,
      })
      streamRef.current = stream

      const video = videoRef.current
      if (!video) throw new Error("videoRef is not attached to a <video> element")
      video.srcObject = stream
      await video.play()

      setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? null)
      void refreshDevices()

      if (!detectorRef.current) {
        const wasmBaseUrl = optionsRef.current.wasmBaseUrl ?? DEFAULT_WASM_BASE_URL
        const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl)
        detectorRef.current = await FaceDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: optionsRef.current.modelAssetPath ?? DEFAULT_MODEL_ASSET_PATH,
            delegate: optionsRef.current.delegate ?? DEFAULT_DELEGATE,
          },
          minDetectionConfidence:
            optionsRef.current.minDetectionConfidence ?? DEFAULT_MIN_DETECTION_CONFIDENCE,
          runningMode: "VIDEO",
        })
      }

      if (optionsRef.current.background) void ensureBackgroundEngine()

      setStatus("active")
      optionsRef.current.onStart?.()

      lastDetectionTimeRef.current = 0
      lastSegmentationTimeRef.current = 0
      lastRenderTimeRef.current = 0
      renderCountRef.current = 0

      const detectionIntervalMs = 1000 / (optionsRef.current.detectionFps ?? DEFAULT_DETECTION_FPS)
      const renderIntervalMs = 1000 / (optionsRef.current.renderFps ?? DEFAULT_RENDER_FPS)
      const segmentationIntervalMs = 1000 / (optionsRef.current.segmentationFps ?? DEFAULT_SEGMENTATION_FPS)

      const tick = (now: number) => {
        rafIdRef.current = requestAnimationFrame(tick)

        if (!videoRef.current || videoRef.current.readyState < 2) return

        if (now - lastDetectionTimeRef.current >= detectionIntervalMs) {
          lastDetectionTimeRef.current = now
          runDetection(now)
        }

        if (optionsRef.current.background) {
          void ensureBackgroundEngine()
          if (backgroundEngineRef.current && now - lastSegmentationTimeRef.current >= segmentationIntervalMs) {
            lastSegmentationTimeRef.current = now
            backgroundEngineRef.current.run(videoRef.current, now)
          }
        }

        if (now - lastRenderTimeRef.current >= renderIntervalMs) {
          lastRenderTimeRef.current = now
          drawFrame()
        }
      }
      rafIdRef.current = requestAnimationFrame(tick)
    } catch (err) {
      console.error("[react-face-centered-portrait] failed to start camera", err)
      cleanup()
      setStatus("error")
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        reportError("Camera permission was denied.")
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        reportError("No camera device was found.")
      } else {
        reportError(err instanceof Error ? err.message : "Unknown error")
      }
    }
  }, [cleanup, drawFrame, ensureBackgroundEngine, refreshDevices, reportError, runDetection])

  // Sync high-frequency refs into React state at a low, UI-friendly rate.
  useEffect(() => {
    if (status !== "active") return
    const interval = setInterval(() => {
      setDebugInfo({
        faceDetected: latestFaceRef.current.detected,
        faceCenter: latestFaceRef.current.detected
          ? { x: latestFaceRef.current.x, y: latestFaceRef.current.y }
          : null,
        cropCenter: cropCenterRef.current,
        lastDetectionTs: lastDetectionTsRef.current,
        renderCount: renderCountRef.current,
      })
    }, 250)
    return () => clearInterval(interval)
  }, [status])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      detectorRef.current?.close()
      detectorRef.current = null
      backgroundEngineRef.current?.close()
      backgroundEngineRef.current = null
    }
  }, [])

  // Memoized so the returned object is only a new reference when a value a
  // consumer could actually observe has changed. Without this, callers who
  // (reasonably) put the whole result in a `useEffect` dependency array get
  // an effect that re-fires on every render — e.g. a status change during
  // `start()` can re-enter `start()` before a sibling effect reacts to it.
  return useMemo(
    () => ({
      videoRef,
      canvasRef,
      status,
      error,
      start,
      stop,
      autoCenter,
      setAutoCenter,
      zoom,
      setZoom,
      zoomMin,
      zoomMax,
      debugInfo,
      outputWidth,
      outputHeight,
      devices,
      deviceId,
      selectDevice,
      refreshDevices,
    }),
    [
      status,
      error,
      start,
      stop,
      autoCenter,
      setAutoCenter,
      zoom,
      setZoom,
      zoomMin,
      zoomMax,
      debugInfo,
      outputWidth,
      outputHeight,
      devices,
      deviceId,
      selectDevice,
      refreshDevices,
    ],
  )
}
