/**
 * Property colors derived from the shared workspace color schemes.
 *
 * Each property color maps to a workspace scheme, pulling:
 *  - swatch: the solid dot shown in color pickers
 *  - bg: light background for pills / bubbles
 *  - text: readable foreground on bg
 */

import workspaceColorSchemes, { type WorkspaceColorScheme } from './workspaceColorSchemes'

export interface PropertyColor {
  key: string
  swatch: string
  bg: string
  text: string
}

function toPropertyColor(scheme: WorkspaceColorScheme): PropertyColor {
  return {
    key: scheme.key,
    swatch: scheme.swatch,
    bg: scheme.pillBg,
    text: scheme.pillText,
  }
}

const propertyColors: PropertyColor[] = workspaceColorSchemes.map(toPropertyColor)

export default propertyColors

/** Lookup helpers */
export const PROPERTY_COLOR_KEYS = propertyColors.map(c => c.key)

const byKey = new Map(propertyColors.map(c => [c.key, c]))

const fallback: PropertyColor = { key: 'charcoal', swatch: '#374151', bg: '#F3F4F6', text: '#374151' }

export function getPropertyColor(key: string | null): PropertyColor {
  if (!key) return fallback
  return byKey.get(key) ?? fallback
}
