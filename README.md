# react-face-centered-portrait

A React hook + drop-in components that turn a landscape webcam feed into a
face-detected, auto-centered **9:16 portrait** preview — the "how the other
person sees you on mobile" shot for video call apps.

Face detection runs fully in the browser via
[MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector)
(no server round-trip). The crop follows the detected face with exponential
smoothing so it doesn't jitter, and falls back to a plain center crop when no
face is visible.

## Features

- **Headless hook** (`useFaceCenteredPortrait`) for full control over your own UI, or a **drop-in component** (`FaceCenteredPortrait`) for zero-setup usage.
- Face-following 9:16 crop with smoothed (non-jittery) camera movement.
- **Zoom control** (0.6x–3x by default): zooming in tightens the crop on the face; zooming out past 1x reveals more of the frame via letterbox bars (there's no more sensor resolution to crop from, so the extra space is padded rather than upscaled).
- Selfie-style horizontal mirroring, on by default.
- Separate exported **debug webcam view** (`RawCameraPreview`) and **stats panel** (`DebugInfoPanel`) for development/QA.
- Detection and rendering run at independent, configurable frame rates (defaults: ~9fps detection, ~24fps render) so face tracking never blocks smooth drawing.
- Works in any React app — Next.js (App Router, marked `"use client"` automatically), Vite, CRA, Remix, etc. No CSS framework required.
- Zero React state updates from the per-frame render loop — all hot-path values live in refs.

## Installation

```bash
npm install react-face-centered-portrait
```

`react` and `react-dom` (>=18) are peer dependencies; `@mediapipe/tasks-vision`
is installed automatically.

## Quick start

### Option A — drop-in component

The fastest way to get a working preview. Renders the portrait canvas, Start/Stop
buttons, an auto-center toggle, a zoom slider, the raw debug webcam, and a live
stats panel.

```tsx
import { FaceCenteredPortrait } from "react-face-centered-portrait"

export default function CallPreview() {
  return <FaceCenteredPortrait />
}
```

Turn pieces off individually once you know what you want to keep:

```tsx
<FaceCenteredPortrait
  label="Patient will see this"
  showDebugCamera={false}
  showDebugInfo={false}
/>
```

### Option B — headless hook (custom UI)

Use this when you want your own layout/styling/design system, or need to plug
the canvas into something else (e.g. feeding it to a WebRTC canvas track).

```tsx
import { useFaceCenteredPortrait } from "react-face-centered-portrait"

export default function CallPreview() {
  const { videoRef, canvasRef, status, error, start, stop, autoCenter, setAutoCenter, zoom, setZoom } =
    useFaceCenteredPortrait()

  return (
    <div>
      <button onClick={start} disabled={status === "active"}>
        Start camera
      </button>
      <button onClick={stop} disabled={status !== "active"}>
        Stop camera
      </button>
      {error && <p>{error}</p>}

      {/* Must stay mounted — the hook streams into this element. */}
      <video ref={videoRef} muted playsInline style={{ display: "none" }} />

      <canvas ref={canvasRef} width={720} height={1280} />
    </div>
  )
}
```

## Exports

| Export | Type | Purpose |
| --- | --- | --- |
| `useFaceCenteredPortrait(options?)` | hook | Core logic: camera lifecycle, face detection, smoothing, crop, zoom, letterbox, mirroring. No UI — bring your own `<video>`/`<canvas>`/controls. |
| `<FaceCenteredPortrait options? />` | component | Batteries-included: renders the portrait canvas + controls + debug camera + stats panel using the hook internally. |
| `<RawCameraPreview videoRef />` | component | Standalone raw webcam view, for placing the debug feed anywhere in your own layout. Must be passed the *same* `videoRef` the hook returned — it renders the actual `<video>` element the hook streams into. |
| `<DebugInfoPanel status debugInfo />` | component | Standalone stats grid (camera status, face detected, face/crop center, last detection timestamp, render count). |

All exports are named (no default export) and importable individually:

```ts
import {
  useFaceCenteredPortrait,
  FaceCenteredPortrait,
  RawCameraPreview,
  DebugInfoPanel,
} from "react-face-centered-portrait"
```

## `useFaceCenteredPortrait(options)`

### Options

All fields are optional.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `outputWidth` | `number` | `720` | Canvas width in pixels. |
| `outputHeight` | `number` | `1280` | Canvas height in pixels. Together with `outputWidth` this defines the output aspect ratio (default 9:16). |
| `videoConstraints` | `MediaTrackConstraints` | `{ width: 1280, height: 720, frameRate: 30 }` | Passed to `getUserMedia({ video })`. |
| `mirror` | `boolean` | `true` | Flip the preview horizontally (selfie view). |
| `smoothing` | `number` | `0.85` | Exponential smoothing factor for the crop center, `0`–`1`. Higher = smoother but slower to follow the face. `smoothedX = smoothedX * smoothing + targetX * (1 - smoothing)`. |
| `detectionFps` | `number` | `9` | How often MediaPipe runs detection. Kept below the render rate since inference is the expensive step. |
| `renderFps` | `number` | `24` | How often the canvas is redrawn. |
| `autoCenterDefault` | `boolean` | `true` | Initial value of `autoCenter`. When off, the crop stays centered on the frame regardless of face position. |
| `zoomMin` | `number` | `0.6` | Most-zoomed-out value. Below `1`, extra width is revealed via letterbox bars rather than upscaling. |
| `zoomMax` | `number` | `3` | Most-zoomed-in value. |
| `zoomDefault` | `number` | `0.85` | Initial zoom level. |
| `modelAssetPath` | `string` | official MediaPipe CDN `.tflite` URL (short-range BlazeFace) | Override to self-host the model file. |
| `wasmBaseUrl` | `string` | official MediaPipe CDN wasm fileset URL | Override to self-host the wasm runtime. |
| `delegate` | `"CPU" \| "GPU"` | `"CPU"` | MediaPipe inference delegate. `"GPU"` is faster but less consistently supported across browsers (notably Safari) — see [Browser support](#browser-support). |
| `minDetectionConfidence` | `number` | `0.5` | Minimum confidence for a detection to count as a face. |

### Return value

| Field | Type | Description |
| --- | --- | --- |
| `videoRef` | `RefObject<HTMLVideoElement>` | Attach to a `<video>` element. Must stay mounted for the hook's lifetime (can be visually hidden, e.g. via `RawCameraPreview`'s `hidden` prop or `display: none`). |
| `canvasRef` | `RefObject<HTMLCanvasElement>` | Attach to a `<canvas>` sized `outputWidth` × `outputHeight`. This is the portrait preview. |
| `status` | `"idle" \| "requesting" \| "active" \| "error" \| "stopped"` | Camera/detector lifecycle state. |
| `error` | `string \| null` | Human-readable error (permission denied, no camera, unsupported browser, etc.). |
| `start()` | `() => Promise<void>` | Requests camera permission, loads the face detector (once, cached across `start`/`stop` cycles), and starts the render loop. |
| `stop()` | `() => void` | Stops all media tracks, cancels the render loop, and clears state. |
| `autoCenter` / `setAutoCenter` | `boolean` / setter | Whether the crop follows the detected face. When `false` (or no face is detected), the crop smoothly returns to the frame center. |
| `zoom` / `setZoom` | `number` / setter | Current zoom level, within `[zoomMin, zoomMax]`. |
| `zoomMin` / `zoomMax` | `number` | Resolved zoom bounds, for building your own slider. |
| `debugInfo` | `{ faceDetected, faceCenter, cropCenter, lastDetectionTs, renderCount }` | Synced from internal refs ~4x/second — safe to render directly. |
| `outputWidth` / `outputHeight` | `number` | Resolved canvas dimensions, for sizing your `<canvas>` element. |

## How the crop works

1. **Detection** runs on the raw video at `detectionFps`, producing a face bounding-box center in source-video pixel coordinates (or "no face" if none found).
2. That target center — the face center if `autoCenter` is on and a face is detected, otherwise the frame center — is smoothed toward with exponential smoothing every render tick, so the crop eases rather than snaps.
3. The **widest crop obtainable without padding** is computed first (uses the source video's full height or width, whichever is the limiting dimension for a 9:16 slice). This is what `zoom = 1` maps to.
4. The zoom level divides that crop's dimensions: `zoom > 1` shrinks it (tighter framing), `zoom < 1` grows it beyond what the source can provide — the source rect is clamped to the video's actual bounds, and the resulting gap is rendered as **letterbox bars** (via a "contain" fit into the canvas) instead of stretching or upscaling.
5. The crop is centered on the smoothed point and clamped so it never reads outside the source video.
6. The frame is drawn into the canvas (mirrored by default) via a single `ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)` call.

## Browser support

- Requires `navigator.mediaDevices.getUserMedia`, available in all modern browsers — but **only over HTTPS or `localhost`**.
- Camera permission prompts and denial UX differ by browser; `error` surfaces `NotAllowedError`/`NotFoundError` as readable messages, but you may want additional guidance for your users (e.g. linking to browser permission settings).
- Safari's WebGL-backed `"GPU"` delegate for `@mediapipe/tasks-vision` is less reliable than Chrome/Edge's. The default delegate is `"CPU"`, which is plenty fast for the short-range face detector at this resolution — only switch to `"GPU"` if you've verified it on your target browsers.

## Self-hosting the model/wasm assets

By default, `modelAssetPath` and `wasmBaseUrl` point at Google's public CDN, which
is the simplest way to get started and matches MediaPipe's own docs. To avoid the
runtime CDN dependency (e.g. for offline use or stricter CSPs), copy the assets
into your own app's public directory and override both options:

```tsx
useFaceCenteredPortrait({
  wasmBaseUrl: "/mediapipe/wasm",
  modelAssetPath: "/mediapipe/blaze_face_short_range.tflite",
})
```

The wasm fileset ships inside the installed package at
`node_modules/@mediapipe/tasks-vision/wasm`; the model file can be downloaded from
the [MediaPipe model card](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector#models).

## Development (this package)

```bash
npm install
npm run typecheck
npm run build   # emits dist/ (ESM + CJS + .d.ts) via tsup
```

## License

MIT
