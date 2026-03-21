const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'in', 'on', 'at', 'to', 'of', 'or',
  'and', 'but', 'for', 'nor', 'so', 'yet', 'be', 'by', 'do', 'go',
  'he', 'if', 'me', 'my', 'no', 'up', 'us', 'we',
])

export function highlightHTML(html: string, needle: string | string[]): string {
  if (typeof document === 'undefined') return html

  // Build list of terms to highlight
  const rawTerms = Array.isArray(needle) ? needle : needle.split(/\s+/)
  const terms = rawTerms
    .map(t => t.trim())
    .filter(t => t.length > 2 && !STOP_WORDS.has(t.toLowerCase()))

  if (terms.length === 0) return html

  // Build a single regex matching any of the terms
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi')

  const div = document.createElement('div')
  div.innerHTML = html

  function walkAndHighlight(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (!regex.test(text)) return
      regex.lastIndex = 0
      const frag = document.createDocumentFragment()
      let last = 0
      let m: RegExpExecArray | null
      while ((m = regex.exec(text)) !== null) {
        if (m.index > last) {
          frag.appendChild(document.createTextNode(text.slice(last, m.index)))
        }
        const mark = document.createElement('mark')
        mark.className = 'search-highlight'
        mark.textContent = m[0]
        frag.appendChild(mark)
        last = m.index + m[0].length
      }
      if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)))
      }
      node.parentNode?.replaceChild(frag, node)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName?.toLowerCase()
      if (tag === 'script' || tag === 'style') return
      Array.from(node.childNodes).forEach(walkAndHighlight)
    }
  }

  Array.from(div.childNodes).forEach(walkAndHighlight)
  return div.innerHTML
}
