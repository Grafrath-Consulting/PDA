-- Bearer tokens for the MCP server. The raw token is shown to the user once
-- on creation; only the SHA-256 hash is stored. token_prefix holds the first
-- ~12 characters of the raw token for display in the settings UI.
CREATE TABLE mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz
);

CREATE INDEX mcp_tokens_user_id_idx ON mcp_tokens(user_id);
CREATE INDEX mcp_tokens_token_hash_idx ON mcp_tokens(token_hash);

ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mcp tokens" ON mcp_tokens
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own mcp tokens" ON mcp_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own mcp tokens" ON mcp_tokens
  FOR DELETE USING (auth.uid() = user_id);
-- No UPDATE policy: tokens are immutable from the user's side. The MCP server
-- updates last_used_at via the service-role client, which bypasses RLS.
