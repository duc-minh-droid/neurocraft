import fs from 'node:fs'
import path from 'node:path'
import {
  INBOX_ACK_FILE,
  INBOX_FILE,
  LISTENER_FILE,
  LISTENER_STALE_MS,
  WORKING_STALE_MS,
  type InboxMessage,
  type ListenerState,
} from '../shared/activity.ts'

/**
 * Relay queue between the page's text box and a Devin chat that listens with `nc inbox --wait`.
 * inbox.jsonl is append-only; inbox-ack.json holds the last handled id; listener.json is the listener's heartbeat.
 */

const STATE_DIR = path.resolve(import.meta.dirname, '..', '.neurocraft')
const INBOX = path.join(STATE_DIR, INBOX_FILE)
const ACK = path.join(STATE_DIR, INBOX_ACK_FILE)
const LISTENER = path.join(STATE_DIR, LISTENER_FILE)

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

export function allMessages(): InboxMessage[] {
  try {
    return fs
      .readFileSync(INBOX, 'utf8')
      .split('\n')
      .flatMap((l) => {
        try {
          return l ? [JSON.parse(l) as InboxMessage] : []
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

export const lastAck = () => readJson<{ id: number }>(ACK)?.id ?? 0
export const pendingMessages = () => allMessages().filter((m) => m.id > lastAck())

export function ack(id: number) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  if (id > lastAck()) fs.writeFileSync(ACK, JSON.stringify({ id }))
}

export function enqueue(message: string, run: string): InboxMessage {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  const last = allMessages().at(-1)?.id ?? 0
  const m: InboxMessage = { id: Math.max(Date.now(), last + 1), ts: Date.now(), message, run }
  fs.appendFileSync(INBOX, JSON.stringify(m) + '\n')
  return m
}

interface Listener {
  ts: number
  state: 'listening' | 'working' | 'stopped'
  pid?: number
  run?: string
}

export function heartbeat(state: 'listening' | 'working', run?: string) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(LISTENER, JSON.stringify({ ts: Date.now(), state, pid: process.pid, run } satisfies Listener))
}

/** Marks listening as stopped; a still-running `inbox --wait` sees this and exits without taking messages. */
export function stopListening() {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(LISTENER, JSON.stringify({ ts: Date.now(), state: 'stopped' } satisfies Listener))
}

/** Called when a run is closed (`nc log --done/--error`): clears the 'working' marker if it belongs to that run. */
export function finishWork(run: string) {
  const hb = readJson<Listener>(LISTENER)
  if (hb?.state === 'working' && hb.run === run) stopListening()
}

/** True when this waiter should give up: listening was stopped, or a newer waiter took over. */
export function superseded(): boolean {
  const hb = readJson<Listener>(LISTENER)
  return !!hb && (hb.state === 'stopped' || (hb.pid !== undefined && hb.pid !== process.pid))
}

export function listenerState(): { state: ListenerState; run?: string } {
  const hb = readJson<Listener>(LISTENER)
  const age = hb ? Date.now() - hb.ts : Infinity
  if (hb?.state === 'listening' && age < LISTENER_STALE_MS) return { state: 'listening' }
  if (hb?.state === 'working' && age < WORKING_STALE_MS) return { state: 'working', run: hb.run }
  return { state: 'offline' }
}
