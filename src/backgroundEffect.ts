import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision"

import type { BackgroundEffectOptions } from "./types"

const DEFAULT_BLUR_PX = 16

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

/** Scales+crops `image` to fill `w`x`h`, like CSS `object-fit: cover`. */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageW: number,
  imageH: number,
  w: number,
  h: number,
) {
  const scale = Math.max(w / imageW, h / imageH)
  const drawW = imageW * scale
  const drawH = imageH * scale
  const dx = (w - drawW) / 2
  const dy = (h - drawH) / 2
  ctx.drawImage(image, dx, dy, drawW, drawH)
}

/**
 * Runs MediaPipe selfie segmentation on a throttled cadence and composites
 * a blurred or replaced background behind the segmented person, at the
 * source video's native resolution. Not exported from the package — driven
 * internally by `useFaceCenteredPortrait`.
 */
export class BackgroundEffectEngine {
  private segmenter: ImageSegmenter | null = null
  private latestMask: { data: Float32Array; width: number; height: number } | null = null

  private maskCanvas: HTMLCanvasElement | null = null
  private fgCanvas: HTMLCanvasElement | null = null
  private layerCanvas: HTMLCanvasElement | null = null
  private outCanvas: HTMLCanvasElement | null = null

  private bgImage: HTMLImageElement | null = null
  private bgImageUrl: string | null = null

  async ensure(wasmBaseUrl: string, modelAssetPath: string, delegate: "CPU" | "GPU") {
    if (this.segmenter) return
    const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl)
    this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate },
      outputConfidenceMasks: true,
      outputCategoryMask: false,
      runningMode: "VIDEO",
    })
  }

  get isReady() {
    return this.segmenter !== null
  }

  run(video: HTMLVideoElement, now: number) {
    if (!this.segmenter) return
    try {
      const result = this.segmenter.segmentForVideo(video, now)
      const mask = result.confidenceMasks?.[0]
      if (mask) {
        this.latestMask = { data: mask.getAsFloat32Array(), width: mask.width, height: mask.height }
      }
      result.confidenceMasks?.forEach((m) => m.close())
      result.categoryMask?.close()
    } catch (err) {
      console.error("[react-face-centered-portrait] background segmentation failed", err)
    }
  }

  private getBgImage(url: string): HTMLImageElement {
    if (!this.bgImage || this.bgImageUrl !== url) {
      const img = new Image()
      img.crossOrigin = "anonymous"
      img.src = url
      this.bgImage = img
      this.bgImageUrl = url
    }
    return this.bgImage
  }

  /**
   * Returns a canvas containing `video`, at `vw`x`vh`, with its background
   * blurred or replaced — or `null` if no segmentation mask has arrived yet
   * (caller should fall back to drawing `video` directly for that frame).
   */
  composite(
    video: HTMLVideoElement,
    vw: number,
    vh: number,
    options: BackgroundEffectOptions,
  ): HTMLCanvasElement | null {
    if (!this.latestMask) return null

    this.maskCanvas ??= document.createElement("canvas")
    this.fgCanvas ??= document.createElement("canvas")
    this.layerCanvas ??= document.createElement("canvas")
    this.outCanvas ??= document.createElement("canvas")

    const { data: maskData, width: mw, height: mh } = this.latestMask
    resizeCanvas(this.maskCanvas, mw, mh)
    const maskCtx = this.maskCanvas.getContext("2d")
    if (!maskCtx) return null
    const maskImage = maskCtx.createImageData(mw, mh)
    for (let i = 0; i < maskData.length; i++) {
      const alpha = Math.round(clamp01(maskData[i]) * 255)
      const offset = i * 4
      maskImage.data[offset] = 255
      maskImage.data[offset + 1] = 255
      maskImage.data[offset + 2] = 255
      maskImage.data[offset + 3] = alpha
    }
    maskCtx.putImageData(maskImage, 0, 0)

    // Foreground: the person, cut out via the mask's alpha channel.
    resizeCanvas(this.fgCanvas, vw, vh)
    const fgCtx = this.fgCanvas.getContext("2d")
    if (!fgCtx) return null
    fgCtx.clearRect(0, 0, vw, vh)
    fgCtx.globalCompositeOperation = "source-over"
    fgCtx.drawImage(video, 0, 0, vw, vh)
    fgCtx.globalCompositeOperation = "destination-in"
    fgCtx.drawImage(this.maskCanvas, 0, 0, vw, vh)
    fgCtx.globalCompositeOperation = "source-over"

    // Background layer: blurred video, or the replacement image.
    resizeCanvas(this.layerCanvas, vw, vh)
    const layerCtx = this.layerCanvas.getContext("2d")
    if (!layerCtx) return null
    layerCtx.clearRect(0, 0, vw, vh)
    if (options.mode === "image" && options.imageUrl) {
      const img = this.getBgImage(options.imageUrl)
      if (img.complete && img.naturalWidth > 0) {
        drawImageCover(layerCtx, img, img.naturalWidth, img.naturalHeight, vw, vh)
      } else {
        // Image not loaded yet — blur the real frame so the preview isn't blank.
        layerCtx.filter = `blur(${options.blurPx ?? DEFAULT_BLUR_PX}px)`
        layerCtx.drawImage(video, 0, 0, vw, vh)
        layerCtx.filter = "none"
      }
    } else {
      layerCtx.filter = `blur(${options.blurPx ?? DEFAULT_BLUR_PX}px)`
      layerCtx.drawImage(video, 0, 0, vw, vh)
      layerCtx.filter = "none"
    }

    resizeCanvas(this.outCanvas, vw, vh)
    const outCtx = this.outCanvas.getContext("2d")
    if (!outCtx) return null
    outCtx.clearRect(0, 0, vw, vh)
    outCtx.drawImage(this.layerCanvas, 0, 0)
    outCtx.drawImage(this.fgCanvas, 0, 0)

    return this.outCanvas
  }

  close() {
    this.segmenter?.close()
    this.segmenter = null
    this.latestMask = null
    this.bgImage = null
    this.bgImageUrl = null
  }
}
