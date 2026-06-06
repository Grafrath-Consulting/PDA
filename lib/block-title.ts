// The display title of a card = the text of its first block-level element (the
// header / first line). htmlToText collapses every block onto one line, so we
// parse the HTML and read the first child instead. Used for card-link text and
// action-history entries.
export function blockTitle(html: string | null | undefined): string {
  if (!html) return 'Untitled card'
  if (typeof document === 'undefined') {
    const stripped = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return stripped ? stripped.slice(0, 200) : 'Untitled card'
  }
  const div = document.createElement('div')
  div.innerHTML = html
  const t = (div.firstElementChild?.textContent ?? div.textContent ?? '').trim()
  return t ? t.slice(0, 200) : 'Untitled card'
}
