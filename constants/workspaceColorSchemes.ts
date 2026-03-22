export interface WorkspaceColorScheme {
  key: string
  label: string
  primary: string        // top bar background
  muted: string          // feed / composer background
  activeMuted: string    // focused card background
  textOnColor: string    // readable text on primary
  selectionColor: string // text selection highlight
}

const workspaceColorSchemes: WorkspaceColorScheme[] = [
  // ── Reds & Pinks ──────────────────────────────────────────
  { key: 'crimson',      label: 'Crimson',      primary: '#B91C1C', muted: '#FEF2F2', activeMuted: '#FEE2E2', textOnColor: '#FFFFFF', selectionColor: '#FCA5A5' },
  { key: 'rose',         label: 'Rose',         primary: '#BE185D', muted: '#FDF2F8', activeMuted: '#FCE7F3', textOnColor: '#FFFFFF', selectionColor: '#F9A8D4' },
  { key: 'pink',         label: 'Pink',         primary: '#DB2777', muted: '#FDF2F8', activeMuted: '#FCE7F3', textOnColor: '#FFFFFF', selectionColor: '#FBCFE8' },
  { key: 'coral',        label: 'Coral',        primary: '#E4522B', muted: '#FFF5F0', activeMuted: '#FFEDD5', textOnColor: '#FFFFFF', selectionColor: '#FDBA74' },

  // ── Oranges & Yellows ─────────────────────────────────────
  { key: 'burnt_orange', label: 'Burnt Orange', primary: '#C2410C', muted: '#FFF7ED', activeMuted: '#FFEDD5', textOnColor: '#FFFFFF', selectionColor: '#FED7AA' },
  { key: 'amber',        label: 'Amber',        primary: '#92400E', muted: '#FFFBEB', activeMuted: '#FEF3C7', textOnColor: '#FFFFFF', selectionColor: '#FDE68A' },
  { key: 'marigold',     label: 'Marigold',     primary: '#D97706', muted: '#FFFBEB', activeMuted: '#FEF3C7', textOnColor: '#431407', selectionColor: '#FDE68A' },
  { key: 'peach',        label: 'Peach',        primary: '#FED7AA', muted: '#FFF7ED', activeMuted: '#FFEDD5', textOnColor: '#7C2D12', selectionColor: '#FDBA74' },

  // ── Greens & Teal ─────────────────────────────────────────
  { key: 'forest',       label: 'Forest',       primary: '#15803D', muted: '#F0FDF4', activeMuted: '#DCFCE7', textOnColor: '#FFFFFF', selectionColor: '#86EFAC' },
  { key: 'sage',         label: 'Sage',         primary: '#4D7C0F', muted: '#F7FEE7', activeMuted: '#ECFCCB', textOnColor: '#FFFFFF', selectionColor: '#BEF264' },
  { key: 'mint',         label: 'Mint',         primary: '#BBF7D0', muted: '#F0FDF4', activeMuted: '#DCFCE7', textOnColor: '#14532D', selectionColor: '#86EFAC' },
  { key: 'teal',         label: 'Teal',         primary: '#0F766E', muted: '#F0FDFA', activeMuted: '#CCFBF1', textOnColor: '#FFFFFF', selectionColor: '#99F6E4' },

  // ── Blues ─────────────────────────────────────────────────
  { key: 'navy',         label: 'Navy',         primary: '#1E3A5F', muted: '#EFF6FF', activeMuted: '#DBEAFE', textOnColor: '#FFFFFF', selectionColor: '#BFDBFE' },
  { key: 'ocean',        label: 'Ocean',        primary: '#0369A1', muted: '#F0F9FF', activeMuted: '#E0F2FE', textOnColor: '#FFFFFF', selectionColor: '#BAE6FD' },
  { key: 'sky',          label: 'Sky',          primary: '#BAE6FD', muted: '#F0F9FF', activeMuted: '#E0F2FE', textOnColor: '#0C4A6E', selectionColor: '#7DD3FC' },
  { key: 'periwinkle',   label: 'Periwinkle',   primary: '#818CF8', muted: '#EEF2FF', activeMuted: '#E0E7FF', textOnColor: '#1E1B4B', selectionColor: '#C7D2FE' },

  // ── Purples ───────────────────────────────────────────────
  { key: 'violet',       label: 'Violet',       primary: '#6D28D9', muted: '#F5F3FF', activeMuted: '#EDE9FE', textOnColor: '#FFFFFF', selectionColor: '#C4B5FD' },
  { key: 'lavender',     label: 'Lavender',     primary: '#DDD6FE', muted: '#F5F3FF', activeMuted: '#EDE9FE', textOnColor: '#4C1D95', selectionColor: '#C4B5FD' },
  { key: 'indigo',       label: 'Indigo',       primary: '#3730A3', muted: '#EEF2FF', activeMuted: '#E0E7FF', textOnColor: '#FFFFFF', selectionColor: '#C7D2FE' },

  // ── Neutrals ──────────────────────────────────────────────
  { key: 'charcoal',     label: 'Charcoal',     primary: '#374151', muted: '#F9FAFB', activeMuted: '#F3F4F6', textOnColor: '#FFFFFF', selectionColor: '#D1D5DB' },
  { key: 'warm_gray',    label: 'Warm Gray',    primary: '#57534E', muted: '#FAFAF9', activeMuted: '#F5F5F4', textOnColor: '#FFFFFF', selectionColor: '#D6D3D1' },
  { key: 'walnut',       label: 'Walnut',       primary: '#6B3F1E', muted: '#FDF6F0', activeMuted: '#F8EDE3', textOnColor: '#FFFFFF', selectionColor: '#D4A97A' },
  { key: 'taupe',        label: 'Taupe',        primary: '#78716C', muted: '#FAFAF8', activeMuted: '#F5F5F4', textOnColor: '#FFFFFF', selectionColor: '#E7E5E4' },
  { key: 'cream',        label: 'Cream',        primary: '#E8E0D0', muted: '#FAF8F4', activeMuted: '#F5F0E8', textOnColor: '#44403C', selectionColor: '#D6D3D1' },
]

export default workspaceColorSchemes

export function getScheme(key: string | null): WorkspaceColorScheme | null {
  if (!key) return null
  return workspaceColorSchemes.find(s => s.key === key) ?? null
}
