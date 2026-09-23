import { spawn, execFile, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ACTIVITY_FILE, type ActivityEvent, type ChatStatus } from '../shared/activity.ts'
import { ack, enqueue, listenerState, pendingMessages } from './inbox.ts'

/**
 * In-page chat. Two modes (NC_CHAT_MODE):
 * - relay (default): messages are queued in .neurocraft/inbox.jsonl for the Devin chat that is listening via
 *   `nc inbox --wait`, i.e. the same conversation the user already talks to, with all its context.
 * - cli: each message runs `devin -p` in bypass mode in a dedicated, resumed session (needs `devin auth login`).
 * Either way the agent follows AGENTS.md and narrates into the activity feed under the message's run.
 */

const MODE: ChatStatus['mode'] = process.env.NC_CHAT_MODE === 'cli' ? 'cli' : 'relay'

const ROOT = path.resolve(import.meta.dirname, '..')
const STATE_DIR = path.join(ROOT, '.neurocraft')
const ACTIVITY = path.join(STATE_DIR, ACTIVITY_FILE)
const SESSION_FILE = path.join(STATE_DIR, 'chat-session.json')

let child: ChildProcess | null = null
let current: ChatStatus = { mode: MODE, busy: false, sessionId: readSession() }
let onStatus: (s: ChatStatus) => void = () => {}

function readSession(): string | undefined {
  try {
    return (JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) as { id?: string }).id
  } catch {
    return undefined
  }
}

function append(e: Omit<ActivityEvent, 'ts' | 'run'> & { runTitle: string }) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.appendFileSync(ACTIVITY, JSON.stringify({ ts: Date.now(), run: `req:${e.runTitle}`, ...e }) + '\n')
}

function setStatus(s: Omit<ChatStatus, 'mode'>) {
  current = { ...s, mode: MODE }
  onStatus(current)
}

export const chatStatus = (): ChatStatus =>
  MODE === 'relay' ? { mode: MODE, busy: false, pending: pendingMessages().length, listener: listenerState().state, run: listenerState().run } : current

const makeTitle = (message: string) =>
  `${message.replace(/\s+/g, ' ').trim().slice(0, 70)} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`

function relaySend(message: string) {
  const title = makeTitle(message)
  append({ runTitle: title, source: 'user', status: 'start', message })
  enqueue(message, title)
  const state = listenerState().state
  if (state !== 'listening')
    append({
      runTitle: title,
      source: 'pipeline',
      status: 'info',
      message:
        state === 'working'
          ? 'Queued: Devin will pick this up after the current task.'
          : 'Queued. Devin is not listening right now; it will pick this up when you ask it (in the Devin chat) to check the inbox.',
    })
  onStatus(chatStatus())
  return { ok: true }
}
export const onChatStatus = (fn: (s: ChatStatus) => void) => (onStatus = fn)

function listSessions(): Promise<string[]> {
  return new Promise((resolve) =>
    execFile('devin', ['list', '--format', 'json'], { cwd: ROOT, windowsHide: true }, (err, stdout) => {
      if (err) return resolve([])
      try {
        resolve((JSON.parse(stdout) as { id: string }[]).map((s) => s.id))
      } catch {
        resolve([])
      }
    }),
  )
}

function buildPrompt(message: string, title: string) {
  return [
    '[NeuroCraft in-page chat] The user typed this in the browser while watching the 3D world live:',
    '"""',
    message,
    '"""',
    'Act on it following AGENTS.md. The user is watching the Activity panel, so make every step visible:',
    `- Pass --run "${title}" to every \`npm run -s nc\` command.`,
    `- Narrate each decision first: npm run -s nc -- log --run "${title}" "<what you are doing and why>"`,
    `- When finished: npm run -s nc -- log --run "${title}" --done "<one-line summary of what changed>"`,
    'Keep your final reply to 1-3 short sentences.',
  ].join('\n')
}

export async function sendChat(message: string): Promise<{ ok: boolean; error?: string }> {
  if (MODE === 'relay') return relaySend(message)
  if (current.busy) return { ok: false, error: 'Devin is still working on the previous message' }
  const title = makeTitle(message)
  const resume = current.sessionId
  const before = resume ? [] : await listSessions()

  append({ runTitle: title, source: 'user', status: 'start', message })
  setStatus({ busy: true, run: title, sessionId: resume })

  const args = ['-p', buildPrompt(message, title), '--permission-mode', 'dangerous', '--respect-workspace-trust', 'false', ...(resume ? ['-r', resume] : [])]
  const proc = spawn('devin', args, { cwd: ROOT, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } })
  child = proc
  let out = ''
  let err = ''
  proc.stdout.on('data', (d) => (out += d))
  proc.stderr.on('data', (d) => (err += d))

  proc.on('close', async (code, signal) => {
    child = null
    let sessionId = resume
    if (!resume) {
      const after = await listSessions()
      sessionId = after.find((id) => !before.includes(id))
      if (sessionId) fs.writeFileSync(SESSION_FILE, JSON.stringify({ id: sessionId }, null, 2))
    }
    const reply = out.replace(/\x1b\[[0-9;]*m/g, '').trim()
    if (signal || code === null) append({ runTitle: title, source: 'agent', status: 'error', message: 'Stopped by you' })
    else if (code !== 0) {
      const detail = (err || reply).trim()
      const hint = /not logged in/i.test(detail) ? ' Run `devin auth login` in a terminal, then try again.' : ''
      append({ runTitle: title, source: 'agent', status: 'error', message: `Devin exited with code ${code}.${hint}`, detail: detail.slice(-1500) })
    } else append({ runTitle: title, source: 'agent', status: 'done', message: reply || '(no reply)' })
    setStatus({ busy: false, sessionId })
  })
  proc.on('error', (e) => {
    child = null
    append({ runTitle: title, source: 'agent', status: 'error', message: `Could not start devin: ${e.message}` })
    setStatus({ busy: false, sessionId: resume })
  })
  return { ok: true }
}

export function cancelChat() {
  if (MODE === 'relay') {
    const pending = pendingMessages()
    for (const m of pending) append({ runTitle: m.run, source: 'pipeline', status: 'error', message: 'Removed from the queue before Devin picked it up' })
    if (pending.length) ack(pending[pending.length - 1].id)
    onStatus(chatStatus())
    return pending.length > 0
  }
  if (!child?.pid) return false
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
  else child.kill('SIGTERM')
  return true
}

export function resetChat() {
  if (MODE === 'relay' || current.busy) return false
  fs.rmSync(SESSION_FILE, { force: true })
  setStatus({ busy: false })
  return true
}
