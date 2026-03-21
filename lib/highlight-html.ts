const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'in', 'on', 'at', 'to', 'of', 'or',
  'and', 'but', 'for', 'nor', 'so', 'yet', 'be', 'by', 'do', 'go',
  'he', 'if', 'me', 'my', 'no', 'up', 'us', 'we',
])

export function highlightHTML(html: string, needle: string | string[], passageText?: string): string {
  if (typeof document === 'undefined') return html

  const div = document.createElement('div')
  div.innerHTML = html

  // --- Passage highlighting: wrap the matched chunk region ---
  if (passageText) {
    highlightPassage(div, passageText)
  }

  // --- Term highlighting: highlight individual query words ---
  const rawTerms = Array.isArray(needle) ? needle : needle.split(/\s+/)
  const terms = rawTerms
    .map(t => t.trim())
    .filter(t => t.length > 2 && !STOP_WORDS.has(t.toLowerCase()))

  if (terms.length > 0) {
    const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    // Use word boundaries to avoid matching "mom" inside "moment" etc.
    const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
    walkAndHighlightTerms(div, regex)
  }

  return div.innerHTML
}

function walkAndHighlightTerms(root: Node, regex: RegExp) {
  function walk(node: Node) {
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
      Array.from(node.childNodes).forEach(walk)
    }
  }
  Array.from(root.childNodes).forEach(walk)
}

/** Normalize text for fuzzy passage matching: collapse whitespace, lowercase */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Find a passage (chunk text) within the DOM's text content and wrap
 * the matching text nodes in <mark class="chunk-highlight">.
 *
 * Uses a sliding-window approach on text nodes to find where the passage
 * appears, then wraps the corresponding DOM range.
 */
function highlightPassage(root: Node, passage: string) {
  const normPassage = normalize(passage)
  if (!normPassage) return

  // Collect all text nodes with their character offsets in the full text
  const textNodes: { node: Text; start: number; end: number }[] = []
  let offset = 0
  function collectTextNodes(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length
      textNodes.push({ node: node as Text, start: offset, end: offset + len })
      offset += len
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName?.toLowerCase()
      if (tag === 'script' || tag === 'style') return
      // Add space for block-level element boundaries so text doesn't run together
      if (['p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'].includes(tag)) {
        offset += 1 // virtual space
      }
      Array.from(node.childNodes).forEach(collectTextNodes)
    }
  }
  collectTextNodes(root)

  // Build the full text from text nodes (with virtual spaces for block boundaries)
  let fullText = ''
  const charMap: number[] = [] // charMap[i] = index into textNodes array, or -1 for virtual spaces
  for (let i = 0; i < textNodes.length; i++) {
    const tn = textNodes[i]
    // If there's a gap between previous end and this start, insert spaces
    const prevEnd = i > 0 ? textNodes[i - 1].end : 0
    const gap = tn.start - prevEnd
    for (let g = 0; g < gap; g++) {
      fullText += ' '
      charMap.push(-1)
    }
    const text = tn.node.textContent ?? ''
    for (let c = 0; c < text.length; c++) {
      fullText += text[c]
      charMap.push(i)
    }
  }

  const normFull = normalize(fullText)

  // Find passage in the normalized full text
  // We need to map normalized positions back to original positions
  // Build a mapping: normFull index -> fullText index
  const normToOrig: number[] = []
  let ni = 0
  let inSpace = false
  for (let oi = 0; oi < fullText.length; oi++) {
    if (/\s/.test(fullText[oi])) {
      if (!inSpace && ni < normFull.length && normFull[ni] === ' ') {
        normToOrig.push(oi)
        ni++
        inSpace = true
      }
    } else {
      inSpace = false
      normToOrig.push(oi)
      ni++
    }
  }

  const matchIdx = normFull.indexOf(normPassage)
  if (matchIdx === -1) {
    // Try matching with just the first 40 words as a fallback
    const shortPassage = normalize(passage.split(/\s+/).slice(0, 40).join(' '))
    const shortMatch = normFull.indexOf(shortPassage)
    if (shortMatch === -1) return
    wrapRange(shortMatch, shortMatch + shortPassage.length)
    return
  }

  wrapRange(matchIdx, matchIdx + normPassage.length)

  function wrapRange(normStart: number, normEnd: number) {
    // Map normalized positions back to original text positions
    const origStart = normToOrig[normStart] ?? 0
    const origEnd = (normToOrig[normEnd - 1] ?? origStart) + 1

    // Find which text nodes are covered
    const startTnIdx = charMap[origStart]
    const endTnIdx = charMap[Math.min(origEnd - 1, charMap.length - 1)]
    if (startTnIdx === -1 || endTnIdx === -1 || startTnIdx === undefined || endTnIdx === undefined) return

    // Wrap each covered text node (or portion) in a chunk-highlight mark
    for (let i = startTnIdx; i <= endTnIdx; i++) {
      const tn = textNodes[i]
      if (!tn || !tn.node.parentNode) continue

      const text = tn.node.textContent ?? ''
      // Calculate the portion of this text node to highlight
      let sliceStart = 0
      let sliceEnd = text.length

      if (i === startTnIdx) {
        // First node: might start partway through
        // origStart is in the full text; tn.start is the node's offset
        // But we built charMap differently... recalculate
        let charCount = 0
        for (let ci = 0; ci < charMap.length; ci++) {
          if (charMap[ci] === i) {
            if (ci === origStart) {
              sliceStart = charCount
            }
            charCount++
          } else if (charMap[ci] > i) break
        }
      }
      if (i === endTnIdx) {
        let charCount = 0
        for (let ci = 0; ci < charMap.length; ci++) {
          if (charMap[ci] === i) {
            charCount++
            if (ci === origEnd - 1) {
              sliceEnd = charCount
            }
          } else if (charMap[ci] > i) break
        }
      }

      // Create fragment: [before][highlighted][after]
      const frag = document.createDocumentFragment()
      if (sliceStart > 0) {
        frag.appendChild(document.createTextNode(text.slice(0, sliceStart)))
      }
      const mark = document.createElement('mark')
      mark.className = 'chunk-highlight'
      mark.textContent = text.slice(sliceStart, sliceEnd)
      frag.appendChild(mark)
      if (sliceEnd < text.length) {
        frag.appendChild(document.createTextNode(text.slice(sliceEnd)))
      }
      tn.node.parentNode.replaceChild(frag, tn.node)
    }
  }
}
