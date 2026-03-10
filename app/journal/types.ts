export type BlockStatus = 'unprocessed' | 'partially_handled' | 'archived'

export interface Block {
  id: string
  user_id: string
  context_id: string | null
  content: string | null
  status: BlockStatus
  created_at: string
  updated_at: string
  deleted_at: string | null
  is_archived: boolean
  pinned: boolean
  position: number
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
  | { type: 'link_project'; projectId: string }
  | { type: 'label_info' }
  | { type: 'summarize' }
  | { type: 'delete_selection' }
