import fs from 'node:fs'
import path from 'node:path'
import { ACTIVITY_FILE, type ActivityEvent, type ActivityImage, type ActivitySource } from '../shared/activity.ts'
import { STATE_DIR, log } from './util.ts'

/**
 * Append-only activity feed (.neurocraft/activity.jsonl). The Vite dev server tails it and streams events to the page.
 * Writes are synchronous so ordering is preserved and nothing is lost if the process exits on error.
 */

const FILE = path.join(STATE_DIR, ACTIVITY_FILE)
let run = { id: `run-${Date.now()}`, title: '', shared: false }
let stepSeq = 0

export function emit(e: Omit<ActivityEvent, 'ts' | 'run' | 'source'> & { source?: ActivitySource }) {
  const event: ActivityEvent = { ts: Date.now(), source: 'pipeline', run: run.id, runTitle: run.title, ...e }
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.appendFileSync(FILE, JSON.stringify(event) + '\n')
  } catch {
    /* activity is best-effort; never break the pipeline */
  }
}

/**
 * A run groups the steps of one request. A shared run (the user's request as title, via `--run`) lets several commands
 * and agent narration append to the same card; it stays open until `nc log --run <title> --done`.
 */
export function beginRun(title: string, opts: { shared?: boolean; message?: string; source?: ActivitySource } = {}) {
  run = { id: opts.shared ? `req:${title}` : `run-${Date.now()}-${process.pid}`, title, shared: !!opts.shared }
  if (!opts.shared) emit({ status: 'start', message: opts.message ?? title, source: opts.source })
}

/** Joins a run without emitting anything (used by `nc log`). */
export function useRun(title: string) {
  run = { id: `req:${title}`, title, shared: true }
}

export function endRun(ok: boolean, message: string) {
  if (run.shared && ok) return
  emit({ status: ok ? 'done' : 'error', message })
}

export function info(message: string, images?: ActivityImage[], source: ActivitySource = 'pipeline') {
  emit({ status: 'info', message, images, source })
}

export interface StepHandle {
  progress(pct: number, message?: string): void
  images(images: ActivityImage[], message?: string): void
  /** Replaces the message shown when the step completes. */
  done(message: string): void
  /** Live pages glide the camera to this entity when the step completes. */
  focus(entityId: string): void
}

export async function step<T>(name: string, message: string, fn: (s: StepHandle) => Promise<T>): Promise<T> {
  const key = `${process.pid}:${++stepSeq}:${name}`
  const start = Date.now()
  let doneMessage = message
  let focus: string | undefined
  let lastPct = -1
  emit({ step: key, status: 'start', message })
  log(`▶ ${message}`)
  const handle: StepHandle = {
    progress(pct, msg) {
      if (pct === lastPct && !msg) return
      lastPct = pct
      emit({ step: key, status: 'progress', progress: pct, message: msg ?? message })
    },
    images(images, msg) {
      emit({ step: key, status: 'progress', images, message: msg ?? message })
    },
    done(msg) {
      doneMessage = msg
    },
    focus(id) {
      focus = id
    },
  }
  try {
    const result = await fn(handle)
    const secs = ((Date.now() - start) / 1000).toFixed(1)
    emit({ step: key, status: 'done', message: `${doneMessage} (${secs}s)`, focus })
    log(`✓ ${doneMessage} (${secs}s)`)
    return result
  } catch (e) {
    emit({ step: key, status: 'error', message: `${message}: ${e instanceof Error ? e.message : e}` })
    throw e
  }
}
