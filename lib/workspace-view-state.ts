// Per-workspace view state, persisted in localStorage (device-local). Switching
// to a workspace restores the sort, the collapse-all toggle, the Focus panel
// open/closed, and all filters that were last used there. The "All Workspaces"
// (global) view gets its own key.

export type ViewSortMode =
  | 'created_desc' | 'created_asc' | 'modified_desc' | 'modified_asc'
  | 'due_date' | 'manual' | 'property'

export interface ViewFilters {
  entryTypes: string[]
  statuses: string[]
  dateFrom: string
  dateTo: string
  modifiedFrom: string
  modifiedTo: string
  dueFrom: string
  dueTo: string
  startFrom: string
  startTo: string
  archivedFrom: string
  archivedTo: string
  deletedFrom: string
  deletedTo: string
  assignee: string | null
  mcp: 'any' | 'mcp' | 'manual'
  contextFilter: string | null
  propertyFilters: string[]
  searchMode: 'smart' | 'exact'
}

export interface WorkspaceViewState {
  sortMode: ViewSortMode
  sortPropertyId: string | null
  feedCollapsed: boolean
  // panelOpen is optional so first-time workspaces can fall back to the
  // mobile-aware default chosen by the caller.
  panelOpen: boolean | null
  filters: ViewFilters
}

export const DEFAULT_VIEW_FILTERS: ViewFilters = {
  entryTypes: ['info', 'task'],
  statuses: ['active'],
  dateFrom: '', dateTo: '',
  modifiedFrom: '', modifiedTo: '',
  dueFrom: '', dueTo: '',
  startFrom: '', startTo: '',
  archivedFrom: '', archivedTo: '',
  deletedFrom: '', deletedTo: '',
  assignee: null,
  mcp: 'any',
  contextFilter: null,
  propertyFilters: [],
  searchMode: 'smart',
}

export const DEFAULT_VIEW_STATE: WorkspaceViewState = {
  sortMode: 'created_desc',
  sortPropertyId: null,
  feedCollapsed: true,
  panelOpen: null,
  filters: { ...DEFAULT_VIEW_FILTERS },
}

const PREFIX = 'pda_view_state:'

export function viewStateKey(workspaceId: string | null): string {
  return `${PREFIX}${workspaceId ?? '__global__'}`
}

export function readViewState(workspaceId: string | null): WorkspaceViewState {
  if (typeof window === 'undefined') return { ...DEFAULT_VIEW_STATE }
  try {
    const raw = localStorage.getItem(viewStateKey(workspaceId))
    if (!raw) return { ...DEFAULT_VIEW_STATE }
    const parsed = JSON.parse(raw) as Partial<WorkspaceViewState>
    return {
      ...DEFAULT_VIEW_STATE,
      ...parsed,
      filters: { ...DEFAULT_VIEW_FILTERS, ...(parsed.filters ?? {}) },
    }
  } catch {
    return { ...DEFAULT_VIEW_STATE }
  }
}

export function writeViewState(workspaceId: string | null, state: WorkspaceViewState): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(viewStateKey(workspaceId), JSON.stringify(state))
  } catch {
    // ignore quota / serialization errors
  }
}
