export function htmlToPlainText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}

/**
 * Split a block's HTML into overlapping plain-text windows for embedding.
 *
 * Windowing scheme: a document of at most targetWords words is returned as a
 * single chunk regardless of size; longer documents are split into windows of
 * targetWords words advancing by (targetWords - overlapWords) words, so
 * consecutive chunks share an overlapWords-word overlap.
 *
 * The final filter dropping chunks under 10 words is a defensive safety net:
 * the loop's break condition guarantees the last window is always longer than
 * overlapWords words, so with the defaults nothing is ever dropped. If
 * overlapWords is ever lowered below 9, short tail windows WOULD be produced
 * and silently discarded — their trailing words are NOT covered by the
 * previous window — so keep overlapWords >= 9.
 */
export function chunkText(
  html: string,
  targetWords = 120,
  overlapWords = 30
): string[] {
  const text = htmlToPlainText(html)
  const words = text.split(/\s+/).filter(w => w.length > 0)

  if (words.length === 0) return []
  if (words.length <= targetWords) return [text]

  const step = targetWords - overlapWords
  const chunks: string[] = []

  for (let i = 0; i < words.length; i += step) {
    const chunk = words.slice(i, i + targetWords).join(' ')
    chunks.push(chunk)
    if (i + targetWords >= words.length) break
  }

  return chunks.filter(c => c.split(/\s+/).length >= 10)
}
