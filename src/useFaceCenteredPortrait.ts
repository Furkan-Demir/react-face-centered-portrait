"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import { FaceDetector, FilesetResolver, type Detection } from "@mediapipe/tasks-vision"

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
const DEFAULT_ZOOM_MIN = 0.6
const DEFAULT_ZOOM_MAX = 3
const DEFAULT_ZOOM_DEFAULT = 0.85
const DEFAULT_MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
const DEFAULT_WASM_BASE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
const DEFAULT_DELEGATE: "CPU" | "GPU" = "CPU"
const DEFAULT_MIN_DETECTION_CONFIDENCE = 0.5

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

  const latestFaceRef = useRef<{ x: number; y: number; detected: boolean }>({
    x: 0,
    y: 0,
    detected: false,
  })
  const smoothedCenterRef = useRef<Point | null>(null)

  const lastDetectionTimeRef = useRef(0)
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

  useEffect(() => {
    autoCenterRef.current = autoCenter
  }, [autoCenter])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  const runDetection = useCallback((now: number) => {
    const video = videoRef.current
    const detector = detectorRef.current
    if (!video || !detector) return

    try {
      const result = detector.detectForVideo(video, now)
      const best: Detection | undefined = result.detections[0]

      if (best?.boundingBox) {
        const { originX, originY, width, height } = best.boundingBox
        latestFaceRef.current = {
          x: originX + width / 2,
          y: originY + height / 2,
          detected: true,
        }
      } else {
        latestFaceRef.current = { ...latestFaceRef.current, detected: false }
      }

      lastDetectionTsRef.current = now
    } catch (err) {
      console.error("[react-face-centered-portrait] face detection failed", err)
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

    const sx = clamp(smoothed.x - contentCropW / 2, 0, vw - contentCropW)
    const sy = clamp(smoothed.y - contentCropH / 2, 0, vh - contentCropH)

    // "Contain" fit: scale the content into the canvas without distortion,
    // padding with black bars on whichever axis has leftover space.
    const fitScale = Math.min(canvas.width / contentCropW, canvas.height / contentCropH)
    const drawW = contentCropW * fitScale
    const drawH = contentCropH * fitScale
    const dx = (canvas.width - drawW) / 2
    const dy = (canvas.height - drawH) / 2

    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const mirror = optionsRef.current.mirror ?? true
    ctx.save()
    if (mirror) {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, sx, sy, contentCropW, contentCropH, dx, dy, drawW, drawH)
    ctx.restore()

    cropCenterRef.current = { x: sx + contentCropW / 2, y: sy + contentCropH / 2 }
    renderCountRef.current += 1
  }, [outputAspect, zoomMin, zoomMax])

  const stop = useCallback(() => {
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

  const start = useCallback(async () => {
    setError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error")
      setError("This browser does not support camera access.")
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

      setStatus("active")

      lastDetectionTimeRef.current = 0
      lastRenderTimeRef.current = 0
      renderCountRef.current = 0

      const detectionIntervalMs = 1000 / (optionsRef.current.detectionFps ?? DEFAULT_DETECTION_FPS)
      const renderIntervalMs = 1000 / (optionsRef.current.renderFps ?? DEFAULT_RENDER_FPS)

      const tick = (now: number) => {
        rafIdRef.current = requestAnimationFrame(tick)

        if (!videoRef.current || videoRef.current.readyState < 2) return

        if (now - lastDetectionTimeRef.current >= detectionIntervalMs) {
          lastDetectionTimeRef.current = now
          runDetection(now)
        }

        if (now - lastRenderTimeRef.current >= renderIntervalMs) {
          lastRenderTimeRef.current = now
          drawFrame()
        }
      }
      rafIdRef.current = requestAnimationFrame(tick)
    } catch (err) {
      console.error("[react-face-centered-portrait] failed to start camera", err)
      stop()
      setStatus("error")
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Camera permission was denied.")
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        setError("No camera device was found.")
      } else {
        setError(err instanceof Error ? err.message : "Unknown error")
      }
    }
  }, [drawFrame, runDetection, stop])

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
    }
  }, [])

  return {
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
  }
}
