/**
 * Content conversion for block bodies that arrive from outside the TipTap
 * editor — today the MCP write tools, tomorrow any other API surface.
 *
 * The contract is "Markdown-ish plain text, with HTML passed through", applied
 * per block rather than per document. The previous heuristic tested whether the
 * whole payload started with `<`, which failed both ways: a payload of prose
 * followed by a `<table>` was escaped wholesale and rendered as literal tags,
 * while a payload that did start with `<` skipped escaping entirely and let
 * DOMPurify silently eat anything that merely looked like a tag — `<<VLSMOTHR>>`
 * was stored as `&lt;&gt;`, and `DHDDTI'<DU86733I` lost everything after `<D`.
 *
 * Both of those shapes are load-bearing in FACS notes (letter insertions and
 * M-code comparisons), so literal `<` and `>` survive here by construction: a
 * `<` is only treated as markup when it begins a tag we recognise.
 *
 * Everything emitted stays inside the TipTap schema (see TipTapEditor.tsx), so
 * content round-trips unchanged when a card is later opened and edited:
 * table cells are wrapped in `<p>` because TableCell's content is `block+`, and
 * no headings are generated because StarterKit is configured with
 * `heading: false`.
 *
 * `toStorageHtml` is idempotent on its own output — every block it emits starts
 * a line with a recognised block tag and is passed through verbatim on a second
 * pass. update_scratchpad depends on that when it concatenates onto existing
 * stored HTML.
 */

// Block-level tags whose lines are passed through as raw HTML. Headings are
// accepted (callers may send them) but never generated.
const BLOCK_TAG = /^<(table|thead|tbody|tfoot|tr|td|th|p|div|ul|ol|li|pre|blockquote|hr|img|figure|figcaption|h[1-6])\b/i

// Inline tags allowed to stay markup inside a text run. Anything else that
// looks like a tag is escaped, which is what keeps `<<VLSMOTHR>>` intact.
const INLINE_TAG = /^<\/?(?:strong|b|em|i|u|s|del|code|mark|span|br|a)(?:\s[^<>]*)?\/?>/i

// A well-formed character reference. Preserved so a client that defensively
// entity-encodes (`&lt;&lt;VLSMOTHR&gt;&gt;`) gets the same rendered result as
// one that sends the characters raw.
const ENTITY = /^&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/

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
 * Inline markup for one line of text: backtick spans become `<code>` (monospace
 * for the M-code these notes carry), everything else is escaped by escapeRun.
 * Code span contents are escaped unconditionally so an expression like
 * `DHDDTI'<DU86733I` survives verbatim.
 */
function inlineMarkup(text: string): string {
  return text
    .split(/(`[^`\n]+`)/)
    .map(part =>
      part.length > 2 && part.startsWith('`') && part.endsWith('`')
        ? `<code>${escapeText(part.slice(1, -1))}</code>`
        : escapeRun(part)
    )
    .join('')
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
    if (ch === '\\' && row[i + 1] === '|') { cur += '|'; i++; continue }
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
  const fit = (cells: string[]) =>
    Array.from({ length: cols }, (_, i) => cells[i] ?? '')

  const head = `<thead><tr>${headerCells.map(c => cellHtml('th', c)).join('')}</tr></thead>`
  const body = bodyRows.length
    ? `<tbody>${bodyRows
        .map(r => `<tr>${fit(r).map(c => cellHtml('td', c)).join('')}</tr>`)
        .join('')}</tbody>`
    : ''
  return `<table>${head}${body}</table>`
}

/**
 * Convert caller-supplied content into the HTML stored in `journal_blocks.content`.
 * The result still passes through sanitizeHtml before storage.
 */
export function toStorageHtml(input: string): string {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
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

    // Raw HTML block — consume until the opening tag balances, then pass through.
    const block = BLOCK_TAG.exec(trimmed)
    if (block) {
      flushParagraph()
      const tag = block[1].toLowerCase()
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

    para.push(line)
  }
  flushParagraph()

  return out.join('\n') || '<p></p>'
}

/**
 * HTML → plain text, for the shape the MCP read tools return.
 *
 * Tables are re-emitted as Markdown pipe tables so a card written as a table
 * reads back as one, rather than as cells run together with no separator.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ''

  // Tables are converted in place and their output kept out of the tag-stripping
  // pass. Substituting Markdown into the HTML string first would feed text like
  // `DHDDTI'<DU86733I` back through the `<[^>]+>` strip, which would then eat
  // everything up to the next `>` — the decoded content and part of the table
  // with it.
  const out: string[] = []
  const tables = /<table\b[\s\S]*?<\/table>/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tables.exec(html)) !== null) {
    out.push(stripToText(html.slice(last, m.index)))
    out.push(`\n\n${tableToMarkdown(m[0])}\n\n`)
    last = m.index + m[0].length
  }
  out.push(stripToText(html.slice(last)))

  return out.join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Tag-strip and entity-decode a run of HTML that contains no tables. Code is
 * re-emitted in its Markdown form so that reading a block, editing the text and
 * writing it back preserves monospace instead of quietly flattening it.
 */
function stripToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<pre\b[^>]*>\s*(?:<code\b[^>]*>)?([\s\S]*?)(?:<\/code\s*>)?\s*<\/pre\s*>/gi, '\n```\n$1\n```\n')
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, '`$1`')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|div|h[1-6]|blockquote)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
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

/** One cell's inner HTML → single-line text, with pipes escaped so the row stays parseable. */
function cellText(inner: string): string {
  return decodeEntities(
    inner
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, '`$1`')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div)\s*>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\|/g, '\\|')
}
