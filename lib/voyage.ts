const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const MAX_BATCH = 128

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not set')

  const model = process.env.VOYAGE_MODEL ?? 'voyage-3-lite'
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH)
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: batch, model }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Voyage API error ${res.status}: ${body}`)
    }

    const data = await res.json()
    const embeddings = (data.data as { embedding: number[]; index: number }[])
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding)
    results.push(...embeddings)
  }

  return results
}

export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text])
  return embedding
}
