-- Add draft_content column for in-progress edits that haven't been committed to history
ALTER TABLE journal_blocks ADD COLUMN IF NOT EXISTS draft_content text;

-- Commit any stale drafts from before this migration
UPDATE journal_blocks
SET content = draft_content, draft_content = NULL
WHERE draft_content IS NOT NULL;
