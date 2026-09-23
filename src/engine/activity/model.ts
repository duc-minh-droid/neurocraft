import type { ActivityEvent, ActivityImage, ActivitySource, ActivityStatus } from '../../../shared/activity'

export interface Row {
  key: string
  /** Tracked pipeline step (spinner → ✓/✕), as opposed to a one-off line. */
  isStep: boolean
  source: ActivitySource
  status: ActivityStatus
  message: string
  progress?: number
  images?: ActivityImage[]
  detail?: string
  start: number
  end?: number
}

export interface Run {
  id: string
  title: string
  status: 'running' | 'done' | 'error'
  start: number
  end?: number
  rows: Row[]
}

const MAX_RUNS = 40

/** Folds an activity event into the run list (newest run first). Returns a new array when anything changed. */
export function applyEvent(runs: Run[], e: ActivityEvent): Run[] {
  const idx = runs.findIndex((r) => r.id === e.run)
  const startsWork = e.status === 'start' || e.status === 'progress'
  const run: Run =
    idx >= 0
      ? { ...runs[idx], rows: [...runs[idx].rows] }
      : { id: e.run, title: e.runTitle ?? e.run, status: startsWork ? 'running' : 'done', start: e.ts, rows: [] }
  if (e.runTitle) run.title = e.runTitle

  if (e.step) {
    const i = run.rows.findIndex((r) => r.key === e.step)
    const prev: Row = i >= 0 ? run.rows[i] : { key: e.step, isStep: true, source: e.source, status: e.status, message: e.message, start: e.ts }
    const row: Row = {
      ...prev,
      status: e.status === 'progress' ? 'start' : e.status,
      message: e.message,
      progress: e.progress ?? prev.progress,
      images: e.images ?? prev.images,
      detail: e.detail ?? prev.detail,
      end: e.status === 'done' || e.status === 'error' ? e.ts : undefined,
    }
    if (i >= 0) run.rows[i] = row
    else run.rows.push(row)
    if (e.status === 'error') run.status = 'error'
    else if (e.status === 'start' && run.status !== 'error') (run.status = 'running'), (run.end = undefined)
  } else {
    run.rows.push({
      key: `${e.ts}-${run.rows.length}`,
      isStep: false,
      source: e.source,
      status: e.status === 'start' || e.status === 'progress' ? 'info' : e.status,
      message: e.message,
      images: e.images,
      detail: e.detail,
      start: e.ts,
      end: e.ts,
    })
    if (e.status === 'start') (run.status = 'running'), (run.end = undefined)
    if (e.status === 'done' || e.status === 'error') (run.status = e.status), (run.end = e.ts)
  }

  const rest = idx >= 0 ? runs.filter((_, i) => i !== idx) : runs
  return [run, ...rest].sort((a, b) => lastTs(b) - lastTs(a)).slice(0, MAX_RUNS)
}

export const lastTs = (r: Run) => Math.max(r.start, ...r.rows.map((row) => row.end ?? row.start))

/** A run still marked running but silent this long is treated as abandoned (e.g. the process was killed). */
const STALE_MS = 10 * 60_000

/** The run that is actually in progress right now, if any. */
export const currentRun = (runs: Run[], now: number) => runs.find((r) => r.status === 'running' && now - lastTs(r) < STALE_MS)

export const imageSrc = (url: string) => (/^https?:/.test(url) ? url : `/__nc/preview/${url}`)

export function elapsed(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
