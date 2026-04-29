'use client'

import { useState, useEffect, useCallback } from 'react'

interface PromptTemplate {
  key: string
  label: string
  description: string
  promptText: string
  isCustom: boolean
}

type AiSection = 'search' | 'summary'

const SEARCH_PROMPT_KEYS = ['smart_search']
const SUMMARY_PROMPT_KEYS = ['summarize', 'report_summary']

export function AiSettingsPanel({ userId, section }: { userId: string; section: AiSection }) {
  // API key state
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [keyHint, setKeyHint] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keySaving, setKeySaving] = useState(false)
  const [keyTesting, setKeyTesting] = useState(false)
  const [keyMessage, setKeyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [keyLoading, setKeyLoading] = useState(true)

  // Prompt templates state
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({})
  const [promptMessage, setPromptMessage] = useState<{ key: string; type: 'success' | 'error'; text: string } | null>(null)
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    setKeyLoading(true)
    try {
      const res = await fetch('/api/user/ai-config')
      if (res.ok) {
        const data = await res.json()
        setKeyConfigured(data.configured)
        setKeyHint(data.hint)
      }
    } finally {
      setKeyLoading(false)
    }
  }, [])

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true)
    try {
      const res = await fetch('/api/user/prompt-templates')
      if (res.ok) {
        const data: PromptTemplate[] = await res.json()
        setTemplates(data)
        const edited: Record<string, string> = {}
        data.forEach(t => { edited[t.key] = t.promptText })
        setEditedPrompts(edited)
      }
    } finally {
      setTemplatesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadTemplates()
  }, [loadConfig, loadTemplates])

  async function handleSaveKey() {
    if (!keyInput.trim()) return
    setKeySaving(true)
    setKeyMessage(null)
    try {
      const res = await fetch('/api/user/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: keyInput.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setKeyConfigured(true)
        setKeyHint(data.hint)
        setKeyInput('')
        setShowKeyInput(false)
        setKeyMessage({ type: 'success', text: 'API key saved successfully.' })
      } else {
        setKeyMessage({ type: 'error', text: data.error ?? 'Failed to save key.' })
      }
    } catch {
      setKeyMessage({ type: 'error', text: 'Network error.' })
    } finally {
      setKeySaving(false)
    }
  }

  async function handleRemoveKey() {
    setKeySaving(true)
    setKeyMessage(null)
    try {
      await fetch('/api/user/ai-config', { method: 'DELETE' })
      setKeyConfigured(false)
      setKeyHint(null)
      setKeyMessage({ type: 'success', text: 'API key removed.' })
    } finally {
      setKeySaving(false)
    }
  }

  async function handleTestKey() {
    setKeyTesting(true)
    setKeyMessage(null)
    try {
      const res = await fetch('/api/ai/test', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setKeyMessage({ type: 'success', text: 'Connection successful! Your API key is working.' })
      } else if (data.error === 'no_api_key') {
        setKeyMessage({ type: 'error', text: 'No API key configured.' })
      } else {
        setKeyMessage({ type: 'error', text: data.error ?? 'Test failed.' })
      }
    } catch {
      setKeyMessage({ type: 'error', text: 'Network error.' })
    } finally {
      setKeyTesting(false)
    }
  }

  async function handleSavePrompt(key: string) {
    const text = editedPrompts[key]
    if (!text?.trim()) return
    setSavingKey(key)
    setPromptMessage(null)
    try {
      const res = await fetch('/api/user/prompt-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, promptText: text }),
      })
      if (res.ok) {
        setPromptMessage({ key, type: 'success', text: 'Saved.' })
        setTemplates(prev => prev.map(t => t.key === key ? { ...t, promptText: text, isCustom: true } : t))
      } else {
        setPromptMessage({ key, type: 'error', text: 'Failed to save.' })
      }
    } finally {
      setSavingKey(null)
    }
  }

  async function handleRevertPrompt(key: string) {
    setSavingKey(key)
    setPromptMessage(null)
    try {
      const res = await fetch('/api/user/prompt-templates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      if (res.ok) {
        await loadTemplates()
        setPromptMessage({ key, type: 'success', text: 'Reverted to default.' })
      }
    } finally {
      setSavingKey(null)
    }
  }

  // Suppress unused variable warning — userId is passed for future use
  void userId

  const inputClass = 'w-full text-sm text-gray-800 border border-[#E5E0D0] rounded-lg px-3 py-2 bg-white outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-300 transition-colors'
  const btnPrimary = 'px-3 py-1.5 text-xs text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const btnSecondary = 'px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40'

  const visibleKeys = section === 'search' ? SEARCH_PROMPT_KEYS : SUMMARY_PROMPT_KEYS
  const visibleTemplates = templates.filter(t => visibleKeys.includes(t.key))

  return (
    <div className="space-y-6">
      {section === 'search' && (
      <>
      {/* API Key Section */}
      <section>
        <p className="text-xs text-gray-500 mb-3">
          PDA uses Anthropic Claude for summarization and search.
          Add your own API key to enable these features. Your key is encrypted
          and stored securely — it is never exposed to other users.
        </p>

        {keyLoading ? (
          <div className="text-xs text-gray-400">Loading...</div>
        ) : keyConfigured && !showKeyInput ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">Key configured:</span>
              <code className="text-xs bg-gray-50 px-2 py-0.5 rounded text-gray-600">{keyHint}</code>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleTestKey} disabled={keyTesting} className={btnPrimary}>
                {keyTesting ? 'Testing...' : 'Test connection'}
              </button>
              <button onClick={() => setShowKeyInput(true)} className={btnSecondary}>
                Replace
              </button>
              <button onClick={handleRemoveKey} disabled={keySaving} className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-..."
              className={inputClass}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey() }}
            />
            <p className="text-[11px] text-gray-400">
              Don&apos;t have a key? Get one at{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 transition-colors">
                console.anthropic.com/settings/keys
              </a>
            </p>
            <div className="flex items-center gap-2">
              <button onClick={handleSaveKey} disabled={keySaving || !keyInput.trim()} className={btnPrimary}>
                {keySaving ? 'Saving...' : 'Save Key'}
              </button>
              {showKeyInput && (
                <button onClick={() => { setShowKeyInput(false); setKeyInput('') }} className={btnSecondary}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {keyMessage && (
          <p className={`text-xs mt-2 ${keyMessage.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
            {keyMessage.text}
          </p>
        )}
      </section>

      {/* Search Index Section */}
      <section>
        <h4 className="text-xs font-medium text-gray-500 mb-2">Search Index</h4>
        <p className="text-xs text-gray-500 mb-3">
          Build the semantic search index for AI-powered search. This processes
          all your journal entries and may take a minute.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setBackfillStatus('running')
              try {
                const res = await fetch('/api/ai/embed/backfill', { method: 'POST' })
                const data = await res.json()
                if (data.error === 'embedding_not_configured') {
                  setBackfillStatus('Semantic search is not configured for this app.')
                } else {
                  setBackfillStatus(`Done. Processed ${data.processed} entries, skipped ${data.skipped}, already indexed ${data.alreadyIndexed ?? 0}.`)
                }
              } catch {
                setBackfillStatus('Failed — check console for errors.')
              }
            }}
            disabled={backfillStatus === 'running'}
            className={btnPrimary}
          >
            {backfillStatus === 'running' ? 'Indexing...' : 'Rebuild search index'}
          </button>
        </div>
        {backfillStatus && backfillStatus !== 'running' && (
          <p className="text-xs text-gray-500 mt-2">{backfillStatus}</p>
        )}
      </section>

      </>
      )}

      {/* Prompt Templates Section */}
      <section>
        {section === 'search' && (
          <h4 className="text-xs font-medium text-gray-500 mb-2">Search Prompt</h4>
        )}
        <p className="text-xs text-gray-500 mb-3">
          Customize the prompts used for each AI feature. Revert to restore the built-in default.
        </p>

        {templatesLoading ? (
          <div className="text-xs text-gray-400">Loading...</div>
        ) : (
          <div className="space-y-4">
            {visibleTemplates.map(t => (
              <div key={t.key} className="space-y-1.5">
                <div>
                  <span className="text-sm font-medium text-gray-700">{t.label}</span>
                  <p className="text-xs text-gray-400">{t.description}</p>
                </div>
                <textarea
                  rows={4}
                  value={editedPrompts[t.key] ?? ''}
                  onChange={(e) => setEditedPrompts(prev => ({ ...prev, [t.key]: e.target.value }))}
                  className={`${inputClass} text-xs font-mono resize-y`}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSavePrompt(t.key)}
                    disabled={savingKey === t.key || editedPrompts[t.key] === t.promptText}
                    className={btnPrimary}
                  >
                    {savingKey === t.key ? 'Saving...' : 'Save'}
                  </button>
                  {t.isCustom && (
                    <button
                      onClick={() => handleRevertPrompt(t.key)}
                      disabled={savingKey === t.key}
                      className={btnSecondary}
                    >
                      Revert to default
                    </button>
                  )}
                </div>
                {promptMessage?.key === t.key && (
                  <p className={`text-xs ${promptMessage.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                    {promptMessage.text}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
