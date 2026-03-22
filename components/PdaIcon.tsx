import React from 'react'

interface PdaIconProps {
  width?: number
  height?: number
  className?: string
  style?: React.CSSProperties
}

export function PdaIcon({ width = 20, height = 20, className, style }: PdaIconProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      {/* Device body */}
      <rect x="4" y="1" width="12" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.5"/>
      {/* Screen bezel */}
      <rect x="6" y="3.5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1"/>
      {/* Content lines on screen */}
      <line x1="7.5" y1="6"   x2="12.5" y2="6"   stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      <line x1="7.5" y1="8"   x2="11.5" y2="8"   stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      <line x1="7.5" y1="10"  x2="12"   y2="10"  stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      {/* Home button */}
      <circle cx="10" cy="16" r="1.5" stroke="currentColor" strokeWidth="1"/>
    </svg>
  )
}
