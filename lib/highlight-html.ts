export function highlightHTML(html: string, query: string): string {
  if (!query.trim()) return html
  if (typeof document === 'undefined') return html

  const div = document.createElement('div')
  div.innerHTML = html

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, 'gi')

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
