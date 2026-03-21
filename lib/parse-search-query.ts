export interface ParsedSearchQuery {
  searchTerms: string
  dateFrom: string | null
  dateTo: string | null
  entryTypes: ('info' | 'task')[] | null
  statuses: string[] | null
  propertyValues: string[] | null
  reasoning: string
}

interface ParseSearchQueryInput {
  query: string
  apiKey: string
  currentDate: string
  systemPrompt: string
  properties: { name: string; values: string[] }[]
}

export async function parseSearchQuery({
  query,
  apiKey,
  currentDate,
  systemPrompt,
  properties,
}: ParseSearchQueryInput): Promise<ParsedSearchQuery | null> {
  try {
    const propsContext = properties.length > 0
      ? `\n\nAvailable properties and their values:\n${properties.map(p => `- ${p.name}: ${p.values.join(', ')}`).join('\n')}`
      : ''

    const userMessage = `Current date: ${currentDate}${propsContext}\n\nSearch query: "${query}"`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!res.ok) return null

    const data = await res.json()
    const text = data.content?.[0]?.type === 'text' ? data.content[0].text : null
    if (!text) return null

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonStr = text.replace(/^```json?\s*/, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(jsonStr)

    // Validate and normalize
    return {
      searchTerms: typeof parsed.searchTerms === 'string' ? parsed.searchTerms : query,
      dateFrom: typeof parsed.dateFrom === 'string' ? parsed.dateFrom : null,
      dateTo: typeof parsed.dateTo === 'string' ? parsed.dateTo : null,
      entryTypes: Array.isArray(parsed.entryTypes) ? parsed.entryTypes : null,
      statuses: Array.isArray(parsed.statuses) ? parsed.statuses : null,
      propertyValues: Array.isArray(parsed.propertyValues) ? parsed.propertyValues : null,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    }
  } catch {
    return null
  }
}
