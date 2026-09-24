import { emit, step, useRun } from '../activity.ts'
import { chat, provider, type ChatMessage, type ToolCall } from '../llm.ts'
import { log } from '../util.ts'
import { getWorld } from '../world.ts'
import { describeScene } from './context.ts'
import { runTool, schemas, toolSpecs, type ToolName } from './tools.ts'

const SYSTEM = `You are the world builder inside NeuroCraft, a live 3D world. The user types what they want and you make it happen with tools, right away.

Rules:
- Act immediately with tools. Only ask a question if the request is truly impossible to interpret.
- Refer to existing objects by their id from the scene. "it"/"this"/"that" means the selected object.
- Places: vague places like "on the hill", "over there", "in the distance", "by the lake" → pick a matching landmark and pass its "x,z". "here" = the double-clicked point. Next to an object → its id.
- To make something fly/circle/orbit around or above another object, use update_object with around=<that object's id> plus the behavior (fly for above; set altitude above that object's height).
- Use realistic sizes in meters. "bigger"/"smaller" means scale_factor 2 / 0.5; "a bit bigger/smaller" means 1.3 / 0.75.
- Movement: creatures/characters that walk use behavior wander (or drive for a set loop) with a Walk/Run clip if available; flying things use fly; vehicles drive; fish swim.
- Several changes in one request → call several tools.
- When done, reply with ONE short, friendly sentence about what changed in the world. Never mention tools, ids, code or files.`

const MAX_STEPS = 8
const history: ChatMessage[] = []

export interface AgentControl {
  cancelled: boolean
}

function label(name: ToolName, args: Record<string, unknown>) {
  const s = (k: string) => String(args[k] ?? '')
  switch (name) {
    case 'add_object':
      return `Adding ${s('query')}`
    case 'update_object':
      return `Changing ${s('id')}`
    case 'move_object':
      return `Moving ${s('id')}`
    case 'remove_object':
      return `Removing ${s('id')}`
    case 'set_time':
      return `Changing the light to ${s('time')}`
    case 'focus_camera':
      return `Looking at ${s('id')}`
    case 'undo':
      return 'Undoing'
    case 'ask_devin':
      return 'This needs new code'
  }
}

function parseArgs(call: ToolCall): Record<string, unknown> {
  const raw = call.function.arguments as unknown
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  try {
    return JSON.parse(String(raw || '{}')) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** One user message: LLM ↔ tools loop, streamed into the activity run `title`. */
export async function runAgent(message: string, title: string, control: AgentControl) {
  useRun(title)
  const p = provider()
  log(`agent (${p.name}/${p.model}): ${message}`)
  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: `${SYSTEM}\n\nCurrent world:\n${describeScene(getWorld())}` },
      ...history.slice(-12),
      { role: 'user', content: message },
    ]
    for (let i = 0; i < MAX_STEPS; i++) {
      if (control.cancelled) throw new Error('Stopped')
      const reply = await chat(messages, toolSpecs)
      const calls = reply.tool_calls ?? []
      if (!calls.length) {
        const text = reply.content?.trim() || 'Done.'
        emit({ source: 'agent', status: 'done', message: text })
        history.push({ role: 'user', content: message }, { role: 'assistant', content: text })
        return
      }
      messages.push({ role: 'assistant', content: reply.content ?? '', tool_calls: calls })
      const summaries: string[] = []
      let failed = false
      for (const call of calls) {
        if (control.cancelled) throw new Error('Stopped')
        const name = call.function.name as ToolName
        const args = parseArgs(call)
        let content: string
        if (!(name in schemas)) {
          content = `Error: unknown tool ${name}`
          failed = true
        } else {
          try {
            const r = await step(`tool-${name}`, label(name, args), async (s) => {
              const out = await runTool(name, args)
              s.done(out.summary)
              if (out.focus) s.focus(out.focus)
              return out
            })
            content = r.result
            summaries.push(r.summary)
          } catch (e) {
            content = `Error: ${e instanceof Error ? e.message : e}`
            failed = true
          }
        }
        messages.push({ role: 'tool', tool_call_id: call.id, name, content })
      }
      // Everything worked: finish without another LLM round-trip (the free tier limits tokens per minute).
      if (!failed) {
        emit({ source: 'agent', status: 'done', message: reply.content?.trim() || 'Done' })
        history.push({ role: 'user', content: message }, { role: 'assistant', content: `Done: ${summaries.join('; ')}` })
        return
      }
    }
    emit({ source: 'agent', status: 'done', message: 'Done.' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log(`agent error: ${e instanceof Error ? e.stack : e}`)
    emit({ source: 'agent', status: 'error', message: msg === 'Stopped' ? 'Stopped' : `Something went wrong: ${msg}` })
  }
}

export function resetAgent() {
  history.length = 0
}
