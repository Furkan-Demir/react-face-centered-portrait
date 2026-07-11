"use client"

import type { CSSProperties } from "react"

import { CameraDevicePicker } from "./CameraDevicePicker"
import { DebugInfoPanel } from "./DebugInfoPanel"
import { RawCameraPreview } from "./RawCameraPreview"
import type { FaceCenteredPortraitOptions } from "./types"
import { useFaceCenteredPortrait } from "./useFaceCenteredPortrait"

export interface FaceCenteredPortraitProps extends FaceCenteredPortraitOptions {
  /** Label under the portrait canvas. Set to `null` to omit it. Default: "Patient will see this". */
  label?: string | null
  /** Show Start/Stop buttons and the auto-center/zoom controls. Default: true. */
  showControls?: boolean
  /** Show the small raw webcam preview. Default: true. */
  showDebugCamera?: boolean
  /** Show the live status/face-center/crop-center stats panel. Default: true. */
  showDebugInfo?: boolean
  /** Show the camera picker when more than one camera is available. Default: true. */
  showDevicePicker?: boolean
  className?: string
  style?: CSSProperties
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
  color: "#f5f5f5",
}

const phoneFrameStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "9 / 16",
  maxHeight: "80vh",
  height: "80vh",
  width: "auto",
  overflow: "hidden",
  borderRadius: 24,
  border: "1px solid #404040",
  background: "#000",
  boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
}

const canvasStyle: CSSProperties = {
  height: "100%",
  width: "100%",
  objectFit: "contain",
}

const controlsRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
}

function buttonStyle(disabled: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 9999,
    border: "1px solid #404040",
    background: disabled ? "#171717" : "#262626",
    color: disabled ? "#525252" : "#f5f5f5",
    fontSize: 14,
    cursor: disabled ? "not-allowed" : "pointer",
  }
}

function toggleStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 6,
    border: `1px solid ${active ? "#10b981" : "#404040"}`,
    background: active ? "rgba(16, 185, 129, 0.1)" : "#171717",
    color: active ? "#34d399" : "#a3a3a3",
    fontSize: 14,
    cursor: "pointer",
  }
}

/**
 * Drop-in, batteries-included face-centered portrait camera preview.
 * For custom UI, use `useFaceCenteredPortrait` directly instead.
 */
export function FaceCenteredPortrait({
  label = "Patient will see this",
  showControls = true,
  showDebugCamera = true,
  showDebugInfo = true,
  showDevicePicker = true,
  className,
  style,
  ...options
}: FaceCenteredPortraitProps) {
  const {
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
  } = useFaceCenteredPortrait(options)

  const isActive = status === "active"
  const isRequesting = status === "requesting"

  return (
    <div className={className} style={{ ...rootStyle, ...style }}>
      {showControls && (
        <div style={controlsRowStyle}>
          <button
            type="button"
            onClick={start}
            disabled={isActive || isRequesting}
            style={buttonStyle(isActive || isRequesting)}
          >
            {isRequesting ? "Starting…" : "Start camera"}
          </button>
          <button type="button" onClick={stop} disabled={!isActive} style={buttonStyle(!isActive)}>
            Stop camera
          </button>
          <button
            type="button"
            onClick={() => setAutoCenter((prev) => !prev)}
            style={toggleStyle(autoCenter)}
          >
            Auto-center face: {autoCenter ? "On" : "Off"}
          </button>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #404040",
              background: "#171717",
              fontSize: 14,
            }}
          >
            <span style={{ color: "#a3a3a3" }}>Zoom</span>
            <input
              type="range"
              min={zoomMin}
              max={zoomMax}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <span style={{ width: 36, textAlign: "right", color: "#f5f5f5" }}>
              {zoom.toFixed(1)}x
            </span>
          </div>
          {showDevicePicker && (
            <CameraDevicePicker devices={devices} deviceId={deviceId} onSelect={selectDevice} />
          )}
        </div>
      )}

      {error && (
        <p
          style={{
            maxWidth: 384,
            margin: 0,
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #7f1d1d",
            background: "rgba(69, 10, 10, 0.5)",
            color: "#fca5a5",
            fontSize: 14,
            textAlign: "center",
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 32, justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={phoneFrameStyle}>
            <canvas ref={canvasRef} width={outputWidth} height={outputHeight} style={canvasStyle} />
          </div>
          {label !== null && (
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#d4d4d4" }}>{label}</p>
          )}
        </div>

        <RawCameraPreview
          videoRef={videoRef}
          mirror={options.mirror ?? true}
          hidden={!showDebugCamera}
        />
      </div>

      {showDebugInfo && (
        <DebugInfoPanel status={status} debugInfo={debugInfo} style={{ width: "100%", maxWidth: 384 }} />
      )}
    </div>
  )
}
