"use client"

import type { CSSProperties } from "react"

export interface CameraDevicePickerProps {
  /** The `devices` array returned by `useFaceCenteredPortrait`. */
  devices: MediaDeviceInfo[]
  /** The `deviceId` returned by `useFaceCenteredPortrait`. */
  deviceId: string | null
  /** Call with the hook's `selectDevice`, or your own handler. */
  onSelect: (deviceId: string) => void
  className?: string
  style?: CSSProperties
}

/**
 * Default `<select>` for switching cameras, built from the hook's raw
 * `devices`/`deviceId`/`selectDevice`. This is a thin, presentational
 * convenience — it renders nothing when there's only one (or zero) camera.
 * For custom UI (buttons, a modal, icons, etc.), ignore this component and
 * build your own directly from those same hook values instead.
 */
export function CameraDevicePicker({
  devices,
  deviceId,
  onSelect,
  className,
  style,
}: CameraDevicePickerProps) {
  if (devices.length < 2) return null

  return (
    <select
      className={className}
      value={deviceId ?? ""}
      onChange={(e) => onSelect(e.target.value)}
      style={{
        padding: "8px 12px",
        borderRadius: 6,
        border: "1px solid #404040",
        background: "#171717",
        color: "#f5f5f5",
        fontSize: 14,
        ...style,
      }}
    >
      {devices.map((device, index) => (
        <option key={device.deviceId} value={device.deviceId}>
          {device.label || `Camera ${index + 1}`}
        </option>
      ))}
    </select>
  )
}
