/**
 * Content conversion for block bodies that arrive from outside the TipTap
 * editor — today the MCP write tools, tomorrow any other API surface.
 *
 * The contract is Markdown in, Markdown out, with HTML accepted and passed
 * through. `toStorageHtml` parses per block rather than per document, so prose,
 * tables, lists and raw HTML can coexist in one payload. `htmlToPlainText` is
 * its inverse: it re-emits stored HTML as the same Markdown, so a caller can
 * read a card, edit the text and write it back without formatting decaying.
 * Writing → reading → writing is a fixed point.
 *
 * Literal `<` and `>` survive by construction: a `<` is only treated as markup
 * when it begins a tag we recognise. That is what keeps FACS letter insertions
 * (`<<VLSMOTHR>>`) and M-code comparisons (`DHDDTI'<DU86733I`) intact instead of
 * being silently eaten by DOMPurify.
 *
 * Two deliberate departures from CommonMark, both chosen because these notes
 * carry code:
 *   - `_` is never emphasis, so identifiers like `DB_NAME` are safe.
 *   - `*` emphasis must sit on a word boundary, so `A*B*C` stays literal.
 *
 * Everything emitted stays inside the TipTap schema (see TipTapEditor.tsx), so
 * content round-trips unchanged when a card is later opened and edited: table
 * cells and list items wrap their text in `<p>` because TableCell and ListItem
 * take block content, and headings become bold paragraphs because StarterKit is
 * configured with `heading: false` and would otherwise drop them.
 *
 * `toStorageHtml` is idempotent on its own output — every block it emits starts
 * a line with a recognised block tag and is passed through verbatim on a second
 * pass. update_scratchpad depends on that when it concatenates onto existing
 * stored HTML.
 */

// Block-level tags whose lines are passed through as raw HTML.
const BLOCK_TAG = /^<(table|thead|tbody|tfoot|tr|td|th|p|div|ul|ol|li|pre|blockquote|hr|img|figure|figcaption|h[1-6])\b/i

// Void elements never have a closing tag, so a raw-HTML block that opens with
// one is complete on its own line.
const VOID_TAG = /^(hr|img|br)$/i

// Inline tags allowed to stay markup inside a text run. Anything else that
// looks like a tag is escaped, which is what keeps `<<VLSMOTHR>>` intact.
const INLINE_TAG = /^<\/?(?:strong|b|em|i|u|s|del|code|mark|span|br|a)(?:\s[^<>]*)?\/?>/i

// A well-formed character reference. Preserved so a client that defensively
// entity-encodes (`&lt;&lt;VLSMOTHR&gt;&gt;`) gets the same rendered result as
// one that sends the characters raw.
const ENTITY = /^&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/

const LIST_ITEM = /^(\s*)(?:[-*+]|(\d{1,9})[.)])\s+(.*)$/
const THEMATIC_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const HEADING = /^\s*(#{1,6})\s+(.*)$/
const BLOCKQUOTE = /^\s*>\s?(.*)$/

// Characters a backslash may escape, so a caller can write a literal asterisk.
const ESCAPABLE = '\\`*_~[]()#->|'
const PLACEHOLDER = '\u0000'

/** Unconditional escape — used for code spans and fenced blocks, where nothing is markup. */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape a text run, leaving recognised inline tags and character references as markup. */
function escapeRun(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '<') {
      const tag = INLINE_TAG.exec(text.slice(i))
      if (tag) { out += tag[0]; i += tag[0].length - 1; continue }
      out += '&lt;'
    } else if (ch === '>') {
      out += '&gt;'
    } else if (ch === '&') {
      const ent = ENTITY.exec(text.slice(i))
      if (ent) { out += ent[0]; i += ent[0].length - 1; continue }
      out += '&amp;'
    } else {
      out += ch
    }
  }
  return out
}

/**
 * Inline Markdown for one run of text. Code spans are extracted first so their
 * contents are never treated as markup — an expression like `DHDDTI'<DU86733I`
 * survives verbatim — then emphasis and links are applied to the escaped text.
 */
function inlineMarkup(text: string): string {
  // Stash backslash-escaped characters so they cannot be read as markup.
  const escapes: string[] = []
  const stashed = text.replace(/\\(.)/g, (m, ch: string) =>
    ESCAPABLE.includes(ch) ? `${PLACEHOLDER}${escapes.push(ch) - 1}${PLACEHOLDER}` : m
  )

  const rendered = stashed
    .split(/(`[^`\n]+`)/)
    .map(part =>
      part.length > 2 && part.startsWith('`') && part.endsWith('`')
        ? `<code>${escapeText(part.slice(1, -1))}</code>`
        : emphasis(escapeRun(part))
    )
    .join('')

  return rendered.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'),
    (_, i: string) => escapeText(escapes[Number(i)])
  )
}

/**
 * Emphasis, strikethrough and links, applied to already-escaped text. The
 * `[^\w*]` guards keep `*` markup on word boundaries so M-code such as `A*B*C`
 * is left alone; `_` is deliberately not an emphasis marker at all.
 */
function emphasis(escaped: string): string {
  return escaped
    .replace(/\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g, (_, label: string, href: string) =>
      `<a href="${href}">${label || href}</a>`)
    .replace(/(^|[^\w*])\*\*(\S(?:[^*]*\S)?)\*\*(?![\w*])/g, '$1<strong>$2</strong>')
    .replace(/(^|[^\w*])\*(\S(?:[^*]*\S)?)\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w~])~~(\S(?:[^~]*\S)?)~~(?![\w~])/g, '$1<s>$2</s>')
}

/** A `|---|:--:|` style delimiter row: the line that makes the row above a header. */
function isDelimiterRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('-') || !t.includes('|')) return false
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(t)
}

/**
 * Split a table row into cells. Respects `\|` escapes and pipes inside backtick
 * code spans, both of which occur in M-code cells.
 */
function splitCells(row: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inCode = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (ch === '\\' && row[i + 1] === '|') { cur += '\\|'; i++; continue }
    if (ch === '`') inCode = !inCode
    if (ch === '|' && !inCode) { cells.push(cur); cur = ''; continue }
    cur += ch
  }
  cells.push(cur)

  // Drop the empty cells created by the optional leading/trailing pipe.
  const t = row.trim()
  if (t.startsWith('|') && cells.length && !cells[0].trim()) cells.shift()
  if (t.endsWith('|') && cells.length && !cells[cells.length - 1].trim()) cells.pop()
  return cells.map(c => c.trim())
}

function cellHtml(tag: 'th' | 'td', text: string): string {
  // TableCell/TableHeader content is `block+`, so an unwrapped text node would
  // be dropped when TipTap parses the stored HTML.
  return `<${tag}><p>${inlineMarkup(text)}</p></${tag}>`
}

function renderTable(headerCells: string[], bodyRows: string[][]): string {
  const cols = headerCells.length
  // ProseMirror tables must be rectangular; pad or trim ragged Markdown rows.
  const fit = (cells: string[]) => Array.from({ length: cols }, (_, i) => cells[i] ?? '')

  const head = `<thead><tr>${headerCells.map(c => cellHtml('th', c)).join('')}</tr></thead>`
  const body = bodyRows.length
    ? `<tbody>${bodyRows
        .map(r => `<tr>${fit(r).map(c => cellHtml('td', c)).join('')}</tr>`)
        .join('')}</tbody>`
    : ''
  return `<table>${head}${body}</table>`
}

interface ListEntry { indent: number; ordered: boolean; text: string }

/**
 * Build one list (and its nested sublists) from a flat run of items. ListItem
 * content is `paragraph block*`, so a nested list is appended inside the
 * preceding `<li>` rather than left as a sibling.
 */
function renderList(items: ListEntry[], start: number): [string, number] {
  const level = items[start].indent
  const ordered = items[start].ordered
  const parts: string[] = []
  let i = start

  while (i < items.length && items[i].indent >= level) {
    if (items[i].indent > level) {
      const [child, next] = renderList(items, i)
      if (parts.length) parts[parts.length - 1] += child
      else parts.push(child)
      i = next
      continue
    }
    if (items[i].ordered !== ordered) break
    parts.push(`<p>${inlineMarkup(items[i].text)}</p>`)
    i++
  }

  const tag = ordered ? 'ol' : 'ul'
  return [`<${tag}>${parts.map(p => `<li>${p}</li>`).join('')}</${tag}>`, i]
}

/**
 * Convert caller-supplied content into the HTML stored in `journal_blocks.content`.
 * The result still passes through sanitizeHtml before storage.
 */
export function toStorageHtml(input: string): string {
  const lines = input.replace(/\r\n?/g, '\n').split(PLACEHOLDER).join('').split('\n')
  const out: string[] = []
  let para: string[] = []

  const flushParagraph = () => {
    if (!para.length) return
    out.push(`<p>${para.map(inlineMarkup).join('<br>')}</p>`)
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) { flushParagraph(); continue }

    // Fenced code block — the whole body is literal.
    const fence = /^(```|~~~)(.*)$/.exec(trimmed)
    if (fence) {
      flushParagraph()
      const marker = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== marker) { body.push(lines[i]); i++ }
      out.push(`<pre><code>${escapeText(body.join('\n'))}</code></pre>`)
      continue
    }

    // Section break. Checked before lists so `***` is not read as a bullet.
    if (THEMATIC_BREAK.test(line)) { flushParagraph(); out.push('<hr>'); continue }

    // Headings become bold paragraphs: StarterKit runs with `heading: false`,
    // so a real <h2> would be dropped the first time the card was edited.
    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      out.push(`<p><strong>${inlineMarkup(heading[2].replace(/\s+#+\s*$/, ''))}</strong></p>`)
      continue
    }

    // Blockquote — consecutive `>` lines form one quote.
    const quote = BLOCKQUOTE.exec(line)
    if (quote) {
      flushParagraph()
      const body = [quote[1]]
      while (i + 1 < lines.length && BLOCKQUOTE.test(lines[i + 1])) {
        body.push((BLOCKQUOTE.exec(lines[++i]) as RegExpExecArray)[1])
      }
      out.push(`<blockquote><p>${body.map(inlineMarkup).join('<br>')}</p></blockquote>`)
      continue
    }

    // Raw HTML block — consume until the opening tag balances, then pass through.
    const block = BLOCK_TAG.exec(trimmed)
    if (block) {
      flushParagraph()
      const tag = block[1].toLowerCase()
      if (VOID_TAG.test(tag)) { out.push(line); continue }
      const open = new RegExp(`<${tag}\\b`, 'gi')
      const close = new RegExp(`</${tag}\\s*>`, 'gi')
      const chunk: string[] = []
      let depth = 0
      while (i < lines.length) {
        const cur = lines[i]
        chunk.push(cur)
        depth += (cur.match(open) ?? []).length - (cur.match(close) ?? []).length
        if (depth <= 0) break
        i++
      }
      out.push(chunk.join('\n'))
      continue
    }

    // Markdown pipe table — a row followed by a delimiter row.
    if (line.includes('|') && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      flushParagraph()
      const header = splitCells(line)
      i += 2
      const body: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() && !BLOCK_TAG.test(lines[i].trim())) {
        body.push(splitCells(lines[i]))
        i++
      }
      i-- // step back; the for-loop increment consumes the terminating line
      out.push(renderTable(header, body))
      continue
    }

    // Bullet or numbered list, including nesting by indentation.
    const item = LIST_ITEM.exec(line)
    if (item) {
      flushParagraph()
      const items: ListEntry[] = []
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i])
        if (m) {
          items.push({ indent: m[1].replace(/\t/g, '  ').length, ordered: m[2] !== undefined, text: m[3] })
          i++
          continue
        }
        // A blank line between items is a "loose" list, not the end of one.
        if (!lines[i].trim() && LIST_ITEM.test(lines[i + 1] ?? '')) { i++; continue }
        // An indented, non-blank, non-item line continues the previous item.
        if (items.length && lines[i].trim() && /^\s{2,}/.test(lines[i])) {
          items[items.length - 1].text += `<br>${lines[i].trim()}`
          i++
          continue
        }
        break
      }
      i--
      out.push(renderList(items, 0)[0])
      continue
    }

    para.push(line)
  }
  flushParagraph()

  return out.join('\n') || '<p></p>'
}

/**
 * HTML → the Markdown a caller would have written to produce it. The read tools
 * return this as each block's `text`, so tables, lists and formatting survive a
 * read-edit-write cycle instead of being flattened into undifferentiated prose.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ''
  return serialize(html)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Find the index just past the balanced closing tag for an element opened at `from`. */
function endOfElement(html: string, tag: string, from: number): number {
  const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  scan.lastIndex = from
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = scan.exec(html)) !== null) {
    depth += m[1] ? -1 : 1
    if (depth === 0) return scan.lastIndex
  }
  return html.length
}

/** Inner HTML of an element that starts at `from`, plus the index just past it. */
function innerOf(html: string, tag: string, from: number): [string, number] {
  const end = endOfElement(html, tag, from)
  const openEnd = html.indexOf('>', from) + 1
  const closeStart = html.lastIndexOf('<', end - 1)
  return [html.slice(openEnd, closeStart), end]
}

function serialize(html: string): string {
  const tokens = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g
  const listStack: { ordered: boolean; n: number }[] = []
  const hrefs: string[] = []
  let out = ''
  let cursor = 0
  let liDepth = 0
  let codeDepth = 0
  let m: RegExpExecArray | null

  while ((m = tokens.exec(html)) !== null) {
    const text = decodeEntities(html.slice(cursor, m.index))
    // Inside <code> the text is literal by definition; everywhere else it has
    // to be re-escaped, or a stored literal `*x*` would come back as Markdown
    // emphasis and turn into <em> the next time the caller writes it.
    out += codeDepth > 0 ? text : escapeMarkdownText(text)
    const closing = Boolean(m[1])
    const tag = m[2].toLowerCase()

    // Elements whose whole subtree is rendered in one go.
    if (!closing && (tag === 'table' || tag === 'pre' || tag === 'blockquote')) {
      const end = endOfElement(html, tag, m.index)
      if (tag === 'table') {
        out += `\n\n${tableToMarkdown(html.slice(m.index, end))}\n\n`
      } else if (tag === 'pre') {
        const [inner] = innerOf(html, tag, m.index)
        const code = inner.replace(/^\s*<code\b[^>]*>/i, '').replace(/<\/code\s*>\s*$/i, '')
        out += `\n\`\`\`\n${decodeEntities(code.replace(/<[^>]+>/g, ''))}\n\`\`\`\n`
      } else {
        const [inner] = innerOf(html, tag, m.index)
        const body = serialize(inner).trim().split('\n').map(l => `> ${l}`.trimEnd()).join('\n')
        out += `\n${body}\n`
      }
      tokens.lastIndex = end
      cursor = end
      continue
    }

    switch (tag) {
      case 'ul': case 'ol':
        // Only the outermost list is a block: a nested list continues the line
        // its parent item started, so it must not open a blank line.
        if (closing) { listStack.pop(); if (!listStack.length) out += '\n\n' }
        else { if (!listStack.length) out += '\n\n'; listStack.push({ ordered: tag === 'ol', n: 0 }) }
        break
      case 'li': {
        if (closing) { liDepth = Math.max(0, liDepth - 1); break }
        liDepth++
        const depth = Math.max(0, listStack.length - 1)
        const list = listStack[listStack.length - 1]
        const marker = list?.ordered ? `${++list.n}. ` : '- '
        out += `\n${'  '.repeat(depth)}${marker}`
        break
      }
      case 'hr': out += '\n\n---\n\n'; break
      case 'br': out += '\n'; break
      // A paragraph inside a list item is the item's own text; ending it with a
      // blank line would split one list into several on the way back in.
      case 'p': case 'div': if (closing && liDepth === 0) out += '\n'; break
      case 'strong': case 'b': out += '**'; break
      case 'em': case 'i': out += '*'; break
      case 's': case 'del': out += '~~'; break
      case 'code': codeDepth += closing ? -1 : 1; out += '`'; break
      case 'a': {
        if (closing) { out += `](${hrefs.pop() ?? ''})`; break }
        const href = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(m[0])
        hrefs.push(decodeEntities(href?.[1] ?? href?.[2] ?? ''))
        out += '['
        break
      }
      // Formatting with no Markdown spelling stays as a tag, which round-trips
      // through the inline allowlist on the way back in.
      case 'u': case 'mark': out += m[0]; break
      default: break
    }
    cursor = tokens.lastIndex
  }

  const tail = decodeEntities(html.slice(cursor))
  return out + (codeDepth > 0 ? tail : escapeMarkdownText(tail))
}

/**
 * Backslash-escape only the runs that `toStorageHtml` would read back as
 * markup. Escaping every delimiter would be correct but noisy — `A*B*C` is
 * already safe, because emphasis has to sit on a word boundary — so this
 * escapes a delimiter pair only where one would actually match.
 */
function escapeMarkdownText(text: string): string {
  return text
    .replace(/`/g, '\\`')
    .replace(/(^|[^\w*])\*\*(\S(?:[^*]*\S)?)\*\*(?![\w*])/g, (_, p: string, i: string) => `${p}\\*\\*${i}\\*\\*`)
    .replace(/(^|[^\w*])\*(\S(?:[^*]*\S)?)\*(?![\w*])/g, (_, p: string, i: string) => `${p}\\*${i}\\*`)
    .replace(/(^|[^\w~])~~(\S(?:[^~]*\S)?)~~(?![\w~])/g, (_, p: string, i: string) => `${p}\\~\\~${i}\\~\\~`)
    .replace(/\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g, m => `\\${m}`)
}

/**
 * Decode character references. `&amp;` is decoded last: doing it first turns
 * `&amp;lt;` into `&lt;` and then into `<`, which is why content written as
 * escaped text used to read back as though the escaping had been dropped.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function tableToMarkdown(tableHtml: string): string {
  const rows = Array.from(tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map(m => m[1])
  const cells = rows
    .map(row =>
      Array.from(row.matchAll(/<(t[dh])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)).map(c => cellText(c[2]))
    )
    .filter(r => r.length > 0)
  if (!cells.length) return ''

  const width = Math.max(...cells.map(r => r.length))
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`

  const [header, ...body] = cells
  return [line(header), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)].join('\n')
}

/** One cell's inner HTML → single-line Markdown, with pipes escaped so the row stays parseable. */
function cellText(inner: string): string {
  return serialize(inner)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\|/g, '\\|')
}
