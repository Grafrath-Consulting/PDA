-- OAuth 2.0 client registration table. Each row is a static client (client_id +
-- hashed client_secret) that the user has paired with an external service like
-- claude.ai. The raw client_secret is only shown once at creation time.
CREATE TABLE mcp_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  label text NOT NULL,
  client_id text NOT NULL UNIQUE,
  client_secret_hash text NOT NULL,
  redirect_uris text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX mcp_oauth_clients_user_id_idx ON mcp_oauth_clients(user_id);
CREATE INDEX mcp_oauth_clients_client_id_idx ON mcp_oauth_clients(client_id);

ALTER TABLE mcp_oauth_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own oauth clients" ON mcp_oauth_clients
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own oauth clients" ON mcp_oauth_clients
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own oauth clients" ON mcp_oauth_clients
  FOR DELETE USING (auth.uid() = user_id);

-- Short-lived authorization codes. One-minute TTL, single-use. The code itself
-- is stored hashed (token_hash style) so a leaked DB row can't be replayed.
CREATE TABLE mcp_oauth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  client_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256',
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX mcp_oauth_codes_code_hash_idx ON mcp_oauth_codes(code_hash);
CREATE INDEX mcp_oauth_codes_expires_at_idx ON mcp_oauth_codes(expires_at);

-- Codes are only ever validated server-side via the service-role client, but
-- enable RLS for defense in depth.
ALTER TABLE mcp_oauth_codes ENABLE ROW LEVEL SECURITY;

-- Link OAuth-issued access tokens back to their client so revoking a client
-- invalidates all tokens issued under it.
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS client_id text;
CREATE INDEX IF NOT EXISTS mcp_tokens_client_id_idx ON mcp_tokens(client_id);
