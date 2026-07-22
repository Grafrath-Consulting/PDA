import DOMPurify from 'isomorphic-dompurify'

/**
 * Sanitize untrusted HTML before it is stored or rendered.
 *
 * Block content reaches the DOM through several `dangerouslySetInnerHTML`
 * sinks (search-highlight overlay, version history, summary preview) and can
 * originate outside the TipTap editor (MCP write tools, AI responses), so
 * every one of those paths must pass through this function. HTML produced by
 * TipTap itself round-trips unchanged: the allowlist covers all node and mark
 * types the editor emits (including tables, links, and highlights).
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // TipTap links open in a new tab; DOMPurify strips `target` by default.
    ADD_ATTR: ['target'],
  })
}
