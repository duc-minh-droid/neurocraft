export type ActivityStatus = 'start' | 'progress' | 'done' | 'error' | 'info'
export type ActivitySource = 'pipeline' | 'agent' | 'editor' | 'user'

export interface ActivityImage {
  /** Absolute http(s) URL, or a file name inside the preview dir served at /__nc/preview/<file>. */
  url: string
  caption?: string
}

export interface ActivityEvent {
  ts: number
  source: ActivitySource
  /** Groups events of one command/request. */
  run: string
  /** Set on the run's first event. */
  runTitle?: string
  /** Events with the same step key update one row; omitted = standalone line. */
  step?: string
  status: ActivityStatus
  message: string
  /** 0..100 */
  progress?: number
  /** Preformatted detail, e.g. a code diff ("+ added" / "- removed" lines). */
  detail?: string
  /** Live pages glide the camera to this entity id (or asset id) when the event arrives. */
  focus?: string
  images?: ActivityImage[]
}

export const ACTIVITY_FILE = 'activity.jsonl'
export const ACTIVITY_EVENT = 'nc:activity'
export const CHAT_EVENT = 'nc:chat'

export interface ChatStatus {
  /** relay = messages go to the Devin chat that is listening via `nc inbox --wait`; cli = spawn `devin -p`. */
  mode: 'relay' | 'cli'
  busy: boolean
  /** Title of the run the in-page agent is working on. */
  run?: string
  sessionId?: string
  /** relay: messages not yet picked up. */
  pending?: number
  /** relay: listening = blocked on `nc inbox --wait`; working = handling a picked-up message; offline = neither. */
  listener?: ListenerState
}

export type ListenerState = 'listening' | 'working' | 'offline'

export interface InboxMessage {
  id: number
  ts: number
  message: string
  /** Run title to pass as --run so the work lands in the message's activity card. */
  run: string
}

export const INBOX_FILE = 'inbox.jsonl'
export const INBOX_ACK_FILE = 'inbox-ack.json'
export const LISTENER_FILE = 'listener.json'
/** A 'listening' heartbeat older than this means nobody is listening. */
export const LISTENER_STALE_MS = 8000
/** A 'working' marker older than this is treated as abandoned. */
export const WORKING_STALE_MS = 30 * 60_000
