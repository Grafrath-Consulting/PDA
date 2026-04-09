/**
 * Shared color definitions for property values.
 *
 * Each color has:
 *  - swatch: the solid dot shown in color pickers
 *  - bg: light background for pills / bubbles
 *  - text: readable foreground on bg
 *
 * Colors are ordered for maximum visual distinction between neighbors.
 */

export interface PropertyColor {
  key: string
  swatch: string
  bg: string
  text: string
}

const propertyColors: PropertyColor[] = [
  // ── Strong primaries ──────────────────────────────────
  { key: 'red',       swatch: '#DC2626', bg: '#FEE2E2', text: '#991B1B' },
  { key: 'blue',      swatch: '#2563EB', bg: '#DBEAFE', text: '#1E40AF' },
  { key: 'green',     swatch: '#16A34A', bg: '#DCFCE7', text: '#166534' },
  { key: 'amber',     swatch: '#D97706', bg: '#FEF3C7', text: '#92400E' },
  { key: 'violet',    swatch: '#7C3AED', bg: '#EDE9FE', text: '#5B21B6' },

  // ── Warm accents ──────────────────────────────────────
  { key: 'orange',    swatch: '#EA580C', bg: '#FFEDD5', text: '#9A3412' },
  { key: 'rose',      swatch: '#E11D48', bg: '#FFE4E6', text: '#9F1239' },
  { key: 'pink',      swatch: '#DB2777', bg: '#FCE7F3', text: '#9D174D' },
  { key: 'coral',     swatch: '#E4522B', bg: '#FFF1EC', text: '#7C2D12' },

  // ── Cool accents ──────────────────────────────────────
  { key: 'teal',      swatch: '#0D9488', bg: '#CCFBF1', text: '#115E59' },
  { key: 'cyan',      swatch: '#0891B2', bg: '#CFFAFE', text: '#155E75' },
  { key: 'sky',       swatch: '#0284C7', bg: '#E0F2FE', text: '#075985' },
  { key: 'indigo',    swatch: '#4338CA', bg: '#E0E7FF', text: '#3730A3' },

  // ── Earth & secondary ─────────────────────────────────
  { key: 'lime',      swatch: '#65A30D', bg: '#ECFCCB', text: '#3F6212' },
  { key: 'fuchsia',   swatch: '#C026D3', bg: '#FAE8FF', text: '#86198F' },
  { key: 'walnut',    swatch: '#8B5E34', bg: '#F8EDE3', text: '#6B3F1E' },

  // ── Neutrals ──────────────────────────────────────────
  { key: 'gray',      swatch: '#6B7280', bg: '#F3F4F6', text: '#374151' },
  { key: 'slate',     swatch: '#475569', bg: '#F1F5F9', text: '#334155' },
]

export default propertyColors

/** Lookup helpers */
export const PROPERTY_COLOR_KEYS = propertyColors.map(c => c.key)

const byKey = new Map(propertyColors.map(c => [c.key, c]))

export function getPropertyColor(key: string | null): PropertyColor {
  if (!key) return { key: 'gray', swatch: '#6B7280', bg: '#F3F4F6', text: '#374151' }
  return byKey.get(key) ?? { key: 'gray', swatch: '#6B7280', bg: '#F3F4F6', text: '#374151' }
}
