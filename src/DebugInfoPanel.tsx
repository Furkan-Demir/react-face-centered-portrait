"use client"

import type { CSSProperties } from "react"

import type { FaceCenteredPortraitDebugInfo, FaceCenteredPortraitStatus } from "./types"

export interface DebugInfoPanelProps {
  status: FaceCenteredPortraitStatus
  debugInfo: FaceCenteredPortraitDebugInfo
  className?: string
  style?: CSSProperties
}

const rowLabelStyle: CSSProperties = { color: "#a3a3a3", margin: 0 }
const rowValueStyle: CSSProperties = { color: "#e5e5e5", margin: 0 }

function formatPoint(point: { x: number; y: number } | null) {
  return point ? `${point.x.toFixed(0)}, ${point.y.toFixed(0)}` : "—"
}

/** Renders the hook's live `debugInfo` + `status` as a small stats grid. */
export function DebugInfoPanel({ status, debugInfo, className, style }: DebugInfoPanelProps) {
  return (
    <dl
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "4px 16px",
        margin: 0,
        padding: 16,
        borderRadius: 8,
        border: "1px solid #262626",
        background: "rgba(23, 23, 23, 0.5)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: 12,
        ...style,
      }}
    >
      <dt style={rowLabelStyle}>Camera status</dt>
      <dd style={rowValueStyle}>{status}</dd>

      <dt style={rowLabelStyle}>Face detected</dt>
      <dd style={rowValueStyle}>{debugInfo.faceDetected ? "yes" : "no"}</dd>

      <dt style={rowLabelStyle}>Face center</dt>
      <dd style={rowValueStyle}>{formatPoint(debugInfo.faceCenter)}</dd>

      <dt style={rowLabelStyle}>Crop center</dt>
      <dd style={rowValueStyle}>{formatPoint(debugInfo.cropCenter)}</dd>

      <dt style={rowLabelStyle}>Last detection</dt>
      <dd style={rowValueStyle}>
        {debugInfo.lastDetectionTs ? `${debugInfo.lastDetectionTs.toFixed(0)} ms` : "—"}
      </dd>

      <dt style={rowLabelStyle}>Render count</dt>
      <dd style={rowValueStyle}>{debugInfo.renderCount}</dd>
    </dl>
  )
}
