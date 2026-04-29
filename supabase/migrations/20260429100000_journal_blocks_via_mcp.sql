-- Track which blocks were created or last modified through the MCP server.
-- A subtle UI indicator and a search filter let users distinguish AI-touched
-- entries from ones they wrote themselves.
ALTER TABLE journal_blocks
  ADD COLUMN IF NOT EXISTS via_mcp boolean NOT NULL DEFAULT false;

-- Partial index — only index rows where the flag is set, since the vast
-- majority of blocks will be user-authored (via_mcp = false).
CREATE INDEX IF NOT EXISTS journal_blocks_via_mcp_idx
  ON journal_blocks(user_id)
  WHERE via_mcp = true;
