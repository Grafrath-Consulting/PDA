'use client'

import { PropertyValue, Property } from '@/context/PropertiesContext'

/** Map color keys from property_values.color to Tailwind-compatible bg/text pairs */
const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  red:     { bg: '#FEE2E2', text: '#991B1B' },
  amber:   { bg: '#FEF3C7', text: '#92400E' },
  green:   { bg: '#D1FAE5', text: '#065F46' },
  blue:    { bg: '#DBEAFE', text: '#1E40AF' },
  indigo:  { bg: '#E0E7FF', text: '#3730A3' },
  violet:  { bg: '#EDE9FE', text: '#5B21B6' },
  pink:    { bg: '#FCE7F3', text: '#9D174D' },
  gray:    { bg: '#F3F4F6', text: '#374151' },
  rose:    { bg: '#FFE4E6', text: '#9F1239' },
  orange:  { bg: '#FFEDD5', text: '#9A3412' },
  teal:    { bg: '#CCFBF1', text: '#115E59' },
  cyan:    { bg: '#CFFAFE', text: '#155E75' },
  sky:     { bg: '#E0F2FE', text: '#075985' },
  fuchsia: { bg: '#FAE8FF', text: '#86198F' },
  lime:    { bg: '#ECFCCB', text: '#3F6212' },
  slate:   { bg: '#F1F5F9', text: '#334155' },
}

const DEFAULT_COLOR = { bg: '#F3F4F6', text: '#374151' }

function colorFor(color: string | null) {
  if (!color) return DEFAULT_COLOR
  return COLOR_MAP[color] ?? DEFAULT_COLOR
}

interface AppliedValue {
  propertyValueId: string
  property: Property
  value: PropertyValue
}

interface Props {
  appliedValueIds: Set<string>
  properties: Property[]
  onClickValue?: (propertyValueId: string) => void
}

export function PropertyBubbles({ appliedValueIds, properties, onClickValue }: Props) {
  if (appliedValueIds.size === 0) return null

  const applied: AppliedValue[] = []
  for (const prop of properties) {
    for (const val of prop.values) {
      if (appliedValueIds.has(val.id)) {
        applied.push({ propertyValueId: val.id, property: prop, value: val })
      }
    }
  }

  if (applied.length === 0) return null

  return (
    <>
      {applied.map(({ propertyValueId, property, value }) => {
        const c = colorFor(value.color)
        return (
          <button
            key={propertyValueId}
            type="button"
            title={`${property.name}: ${value.label}`}
            onClick={(e) => { e.stopPropagation(); onClickValue?.(propertyValueId) }}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-opacity hover:opacity-80 flex-shrink-0"
            style={{ backgroundColor: c.bg, color: c.text }}
          >
            {value.label}
          </button>
        )
      })}
    </>
  )
}
