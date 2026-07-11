"use client"

import type { CSSProperties, RefObject } from "react"

export interface RawCameraPreviewProps {
  /** The `videoRef` returned by `useFaceCenteredPortrait`. */
  videoRef: RefObject<HTMLVideoElement | null>
  /** Flip the preview horizontally to match the portrait canvas. Default: true. */
  mirror?: boolean
  /** Width of the preview element (any valid CSS width). Default: 224px. */
  width?: number | string
  /** Visually hide the preview while keeping the `<video>` element mounted (the hook needs it mounted even when unused). Default: false. */
  hidden?: boolean
  /** Text shown under the preview. Set to `null` to omit it. Default: "Raw camera (debug)". */
  label?: string | null
  className?: string
  style?: CSSProperties
}

/**
 * Small unprocessed webcam preview, useful for confirming the raw feed
 * while debugging the face-centered crop. Renders the actual `<video>`
 * element the hook streams into — do not render a second `<video>` for the
 * same hook instance.
 */
export function RawCameraPreview({
  videoRef,
  mirror = true,
  width = 224,
  hidden = false,
  label = "Raw camera (debug)",
  className,
  style,
}: RawCameraPreviewProps) {
  return (
    <div
      className={className}
      style={{
        display: hidden ? "none" : "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        ...style,
      }}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          width,
          borderRadius: 8,
          border: "1px solid #262626",
          background: "#171717",
          transform: mirror ? "scaleX(-1)" : undefined,
        }}
      />
      {label !== null && (
        <p style={{ fontSize: 12, color: "#737373", margin: 0 }}>{label}</p>
      )}
    </div>
  )
}
