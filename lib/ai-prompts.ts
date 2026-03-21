import { SUMMARY_SYSTEM_PROMPT, SMART_SEARCH_SYSTEM_PROMPT } from './prompts'

export const AI_PROMPT_DEFAULTS: Record<string, { label: string; description: string; defaultPrompt: string }> = {
  summarize: {
    label: 'Summarize',
    description: 'Used when summarizing a journal block or selected text.',
    defaultPrompt: SUMMARY_SYSTEM_PROMPT,
  },
  smart_search: {
    label: 'Smart Search',
    description: 'Used to parse natural language search queries into structured filters.',
    defaultPrompt: SMART_SEARCH_SYSTEM_PROMPT,
  },
}

export type PromptKey = keyof typeof AI_PROMPT_DEFAULTS
