'use client'

import { useState, useEffect, useCallback } from 'react'

interface McpToken {
  id: string
  label: string
  token_prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

interface OAuthClient {
  id: string
  label: string
  client_id: string
  redirect_uris: string[]
  created_at: string
  last_used_at: string | null
}

interface JustCreatedClient {
  client_id: string
  client_secret: string
  label: string
}

type ClientTab = 'claude-desktop' | 'claude-web' | 'chatgpt' | 'generic'

const CLAUDE_WEB_DEFAULT_REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

const inputClass = 'w-full text-sm text-gray-800 border border-[#E5E0D0] rounded-lg px-3 py-2 bg-white outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-300 transition-colors'
const btnPrimary = 'px-3 py-1.5 text-xs text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const btnSecondary = 'px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function McpSettingsPanel() {
  const [tokens, setTokens] = useState<McpToken[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [labelInput, setLabelInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [justCreated, setJustCreated] = useState<{ token: string; label: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [jsonCopied, setJsonCopied] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [activeTab, setActiveTab] = useState<ClientTab>('claude-desktop')
  const [isWindows, setIsWindows] = useState(false)

  // OAuth clients
  const [oauthClients, setOauthClients] = useState<OAuthClient[]>([])
  const [oauthLoading, setOauthLoading] = useState(true)
  const [showNewOauth, setShowNewOauth] = useState(false)
  const [oauthLabel, setOauthLabel] = useState('')
  const [oauthRedirect, setOauthRedirect] = useState(CLAUDE_WEB_DEFAULT_REDIRECT)
  const [oauthCreating, setOauthCreating] = useState(false)
  const [justCreatedClient, setJustCreatedClient] = useState<JustCreatedClient | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)

  // On Windows the path to npx (e.g. C:\Program Files\nodejs\npx.cmd) contains
  // spaces that Claude Desktop's spawn doesn't quote, so we wrap with `cmd /c`.
  // macOS/Linux can use npx directly.
  const claudeDesktopConfig = isWindows ? `{
  "mcpServers": {
    "pda": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "mcp-remote",
        "${serverUrl}",
        "--header",
        "Authorization: Bearer YOUR_TOKEN_HERE"
      ]
    }
  }
}` : `{
  "mcpServers": {
    "pda": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "${serverUrl}",
        "--header",
        "Authorization: Bearer YOUR_TOKEN_HERE"
      ]
    }
  }
}`

  async function copyJson() {
    await navigator.clipboard.writeText(claudeDesktopConfig)
    setJsonCopied(true)
    setTimeout(() => setJsonCopied(false), 1500)
  }

  async function copyUrl() {
    if (!serverUrl) return
    await navigator.clipboard.writeText(serverUrl)
    setUrlCopied(true)
    setTimeout(() => setUrlCopied(false), 1500)
  }

  useEffect(() => {
    setServerUrl(`${window.location.origin}/api/mcp`)
    setIsWindows(navigator.userAgent.toLowerCase().includes('win'))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/user/mcp-tokens')
      if (res.ok) {
        const data = await res.json()
        setTokens(data.tokens ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const loadClients = useCallback(async () => {
    setOauthLoading(true)
    try {
      const res = await fetch('/api/user/mcp-oauth-clients')
      if (res.ok) {
        const data = await res.json()
        setOauthClients(data.clients ?? [])
      }
    } finally {
      setOauthLoading(false)
    }
  }, [])

  useEffect(() => { load(); loadClients() }, [load, loadClients])

  async function handleCreateClient() {
    const label = oauthLabel.trim()
    const redirect = oauthRedirect.trim()
    if (!label || !redirect) return
    setOauthCreating(true)
    setOauthError(null)
    try {
      const res = await fetch('/api/user/mcp-oauth-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, redirectUris: [redirect] }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOauthError(data?.error ?? 'Failed to create client')
        return
      }
      setJustCreatedClient({ client_id: data.client_id, client_secret: data.client_secret, label: data.label })
      setOauthLabel('')
      setOauthRedirect(CLAUDE_WEB_DEFAULT_REDIRECT)
      setShowNewOauth(false)
      await loadClients()
    } finally {
      setOauthCreating(false)
    }
  }

  async function handleRevokeClient(id: string, label: string) {
    if (!confirm(`Revoke OAuth client "${label}"? Any service using it will lose access.`)) return
    const res = await fetch(`/api/user/mcp-oauth-clients/${id}`, { method: 'DELETE' })
    if (res.ok) await loadClients()
  }

  async function copySecret() {
    if (!justCreatedClient) return
    await navigator.clipboard.writeText(justCreatedClient.client_secret)
    setSecretCopied(true)
    setTimeout(() => setSecretCopied(false), 1500)
  }

  async function handleCreate() {
    const label = labelInput.trim()
    if (!label) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/user/mcp-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Failed to create token')
        return
      }
      setJustCreated({ token: data.token, label: data.label })
      setLabelInput('')
      setShowNew(false)
      await load()
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string, label: string) {
    if (!confirm(`Revoke token "${label}"? Any AI client using it will lose access.`)) return
    const res = await fetch(`/api/user/mcp-tokens/${id}`, { method: 'DELETE' })
    if (res.ok) await load()
  }

  async function copyToken() {
    if (!justCreated) return
    await navigator.clipboard.writeText(justCreated.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Generate a token to connect Claude, ChatGPT, Gemini, or other MCP-compatible
        AI assistants. Each token can be revoked individually.
      </p>

      {justCreated && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs font-medium text-amber-900 mb-1">
            Token for &ldquo;{justCreated.label}&rdquo; — copy it now
          </p>
          <p className="text-[11px] text-amber-800 mb-2">
            This is the only time the token will be shown. After you close this panel it cannot be retrieved.
          </p>
          <div className="flex items-center gap-2 mb-2">
            <code className="flex-1 text-xs font-mono bg-white border border-amber-200 rounded px-2 py-1.5 text-gray-900 break-all">
              {justCreated.token}
            </code>
            <button onClick={copyToken} className={btnPrimary}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setJustCreated(null)}
            className="text-[11px] text-amber-900 underline hover:text-amber-700"
          >
            I&apos;ve saved it, dismiss
          </button>
        </div>
      )}

      <div className="mb-4">
        <label className="text-xs text-gray-500 block mb-1">Server URL</label>
        <div className="relative">
          <code className="block text-xs font-mono bg-gray-50 border border-[#E5E0D0] rounded px-2 py-1.5 pr-16 text-gray-700 break-all">
            {serverUrl || '—'}
          </code>
          <button
            onClick={copyUrl}
            disabled={!serverUrl}
            className="absolute top-1 right-1 px-2 py-1 text-[11px] text-gray-700 bg-white border border-[#E5E0D0] rounded hover:bg-gray-100 transition-colors disabled:opacity-40"
          >
            {urlCopied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {!showNew ? (
        <button onClick={() => setShowNew(true)} className={btnPrimary}>
          Create token
        </button>
      ) : (
        <div className="space-y-2 mb-4">
          <label className="text-xs text-gray-500 block">Label</label>
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder="e.g. Claude Desktop, Work ChatGPT"
            className={inputClass}
            maxLength={80}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            autoFocus
          />
          <p className="text-[11px] text-gray-400">
            A short name to help you identify this token later.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={handleCreate} disabled={creating || !labelInput.trim()} className={btnPrimary}>
              {creating ? 'Creating...' : 'Generate'}
            </button>
            <button onClick={() => { setShowNew(false); setLabelInput(''); setError(null) }} className={btnSecondary}>
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}

      {/* Setup instructions */}
      <div className="mt-5">
        <h4 className="text-xs font-medium text-gray-500 mb-2">Setup instructions</h4>
        <div className="flex gap-1 mb-2 border-b border-[#E5E0D0]">
          {([
            ['claude-desktop', 'Claude Desktop'],
            ['claude-web', 'claude.ai'],
            ['chatgpt', 'ChatGPT'],
            ['generic', 'Gemini / Other'],
          ] as [ClientTab, string][]).map(([key, name]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-2.5 py-1.5 text-xs transition-colors border-b-2 -mb-px ${
                activeTab === key
                  ? 'border-amber-400 text-gray-900 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="text-xs text-gray-600 leading-relaxed">
          {activeTab === 'claude-desktop' && (
            <div>
              <p className="mb-2">
                In Claude Desktop, go to <em>Settings → Developer → Edit Config</em>. That opens a
                folder containing <code className="text-[11px] bg-gray-100 px-1 rounded">claude_desktop_config.json</code> — paste this into it:
              </p>
              <p className="mb-2 text-[11px] text-gray-500">
                Claude Desktop only loads stdio MCP servers, so this uses the <code className="text-[11px] bg-gray-100 px-1 rounded">mcp-remote</code> npm
                bridge to connect to PDA over HTTP. <code className="text-[11px] bg-gray-100 px-1 rounded">npx</code> downloads it on first run; no install needed.
                {isWindows
                  ? <> The Windows form below wraps <code className="text-[11px] bg-gray-100 px-1 rounded">npx</code> in <code className="text-[11px] bg-gray-100 px-1 rounded">cmd /c</code> so Claude Desktop&apos;s process spawn handles paths with spaces correctly.</>
                  : null}
              </p>
              <div className="relative">
                <pre className="text-[11px] font-mono bg-gray-50 border border-[#E5E0D0] rounded p-2 pr-16 overflow-x-auto">{claudeDesktopConfig}</pre>
                <button
                  onClick={copyJson}
                  className="absolute top-1.5 right-1.5 px-2 py-1 text-[11px] text-gray-700 bg-white border border-[#E5E0D0] rounded hover:bg-gray-100 transition-colors"
                >
                  {jsonCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                If your config already has an <code className="text-[11px] bg-gray-100 px-1 rounded">mcpServers</code> object,
                merge just the <code className="text-[11px] bg-gray-100 px-1 rounded">pda</code> entry into it — don&apos;t add a second top-level object.
                After saving, <strong>fully quit and reopen Claude Desktop</strong> (on Windows, right-click the system-tray icon and choose Quit;
                closing the window only hides it). The server should then appear under <em>Settings → Developer → Local MCP Servers</em>.
              </p>
              <p className="mt-2 text-[11px] text-gray-500">
                JSON merges are easy to get wrong (a stray comma or brace will wipe the whole file). If you&apos;re unsure,
                paste your existing config plus the snippet above into a Claude conversation and ask it to produce the merged file —
                but <strong>replace your token with a placeholder like <code className="text-[11px] bg-gray-100 px-1 rounded">YOUR_TOKEN_HERE</code> first</strong>,
                then drop the real token in locally after pasting the result. Don&apos;t share the token with Claude (or any
                external service); a token grants full access to your PDA account.
              </p>
            </div>
          )}
          {activeTab === 'claude-web' && (
            <div>
              <p className="mb-2">
                Open Settings → Connectors → <em>Add custom connector</em>. claude.ai
                requires OAuth — paste the values below and it will redirect you here
                to approve the connection.
              </p>
              <p className="mb-2 text-[11px] text-gray-500">
                Each field corresponds to one in claude.ai&apos;s connector form. Bearer
                tokens are not accepted by claude.ai; create an <strong>OAuth client</strong> below.
              </p>
              <ul className="text-[11px] text-gray-600 space-y-1 list-disc list-inside">
                <li><strong>Name:</strong> anything you&apos;ll recognize, e.g. &ldquo;PDA&rdquo;</li>
                <li><strong>Remote MCP server URL:</strong> the Server URL above</li>
                <li><strong>OAuth Client ID:</strong> the client_id from below</li>
                <li><strong>OAuth Client Secret:</strong> the client_secret (shown once on creation)</li>
              </ul>
            </div>
          )}
          {activeTab === 'chatgpt' && (
            <p>
              Open Settings → Connectors → <em>Add</em>. Paste the server URL above
              and the bearer token when prompted. ChatGPT&apos;s connector availability
              depends on your subscription tier.
            </p>
          )}
          {activeTab === 'generic' && (
            <p>
              Configure an HTTP MCP server pointing at the URL above with header{' '}
              <code className="text-[11px] bg-gray-100 px-1 rounded">Authorization: Bearer YOUR_TOKEN</code>.
              Works with any MCP-spec-compliant client.
            </p>
          )}
        </div>
      </div>

      {/* Existing tokens */}
      <div className="mt-5">
        <h4 className="text-xs font-medium text-gray-500 mb-2">Active tokens</h4>
        {loading ? (
          <p className="text-xs text-gray-400">Loading...</p>
        ) : tokens.length === 0 ? (
          <p className="text-xs text-gray-400">No tokens yet.</p>
        ) : (
          <ul className="space-y-2">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 p-2 border border-[#E5E0D0] rounded-lg">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-800 truncate">{t.label}</p>
                  <p className="text-[11px] text-gray-400 font-mono truncate">{t.token_prefix}…</p>
                  <p className="text-[11px] text-gray-400">
                    Created {formatDate(t.created_at)} · Last used {formatDate(t.last_used_at)}
                  </p>
                </div>
                <button
                  onClick={() => handleRevoke(t.id, t.label)}
                  className="px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 rounded transition-colors"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* OAuth clients */}
      <div className="mt-6 pt-5 border-t border-[#E5E0D0]">
        <h4 className="text-xs font-medium text-gray-500 mb-2">OAuth clients</h4>
        <p className="text-xs text-gray-500 mb-3">
          Required for claude.ai (web) and ChatGPT, which don&apos;t accept bearer tokens.
          The client_secret is shown once on creation.
        </p>

        {justCreatedClient && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
            <p className="text-xs font-medium text-amber-900">
              OAuth client created for &ldquo;{justCreatedClient.label}&rdquo; — copy the secret now
            </p>
            <p className="text-[11px] text-amber-800">
              The client_secret will not be retrievable after you dismiss this. The client_id stays visible later.
            </p>
            <div>
              <label className="text-[11px] text-amber-900 block mb-1">Client ID</label>
              <code className="block text-[11px] font-mono bg-white border border-amber-200 rounded px-2 py-1.5 text-gray-900 break-all">
                {justCreatedClient.client_id}
              </code>
            </div>
            <div>
              <label className="text-[11px] text-amber-900 block mb-1">Client Secret</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] font-mono bg-white border border-amber-200 rounded px-2 py-1.5 text-gray-900 break-all">
                  {justCreatedClient.client_secret}
                </code>
                <button onClick={copySecret} className={btnPrimary}>
                  {secretCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <button
              onClick={() => setJustCreatedClient(null)}
              className="text-[11px] text-amber-900 underline hover:text-amber-700"
            >
              I&apos;ve saved it, dismiss
            </button>
          </div>
        )}

        {!showNewOauth ? (
          <button onClick={() => setShowNewOauth(true)} className={btnPrimary}>
            Create OAuth client
          </button>
        ) : (
          <div className="space-y-2 mb-3">
            <label className="text-xs text-gray-500 block">Label</label>
            <input
              type="text"
              value={oauthLabel}
              onChange={(e) => setOauthLabel(e.target.value)}
              placeholder="e.g. claude.ai"
              className={inputClass}
              maxLength={80}
              autoFocus
            />
            <label className="text-xs text-gray-500 block mt-2">Redirect URI</label>
            <input
              type="text"
              value={oauthRedirect}
              onChange={(e) => setOauthRedirect(e.target.value)}
              placeholder="https://claude.ai/api/mcp/auth_callback"
              className={inputClass}
            />
            <p className="text-[11px] text-gray-400">
              The URL claude.ai (or other client) will be sent back to after authorization.
              Defaults to claude.ai&apos;s callback. Must be https (or localhost for testing).
            </p>
            <div className="flex items-center gap-2">
              <button onClick={handleCreateClient} disabled={oauthCreating || !oauthLabel.trim() || !oauthRedirect.trim()} className={btnPrimary}>
                {oauthCreating ? 'Creating...' : 'Generate'}
              </button>
              <button onClick={() => { setShowNewOauth(false); setOauthLabel(''); setOauthError(null) }} className={btnSecondary}>
                Cancel
              </button>
            </div>
            {oauthError && <p className="text-xs text-red-500">{oauthError}</p>}
          </div>
        )}

        <div className="mt-4">
          <h5 className="text-xs font-medium text-gray-500 mb-2">Active OAuth clients</h5>
          {oauthLoading ? (
            <p className="text-xs text-gray-400">Loading...</p>
          ) : oauthClients.length === 0 ? (
            <p className="text-xs text-gray-400">No OAuth clients yet.</p>
          ) : (
            <ul className="space-y-2">
              {oauthClients.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 p-2 border border-[#E5E0D0] rounded-lg">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate">{c.label}</p>
                    <p className="text-[11px] text-gray-500 font-mono truncate">{c.client_id}</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      → {c.redirect_uris.join(', ')}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      Created {formatDate(c.created_at)} · Last used {formatDate(c.last_used_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevokeClient(c.id, c.label)}
                    className="px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 rounded transition-colors"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
