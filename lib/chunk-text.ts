export function htmlToPlainText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}

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
