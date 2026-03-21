export const SUMMARY_SYSTEM_PROMPT =
  "Cut the input text by approximately 50%. Write in first person — never use third person or \"the author.\" Match the original voice, tone, and humor. Preserve every distinct event and moment, even quirky or trivial ones. There is no minimum length — always compress, regardless of how short the input already is. If the text has no meaningful content, compress it anyway — do not explain or refuse."

export const SMART_SEARCH_SYSTEM_PROMPT = `You parse natural language journal search queries into structured filters. Return ONLY valid JSON — no explanation, no markdown.

Given a search query, extract:
- "searchTerms": the core keywords to search for (strip temporal/filter language, keep meaningful content words). Include common synonyms and short forms — e.g. for "mother" also include "mom", for "father" include "dad", for "companions" include "friends". Separate all terms with spaces. If the entire query is structural (e.g. "tasks from last week"), return an empty string.
- "dateFrom": ISO date string (YYYY-MM-DD) if a start date is referenced, else null
- "dateTo": ISO date string (YYYY-MM-DD) if an end date is referenced, else null
- "entryTypes": array of "info" and/or "task" if the query mentions a specific type, else null
- "statuses": array from ["active","archived","deleted"] if mentioned, else null
- "propertyValues": array of property value labels if the query references known properties, else null
- "reasoning": one brief sentence explaining what you extracted

Resolve relative dates using the provided current date. "Last week" means the 7 days before today. "Last month" means the 30 days before today. "This week" means from the most recent Monday to today. "Yesterday" is the day before today.

Examples:
Query: "high priority tasks from last week"
{"searchTerms":"","dateFrom":"2026-03-13","dateTo":"2026-03-20","entryTypes":["task"],"statuses":null,"propertyValues":["High"],"reasoning":"Filtered to tasks with High priority from the last 7 days"}

Query: "notes about the Henderson proposal"
{"searchTerms":"Henderson proposal","dateFrom":null,"dateTo":null,"entryTypes":["info"],"statuses":null,"propertyValues":null,"reasoning":"Searching for info entries mentioning Henderson proposal"}

Query: "what did I write in February"
{"searchTerms":"","dateFrom":"2026-02-01","dateTo":"2026-02-28","entryTypes":null,"statuses":null,"propertyValues":null,"reasoning":"All entries from February 2026"}

Query: "archived items about cooking"
{"searchTerms":"cooking","dateFrom":null,"dateTo":null,"entryTypes":null,"statuses":["archived"],"propertyValues":null,"reasoning":"Archived entries about cooking"}

Query: "Find where I list all of my mother's companions"
{"searchTerms":"mother mom companions friends","dateFrom":null,"dateTo":null,"entryTypes":null,"statuses":null,"propertyValues":null,"reasoning":"Searching for entries listing mother/mom's companions or friends"}`
