export interface WorkspaceColorScheme {
  key: string
  label: string
  primary: string        // top bar background
  muted: string          // feed / composer background
  activeMuted: string    // focused card background
  textOnColor: string    // readable text on primary
  selectionColor: string // text selection highlight
  swatch: string         // property color dot (saturated, always visible)
  pillBg: string         // property pill background
  pillText: string       // readable text on pillBg
}

const workspaceColorSchemes: WorkspaceColorScheme[] = [
  // ── Reds ──────────────────────────────────────────────────
  { key: 'crimson',      label: 'Crimson',      primary: '#B91C1C', muted: '#FEF2F2', activeMuted: '#FEE2E2', textOnColor: '#FFFFFF', selectionColor: '#FCA5A5', swatch: '#B91C1C', pillBg: '#FEE2E2', pillText: '#991B1B' },
  { key: 'rose',         label: 'Rose',         primary: '#BE185D', muted: '#FDF2F8', activeMuted: '#FCE7F3', textOnColor: '#FFFFFF', selectionColor: '#F9A8D4', swatch: '#BE185D', pillBg: '#FCE7F3', pillText: '#9F1239' },
  { key: 'coral',        label: 'Coral',        primary: '#E4522B', muted: '#FFF5F0', activeMuted: '#FFEDD5', textOnColor: '#FFFFFF', selectionColor: '#FDBA74', swatch: '#E4522B', pillBg: '#FFEDD5', pillText: '#7C2D12' },
  { key: 'pink',         label: 'Pink',         primary: '#DB2777', muted: '#FDF2F8', activeMuted: '#FCE7F3', textOnColor: '#FFFFFF', selectionColor: '#FBCFE8', swatch: '#DB2777', pillBg: '#FCE7F3', pillText: '#9D174D' },

  // ── Oranges & Yellows ─────────────────────────────────────
  { key: 'burnt_orange', label: 'Burnt Orange', primary: '#C2410C', muted: '#FFF7ED', activeMuted: '#FFEDD5', textOnColor: '#FFFFFF', selectionColor: '#FED7AA', swatch: '#C2410C', pillBg: '#FFEDD5', pillText: '#9A3412' },
  { key: 'marigold',     label: 'Marigold',     primary: '#D97706', muted: '#FFFBEB', activeMuted: '#FEF3C7', textOnColor: '#431407', selectionColor: '#FDE68A', swatch: '#D97706', pillBg: '#FEF3C7', pillText: '#92400E' },
  { key: 'peach',        label: 'Peach',        primary: '#FED7AA', muted: '#FFF7ED', activeMuted: '#FFEDD5', textOnColor: '#7C2D12', selectionColor: '#FDBA74', swatch: '#E8943A', pillBg: '#FFEDD5', pillText: '#7C2D12' },
  { key: 'amber',        label: 'Amber',        primary: '#92400E', muted: '#FFFBEB', activeMuted: '#FEF3C7', textOnColor: '#FFFFFF', selectionColor: '#FDE68A', swatch: '#92400E', pillBg: '#FEF3C7', pillText: '#78350F' },
  { key: 'goldenrod',    label: 'Goldenrod',    primary: '#EDC618', muted: '#FFFEF6', activeMuted: '#FFF9E0', textOnColor: '#3D3200', selectionColor: '#F5DC6A', swatch: '#C9A40E', pillBg: '#FFF9E0', pillText: '#3D3200' },

  // ── Greens ────────────────────────────────────────────────
  { key: 'sage',         label: 'Sage',         primary: '#4D7C0F', muted: '#F7FEE7', activeMuted: '#ECFCCB', textOnColor: '#FFFFFF', selectionColor: '#BEF264', swatch: '#4D7C0F', pillBg: '#ECFCCB', pillText: '#3F6212' },
  { key: 'mint',         label: 'Mint',         primary: '#BBF7D0', muted: '#F0FDF4', activeMuted: '#DCFCE7', textOnColor: '#14532D', selectionColor: '#86EFAC', swatch: '#22C55E', pillBg: '#DCFCE7', pillText: '#14532D' },
  { key: 'forest',       label: 'Forest',       primary: '#15803D', muted: '#F0FDF4', activeMuted: '#DCFCE7', textOnColor: '#FFFFFF', selectionColor: '#86EFAC', swatch: '#15803D', pillBg: '#DCFCE7', pillText: '#166534' },
  { key: 'teal',         label: 'Teal',         primary: '#0F766E', muted: '#F0FDFA', activeMuted: '#CCFBF1', textOnColor: '#FFFFFF', selectionColor: '#99F6E4', swatch: '#0F766E', pillBg: '#CCFBF1', pillText: '#115E59' },

  // ── Blues ──────────────────────────────────────────────────
  { key: 'ocean',        label: 'Ocean',        primary: '#0369A1', muted: '#F0F9FF', activeMuted: '#E0F2FE', textOnColor: '#FFFFFF', selectionColor: '#BAE6FD', swatch: '#0369A1', pillBg: '#E0F2FE', pillText: '#075985' },
  { key: 'sky',          label: 'Sky',          primary: '#BAE6FD', muted: '#F0F9FF', activeMuted: '#E0F2FE', textOnColor: '#0C4A6E', selectionColor: '#7DD3FC', swatch: '#0284C7', pillBg: '#E0F2FE', pillText: '#0C4A6E' },
  { key: 'navy',         label: 'Navy',         primary: '#1E3A5F', muted: '#EFF6FF', activeMuted: '#DBEAFE', textOnColor: '#FFFFFF', selectionColor: '#BFDBFE', swatch: '#1E3A5F', pillBg: '#DBEAFE', pillText: '#1E3A5F' },

  // ── Purples ───────────────────────────────────────────────
  { key: 'indigo',       label: 'Indigo',       primary: '#3730A3', muted: '#EEF2FF', activeMuted: '#E0E7FF', textOnColor: '#FFFFFF', selectionColor: '#C7D2FE', swatch: '#3730A3', pillBg: '#E0E7FF', pillText: '#3730A3' },
  { key: 'periwinkle',   label: 'Periwinkle',   primary: '#818CF8', muted: '#EEF2FF', activeMuted: '#E0E7FF', textOnColor: '#1E1B4B', selectionColor: '#C7D2FE', swatch: '#6366F1', pillBg: '#E0E7FF', pillText: '#3730A3' },
  { key: 'violet',       label: 'Violet',       primary: '#6D28D9', muted: '#F5F3FF', activeMuted: '#EDE9FE', textOnColor: '#FFFFFF', selectionColor: '#C4B5FD', swatch: '#6D28D9', pillBg: '#EDE9FE', pillText: '#5B21B6' },
  { key: 'lavender',     label: 'Lavender',     primary: '#DDD6FE', muted: '#F5F3FF', activeMuted: '#EDE9FE', textOnColor: '#4C1D95', selectionColor: '#C4B5FD', swatch: '#8B5CF6', pillBg: '#EDE9FE', pillText: '#4C1D95' },

  // ── Neutrals & Earth ──────────────────────────────────────
  { key: 'walnut',       label: 'Walnut',       primary: '#6B3F1E', muted: '#FDF6F0', activeMuted: '#F8EDE3', textOnColor: '#FFFFFF', selectionColor: '#D4A97A', swatch: '#6B3F1E', pillBg: '#F8EDE3', pillText: '#6B3F1E' },
  { key: 'taupe',        label: 'Taupe',        primary: '#78716C', muted: '#FAFAF8', activeMuted: '#F5F5F4', textOnColor: '#FFFFFF', selectionColor: '#E7E5E4', swatch: '#78716C', pillBg: '#F5F5F4', pillText: '#44403C' },
  { key: 'charcoal',     label: 'Charcoal',     primary: '#374151', muted: '#F9FAFB', activeMuted: '#F3F4F6', textOnColor: '#FFFFFF', selectionColor: '#D1D5DB', swatch: '#374151', pillBg: '#F3F4F6', pillText: '#374151' },
  { key: 'cream',        label: 'Cream',        primary: '#E8E0D0', muted: '#FAF8F4', activeMuted: '#F5F0E8', textOnColor: '#44403C', selectionColor: '#D6D3D1', swatch: '#B8A88A', pillBg: '#F5F0E8', pillText: '#44403C' },
]

export default workspaceColorSchemes

export function getScheme(key: string | null): WorkspaceColorScheme | null {
  if (!key) return null
  return workspaceColorSchemes.find(s => s.key === key) ?? null
}
