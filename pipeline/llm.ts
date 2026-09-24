import { log } from './util.ts'

/**
 * Minimal OpenAI-compatible chat client (Groq, Ollama, or any /v1/chat/completions endpoint).
 * Provider: LLM_BASE_URL + LLM_API_KEY + LLM_MODEL if set; else Groq when GROQ_API_KEY is set; else local Ollama.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolSpec {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface Provider {
  name: string
  baseUrl: string
  apiKey?: string
  model: string
}

export function provider(): Provider {
  const e = process.env
  if (e.LLM_BASE_URL) return { name: 'custom', baseUrl: e.LLM_BASE_URL, apiKey: e.LLM_API_KEY, model: e.LLM_MODEL ?? 'gpt-4o-mini' }
  if (e.GROQ_API_KEY) return { name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: e.GROQ_API_KEY, model: e.LLM_MODEL ?? 'openai/gpt-oss-120b' }
  return { name: 'ollama', baseUrl: 'http://localhost:11434/v1', model: e.LLM_MODEL ?? 'qwen3:latest' }
}

/**
 * Groq's free plan limits tokens per minute per model, so on a rate limit we move to the next model
 * (each has its own budget) instead of waiting. Only waits when every model is saturated.
 */
const GROQ_FALLBACKS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']

export async function chat(
  messages: ChatMessage[],
  tools?: ToolSpec[],
  opts: { temperature?: number; json?: boolean; model?: string } = {},
): Promise<ChatMessage> {
  const p = provider()
  const primary = opts.model ?? p.model
  const models = p.name === 'groq' ? [primary, ...GROQ_FALLBACKS.filter((m) => m !== primary)] : [primary]
  let lastWait = 2000

  for (let round = 0; round < 3; round++) {
    for (const model of models) {
      const body: Record<string, unknown> = { model, messages, temperature: opts.temperature ?? 0.2 }
      if (tools?.length) Object.assign(body, { tools, tool_choice: 'auto' })
      if (opts.json) body.response_format = { type: 'json_object' }
      if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low'
      if (p.name === 'ollama') body.reasoning_effort = 'none'

      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
        body: JSON.stringify(body),
      }).catch((e: Error) => {
        throw new Error(p.name === 'ollama' ? `No LLM configured: add GROQ_API_KEY to .env (free at console.groq.com) or start Ollama (${e.message})` : e.message)
      })
      if (res.status === 429) {
        lastWait = Math.min(15_000, Number(res.headers.get('retry-after') ?? 2) * 1000)
        log(`llm ${model} rate limited; trying next model`)
        continue
      }
      const json = (await res.json().catch(() => ({}))) as { choices?: { message: ChatMessage }[]; error?: { message?: string } }
      if (!res.ok || !json.choices?.[0]) throw new Error(`${p.name} ${model} ${res.status}: ${json.error?.message ?? 'no response'}`)
      return json.choices[0].message
    }
    log(`llm: all models rate limited, waiting ${lastWait}ms`)
    await new Promise((r) => setTimeout(r, lastWait))
  }
  throw new Error('the AI is rate limited right now; try again in a minute')
}

/** Cheap model for small side tasks (picking a search result), so it doesn't eat the main model's budget. */
export const lightModel = () => (provider().name === 'groq' ? 'openai/gpt-oss-20b' : undefined)
