import { createClient } from '@supabase/supabase-js'
import { decryptApiKey } from './ai-key-crypto'
import { AI_PROMPT_DEFAULTS, type PromptKey } from './ai-prompts'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Missing Supabase service-role configuration')
  return createClient(url, key)
}

export async function getUserApiKey(userId: string): Promise<string | null> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('user_ai_config')
    .select('encrypted_api_key')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data?.encrypted_api_key) return null
  return decryptApiKey(data.encrypted_api_key)
}

export async function getUserPrompt(userId: string, key: PromptKey): Promise<string> {
  const defaults = AI_PROMPT_DEFAULTS[key]
  if (!defaults) throw new Error(`Unknown prompt key: ${key}`)

  const supabase = getServiceClient()
  const { data } = await supabase
    .from('user_prompt_templates')
    .select('prompt_text')
    .eq('user_id', userId)
    .eq('prompt_key', key)
    .maybeSingle()

  return data?.prompt_text ?? defaults.defaultPrompt
}
