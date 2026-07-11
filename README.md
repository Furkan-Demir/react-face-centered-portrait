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
- **Rule-of-thirds framing**: optionally anchor the tracked point in the upper third of the frame instead of dead-center, for less claustrophobic framing.
- **Background blur or replacement**, via MediaPipe's selfie segmentation model — fully opt-in, zero cost if unused.
- **Camera device picker**: enumerate and switch cameras mid-session, exposed as raw hook state (build your own UI) or via the included `CameraDevicePicker` component.
- **Lifecycle callbacks** (`onStart`, `onStop`, `onError`, `onFaceDetected`, `onFaceLost`) for hooking your own logic without polling.
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
| `useFaceCenteredPortrait(options?)` | hook | Core logic: camera lifecycle, face detection, smoothing, crop, zoom, framing, background effects, device switching. No UI — bring your own `<video>`/`<canvas>`/controls. |
| `<FaceCenteredPortrait options? />` | component | Batteries-included: renders the portrait canvas + controls + device picker + debug camera + stats panel using the hook internally. |
| `<RawCameraPreview videoRef />` | component | Standalone raw webcam view, for placing the debug feed anywhere in your own layout. Must be passed the *same* `videoRef` the hook returned — it renders the actual `<video>` element the hook streams into. |
| `<DebugInfoPanel status debugInfo />` | component | Standalone stats grid (camera status, face detected, face/crop center, last detection timestamp, render count). |
| `<CameraDevicePicker devices deviceId onSelect />` | component | Default `<select>` for switching cameras, built from the hook's raw `devices`/`deviceId`/`selectDevice`. Purely presentational — pass your own handler, or skip it and build a custom picker (buttons, a modal, icons) directly from those same hook values. |

All exports are named (no default export) and importable individually:

```ts
import {
  useFaceCenteredPortrait,
  FaceCenteredPortrait,
  RawCameraPreview,
  DebugInfoPanel,
  CameraDevicePicker,
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
| `modelAssetPath` | `string` | official MediaPipe CDN `.tflite` URL (short-range BlazeFace) | Override to self-host the face detection model file. |
| `wasmBaseUrl` | `string` | official MediaPipe CDN wasm fileset URL | Override to self-host the wasm runtime (shared by face detection and background segmentation). |
| `delegate` | `"CPU" \| "GPU"` | `"CPU"` | MediaPipe inference delegate, used for both face detection and segmentation. `"GPU"` is faster but less consistently supported across browsers (notably Safari) — see [Browser support](#browser-support). |
| `minDetectionConfidence` | `number` | `0.5` | Minimum confidence for a detection to count as a face. |
| `framing` | `"center" \| "ruleOfThirds"` | `"center"` | Vertical anchor for the tracked point within the crop. `"ruleOfThirds"` leaves headroom above the face instead of dead-centering it. |
| `background` | `{ mode: "blur" \| "image", blurPx?: number, imageUrl?: string }` | `undefined` | Enables background blur/replacement. Omit entirely to skip loading the segmentation model (zero extra cost). Can be set or changed at any time, including mid-session. See [Background blur & replacement](#background-blur--replacement). |
| `segmentationFps` | `number` | `9` | How often background segmentation runs. Independent of `detectionFps`/`renderFps`. |
| `segmentationModelAssetPath` | `string` | official MediaPipe CDN `.tflite` URL (selfie segmenter) | Override to self-host the segmentation model file. |
| `onStart` | `() => void` | `undefined` | Called once `start()` has successfully begun streaming. |
| `onStop` | `() => void` | `undefined` | Called when `stop()` is invoked. Not called on internal error-cleanup — see `onError`. |
| `onError` | `(message: string) => void` | `undefined` | Called with a readable message whenever `status` transitions to `"error"` (also fires for `selectDevice` failures). |
| `onFaceDetected` | `(point: { x: number; y: number }) => void` | `undefined` | Called once when a face newly appears (edge-triggered, not on every detection tick), with its center in source-video pixel coordinates. |
| `onFaceLost` | `() => void` | `undefined` | Called once when a previously-detected face disappears. |

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
| `devices` | `MediaDeviceInfo[]` | Available video input devices. Populated after the first successful `start()` and kept in sync via the browser's `devicechange` event. |
| `deviceId` | `string \| null` | `deviceId` of the currently active camera, or `null` before the first `start()`. |
| `selectDevice(deviceId)` | `(deviceId: string) => Promise<void>` | Switches the active camera mid-session without reloading the face detector or segmentation model. |
| `refreshDevices()` | `() => Promise<void>` | Re-runs device enumeration. Called automatically; exposed for manual refresh. |

## How the crop works

1. **Detection** runs on the raw video at `detectionFps`, producing a face bounding-box center in source-video pixel coordinates (or "no face" if none found).
2. That target center — the face center if `autoCenter` is on and a face is detected, otherwise the frame center — is smoothed toward with exponential smoothing every render tick, so the crop eases rather than snaps.
3. The **widest crop obtainable without padding** is computed first (uses the source video's full height or width, whichever is the limiting dimension for a 9:16 slice). This is what `zoom = 1` maps to.
4. The zoom level divides that crop's dimensions: `zoom > 1` shrinks it (tighter framing), `zoom < 1` grows it beyond what the source can provide — the source rect is clamped to the video's actual bounds, and the resulting gap is rendered as **letterbox bars** (via a "contain" fit into the canvas) instead of stretching or upscaling.
5. The crop is centered on the smoothed point and clamped so it never reads outside the source video.
6. The frame is drawn into the canvas (mirrored by default) via a single `ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)` call.

## Background blur & replacement

Opt in with the `background` option — omitting it entirely (the default) skips
loading the segmentation model, so there's no cost unless you use it:

```tsx
// Blur
useFaceCenteredPortrait({ background: { mode: "blur", blurPx: 20 } })

// Replace with an image (must be CORS-accessible — see the option's JSDoc)
useFaceCenteredPortrait({
  background: { mode: "image", imageUrl: "https://example.com/office-bg.jpg" },
})
```

Runs MediaPipe's selfie segmentation model (`segmentationFps`, default 9fps —
independent of face detection) and composites the result before the 9:16 crop
is applied, so the effect stays correctly aligned regardless of zoom/framing.
You can toggle it on/off or swap `imageUrl` at any time, including while the
camera is already running — the segmentation model loads lazily the first
time `background` is set.

**Note on `imageUrl`:** the image is drawn onto a `<canvas>`, so it's subject
to the same-origin/CORS rules as any canvas operation. If the image isn't
served with a permissive `Access-Control-Allow-Origin` header, the canvas
becomes "tainted" — the background effect still *displays* fine, but
`canvas.captureStream()`/`toDataURL()`/`toBlob()` will throw or silently
break. Host the image yourself with CORS enabled, or use a CORS-friendly CDN.

## Camera device picker

The hook exposes raw device state so you can build any UI you want:

```tsx
const { devices, deviceId, selectDevice } = useFaceCenteredPortrait()

<select value={deviceId ?? ""} onChange={(e) => selectDevice(e.target.value)}>
  {devices.map((d, i) => (
    <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
  ))}
</select>
```

Or use the included `CameraDevicePicker` for the same thing without writing
it yourself:

```tsx
import { useFaceCenteredPortrait, CameraDevicePicker } from "react-face-centered-portrait"

const { devices, deviceId, selectDevice } = useFaceCenteredPortrait()

<CameraDevicePicker devices={devices} deviceId={deviceId} onSelect={selectDevice} />
```

`devices` populates after the first `start()` (device labels require camera
permission to be readable) and stays in sync as cameras are plugged/unplugged.
`selectDevice` swaps the active stream without reloading the face detector or
segmentation model, so switching cameras mid-call is cheap.

## Rule-of-thirds framing

```tsx
useFaceCenteredPortrait({ framing: "ruleOfThirds" })
```

By default (`"center"`) the tracked point sits at the vertical center of the
crop. `"ruleOfThirds"` instead pins it about a third of the way down, leaving
headroom above the face — closer to how Zoom/Teams "smart framing" looks,
and generally reads as less claustrophobic in a tall 9:16 frame.

## Lifecycle callbacks

```tsx
useFaceCenteredPortrait({
  onStart: () => console.log("camera live"),
  onStop: () => console.log("camera stopped"),
  onError: (message) => toast.error(message),
  onFaceDetected: (point) => console.log("face appeared at", point),
  onFaceLost: () => console.log("face left the frame"),
})
```

`onFaceDetected`/`onFaceLost` are edge-triggered — they fire once on the
transition, not on every detection tick — so they're safe to use for things
like analytics events or pausing/resuming a recording, without needing to
debounce `debugInfo.faceDetected` yourself.

## Browser support

- Requires `navigator.mediaDevices.getUserMedia`, available in all modern browsers — but **only over HTTPS or `localhost`**.
- Camera permission prompts and denial UX differ by browser; `error` surfaces `NotAllowedError`/`NotFoundError` as readable messages, but you may want additional guidance for your users (e.g. linking to browser permission settings).
- Safari's WebGL-backed `"GPU"` delegate for `@mediapipe/tasks-vision` is less reliable than Chrome/Edge's. The default delegate is `"CPU"`, which is plenty fast for the short-range face detector at this resolution — only switch to `"GPU"` if you've verified it on your target browsers.
- Background blur/replacement runs a second model (selfie segmentation) alongside face detection. On CPU delegate this is noticeably heavier than face detection alone — test on the lowest-end device you expect to support before shipping it as always-on; it's opt-in for exactly this reason.

## Self-hosting the model/wasm assets

By default, `modelAssetPath`, `segmentationModelAssetPath`, and `wasmBaseUrl`
point at Google's public CDN, which is the simplest way to get started and
matches MediaPipe's own docs. To avoid the runtime CDN dependency (e.g. for
offline use or stricter CSPs), copy the assets into your own app's public
directory and override the relevant options:

```tsx
useFaceCenteredPortrait({
  wasmBaseUrl: "/mediapipe/wasm",
  modelAssetPath: "/mediapipe/blaze_face_short_range.tflite",
  segmentationModelAssetPath: "/mediapipe/selfie_segmenter.tflite", // only needed if using `background`
})
```

The wasm fileset ships inside the installed package at
`node_modules/@mediapipe/tasks-vision/wasm`; the model files can be downloaded
from the
[face detector](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector#models)
and
[image segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter#models)
model cards.

## Development (this package)

```bash
npm install
npm run typecheck
npm run build   # emits dist/ (ESM + CJS + .d.ts) via tsup
```

## License

MIT
