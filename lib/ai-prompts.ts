import { SUMMARY_SYSTEM_PROMPT, SMART_SEARCH_SYSTEM_PROMPT } from './prompts'

export const REPORT_SUMMARY_DEFAULT_PROMPT = 'Summarize these freeform notes into a 4-section report, including bullets for the most notable items. Do not preface the report with a header. Do not add unnecessary text decorators. Some of these notes may be for inconsequential items that should not be included in the report. The sections should be Overview, Tasks Completed, Tasks Outstanding (paying special attention to past due tasks), and Work Performed:'

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
  report_summary: {
    label: 'Report Summary',
    description: 'Used when generating the AI summary section of a report.',
    defaultPrompt: REPORT_SUMMARY_DEFAULT_PROMPT,
  },
}

export type PromptKey = keyof typeof AI_PROMPT_DEFAULTS
