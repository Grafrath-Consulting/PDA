'use client'

import { Context } from '../types'

interface Props {
  contexts: Context[]
  active: string | null
  onChange: (contextId: string | null) => void
}

export function ContextFilter({ contexts, active, onChange }: Props) {
  if (contexts.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => onChange(null)}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          active === null
            ? 'bg-[#F59E0B] text-white'
            : 'bg-white border border-[#E5E0D0] text-gray-500 hover:border-[#D5D0C0] hover:text-gray-700'
        }`}
      >
        All
      </button>
      {contexts.map((ctx) => (
        <button
          key={ctx.id}
          onClick={() => onChange(ctx.id)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            active === ctx.id
              ? 'bg-[#F59E0B] text-white'
              : 'bg-white border border-[#E5E0D0] text-gray-500 hover:border-[#D5D0C0] hover:text-gray-700'
          }`}
          style={
            active === ctx.id && ctx.color
              ? { backgroundColor: ctx.color, borderColor: ctx.color }
              : ctx.color
              ? { borderColor: ctx.color, color: ctx.color }
              : undefined
          }
        >
          {ctx.icon ? `${ctx.icon} ` : ''}{ctx.name}
        </button>
      ))}
    </div>
  )
}
