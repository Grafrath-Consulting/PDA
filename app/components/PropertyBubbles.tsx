'use client'

import { PropertyValue, Property } from '@/context/PropertiesContext'
import { getPropertyColor } from '@/constants/propertyColors'

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
        const c = getPropertyColor(value.color)
        return (
          <button
            key={propertyValueId}
            type="button"
            title={`${property.name}: ${value.label}`}
            onClick={(e) => { e.stopPropagation(); onClickValue?.(propertyValueId) }}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-opacity hover:opacity-80 flex-shrink-0 ${
              value.archived ? 'border border-dashed border-gray-300' : ''
            }`}
            style={{ backgroundColor: c.bg, color: c.text }}
          >
            {value.label}
          </button>
        )
      })}
    </>
  )
}
