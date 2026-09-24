import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CHAT_EVENT, type ChatStatus } from '../../../shared/activity'

const post = (url: string, body?: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const LISTENER_UI = {
  listening: { color: '#3fb950', text: 'Devin is listening' },
  working: { color: '#58a6ff', text: 'Devin is working…' },
  offline: { color: '#7d8590', text: "Devin isn't listening, so messages will queue" },
} as const

/**
 * Bottom-center text bar. relay mode: queued for the Devin chat listening via `nc inbox --wait`;
 * cli mode: a spawned `devin -p` session. Progress streams into the Activity panel.
 */
export function ChatBar() {
  const [status, setStatus] = useState<ChatStatus>({ mode: 'relay', busy: false })
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const refresh = () =>
      fetch('/__nc/chat/status')
        .then((r) => r.json() as Promise<ChatStatus>)
        .then(setStatus)
        .catch(() => {})
    void refresh()
    const id = setInterval(refresh, 2000)
    import.meta.hot?.on(CHAT_EVENT, setStatus)
    return () => {
      clearInterval(id)
      import.meta.hot?.off(CHAT_EVENT, setStatus)
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const relay = status.mode === 'relay'
  const listener = LISTENER_UI[status.listener ?? 'offline']

  const send = async () => {
    const message = text.trim()
    if (!message || status.busy) return
    setError(null)
    const r = await post('/__nc/chat', { message }).catch(() => null)
    if (!r) return setError('Dev server unreachable')
    const body = (await r.json()) as { ok: boolean; error?: string }
    if (!body.ok) return setError(body.error ?? 'Failed to send')
    setText('')
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const statusText = error ?? (relay ? listener.text : status.busy ? 'Working…' : '')
  const showStatus = !!error || (relay ? status.listener !== 'offline' || !!status.pending : status.busy || !!status.pending)

  return (
    <div className="nc-chatbar nc-glass">
      <div className="nc-chatbar-row">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder='Describe anything, e.g. "a castle on the hill"'
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        {status.busy ? (
          <button className="nc-send stop" title="Stop" aria-label="Stop" onClick={() => void post('/__nc/chat/cancel')}>
            ■
          </button>
        ) : (
          <button className="nc-send" title="Send (Enter)" aria-label="Send" disabled={!text.trim()} onClick={() => void send()}>
            ↑
          </button>
        )}
      </div>
      <div className="nc-chatbar-status" style={showStatus ? undefined : { display: 'none' }}>
        <div className="nc-dot" style={{ background: error ? '#f85149' : relay ? listener.color : status.busy ? '#58a6ff' : '#3fb950' }} />
        <span className="nc-meta" style={{ flex: 1 }}>
          {statusText}
          {!!status.pending && ` · ${status.pending} queued`}
        </span>
        {relay && !!status.pending && (
          <button className="nc-link" title="Remove messages Devin hasn't picked up yet" onClick={() => void post('/__nc/chat/cancel')}>
            clear queue
          </button>
        )}
        {status.mode === 'cli' && status.sessionId && !status.busy && (
          <button className="nc-link" title="Start a fresh Devin session (forgets the conversation)" onClick={() => void post('/__nc/chat/reset')}>
            new chat
          </button>
        )}
      </div>
    </div>
  )
}
