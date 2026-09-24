import { useEffect, useRef, useState } from 'react'
import { ACTIVITY_EVENT, type ActivityEvent } from '../../../shared/activity'
import { focusEntity } from '../store'
import { applyEvent, currentRun, elapsed, imageSrc, type Row, type Run } from './model'

const ICON: Record<string, { ch: string; color: string }> = {
  done: { ch: '✓', color: '#3fb950' },
  error: { ch: '✕', color: '#f85149' },
  info: { ch: '•', color: '#7d8590' },
}

function StatusIcon({ row }: { row: Row }) {
  if (row.status === 'start') return <div className="nc-spin" />
  const i = ICON[row.status] ?? ICON.info
  return <span style={{ color: i.color, fontWeight: 700 }}>{i.ch}</span>
}

const SOURCE_LABEL = { agent: 'Devin', editor: 'code', pipeline: '', user: 'You' } as const

function RowView({ row, now }: { row: Row; now: number }) {
  const running = row.status === 'start'
  const [showCode, setShowCode] = useState(false)
  const diffLines = row.detail?.split('\n') ?? []
  return (
    <div className={`nc-row ${row.source}`}>
      <StatusIcon row={row} />
      <div>
        <div className="nc-msg">
          {SOURCE_LABEL[row.source] && <span className="nc-meta">{SOURCE_LABEL[row.source]} › </span>}
          {row.message}
          {running && <span className="nc-meta"> · {elapsed(now - row.start)}</span>}
        </div>
        {running && row.progress !== undefined && (
          <div className="nc-bar">
            <div style={{ width: `${row.progress}%` }} />
          </div>
        )}
        {row.images && row.images.length > 0 && (
          <div className="nc-imgs">
            {row.images.slice(0, 9).map((img, i) => (
              <img key={`${i}-${img.url}`} src={imageSrc(img.url)} title={img.caption} alt={img.caption ?? ''} loading="lazy" />
            ))}
          </div>
        )}
        {row.detail && (
          <button className="nc-link" onClick={() => setShowCode((v) => !v)}>
            {showCode ? 'hide code' : `show code (${diffLines.length} line${diffLines.length === 1 ? '' : 's'})`}
          </button>
        )}
        {row.detail && showCode && (
          <pre className="nc-diff">
            {diffLines.map((l, i) => (
              <div key={i} className={l.startsWith('+') ? 'a' : l.startsWith('-') ? 'd' : undefined}>
                {l}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  )
}

const RUN_COLOR = { running: '#58a6ff', done: '#3fb950', error: '#f85149' }

function RunView({ run, now, open, onToggle }: { run: Run; now: number; open: boolean; onToggle?: () => void }) {
  const steps = run.rows.filter((r) => r.isStep)
  const doneSteps = steps.filter((r) => r.status === 'done').length
  const end = run.end ?? (run.status === 'running' ? now : (run.rows.at(-1)?.end ?? now))
  return (
    <div className="nc-run">
      <div className="nc-run-head" onClick={onToggle} style={onToggle ? undefined : { cursor: 'default' }}>
        <div className="nc-dot" style={{ background: RUN_COLOR[run.status] }} />
        <div className="nc-run-title" title={run.title}>
          {run.title}
        </div>
        <span className="nc-meta">
          {steps.length > 0 && `${doneSteps}/${steps.length} · `}
          {elapsed(end - run.start)}
        </span>
      </div>
      {open && run.rows.map((row) => <RowView key={row.key} row={row} now={now} />)}
    </div>
  )
}

function useActivityRuns() {
  const [runs, setRuns] = useState<Run[]>([])
  useEffect(() => {
    let cancelled = false
    const seen = new Set<string>()
    const fresh = (events: ActivityEvent[]) =>
      events.filter((e) => {
        if (typeof e?.ts !== 'number' || typeof e.run !== 'string') return false
        const id = `${e.ts}|${e.run}|${e.step ?? ''}|${e.status}|${e.message}`
        return !seen.has(id) && !!seen.add(id)
      })
    const onEvents = (events: ActivityEvent[]) => {
      const next = fresh(events)
      if (next.length) setRuns((prev) => next.reduce(applyEvent, prev))
    }
    const onLive = (events: ActivityEvent[]) => {
      onEvents(events)
      const focus = [...events].reverse().find((e) => e.focus)?.focus
      if (focus) focusEntity(focus)
    }
    fetch('/__nc/activity')
      .then((r) => r.json() as Promise<ActivityEvent[]>)
      .then((events) => {
        if (cancelled) return
        onEvents(events)
        const recent = [...events].reverse().find((e) => e.focus && Date.now() - e.ts < 20_000)
        if (recent?.focus) focusEntity(recent.focus)
      })
      .catch(() => {})
    import.meta.hot?.on(ACTIVITY_EVENT, onLive)
    return () => {
      cancelled = true
      import.meta.hot?.off(ACTIVITY_EVENT, onLive)
    }
  }, [])
  return runs
}

/** Top-right panel: the ongoing process when there is one, otherwise the history of past requests. */
export function ActivityPanel() {
  const runs = useActivityRuns()
  const [collapsed, setCollapsed] = useState(false)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(() => Date.now())
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const current = currentRun(runs, now)
  const currentRows = current?.rows.length ?? 0
  useEffect(() => {
    if (current && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [current, currentRows])

  const isOpen = (run: Run) => toggled[run.id] ?? false

  return (
    <div className="nc-act nc-glass">
      <div className="nc-act-head" onClick={() => setCollapsed((c) => !c)}>
        <div className="nc-dot" style={{ background: current ? '#58a6ff' : '#3fb950' }} />
        <span style={{ flex: 1, fontWeight: 700 }}>{current ? 'Working' : 'Activity'}</span>
        <span className="nc-meta">{current ? elapsed(now - current.start) : `${runs.length} past`}</span>
        <span className="nc-meta">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div className="nc-act-body" ref={bodyRef}>
          {current ? (
            <>
              <div className="nc-section">Now</div>
              <RunView run={current} now={now} open />
            </>
          ) : runs.length === 0 ? (
            <div className="nc-empty">Nothing yet. Type in the bar below.</div>
          ) : (
            <>
              <div className="nc-section">History</div>
              {runs.map((run) => (
                <RunView key={run.id} run={run} now={now} open={isOpen(run)} onToggle={() => setToggled((t) => ({ ...t, [run.id]: !isOpen(run) }))} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
