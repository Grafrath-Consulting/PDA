export type BlockStatus = 'active' | 'complete' | 'archived'

export interface Block {
  id: string
  user_id: string
  context_id: string | null
  workspace_id: string | null
  content: string | null
  status: BlockStatus
  entry_type: 'info' | 'task'
  owner_id: string | null
  due_date: string | null
  due_date_type: 'hard' | 'soft' | null
  archived_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  is_archived: boolean
  pinned: boolean
  position: number
  sort_order?: number | null
}

export interface Context {
  id: string
  name: string
  color: string | null
  icon: string | null
}

export interface BlockVersion {
  id: string
  block_id: string
  content: string | null
  content_html: string | null
  edited_at: string
}

export type SelectionAction =
  | { type: 'create_task'; taskType: 'my_task' | 'delegated' | 'waiting_on'; assigneeId?: string }
  | { type: 'split_block' }
  | { type: 'label_info' }
  | { type: 'summarize' }
  | { type: 'delete_selection' }
  | { type: 'insert_link' }
  | { type: 'mark_done' }
