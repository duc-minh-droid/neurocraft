import fs from 'node:fs'
import path from 'node:path'
import type { WorldObject, WorldState } from '../shared/world.ts'

/**
 * Server-side world store: world.json is the source of truth. Every change goes through commit(),
 * which keeps an undo history, writes the file and notifies listeners (the dev server pushes it to pages).
 */

const FILE = process.env.NC_WORLD_FILE ?? path.resolve(import.meta.dirname, '..', 'world.json')
const HISTORY_LIMIT = 50

let state: WorldState | null = null
const history: { state: WorldState; label: string }[] = []
const listeners = new Set<(w: WorldState) => void>()

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function read(): WorldState {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as WorldState
  } catch {
    return { version: 1, time: 'day', objects: [] }
  }
}

export function getWorld(): WorldState {
  state ??= read()
  return state
}

export function onWorldChange(fn: (w: WorldState) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function publish(next: WorldState) {
  state = next
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n')
  lastWritten = fs.readFileSync(FILE, 'utf8')
  listeners.forEach((l) => l(next))
}

let lastWritten = ''

/** Apply a mutation to a copy of the world, record undo history, persist and broadcast. */
export function commit(label: string, mutate: (w: WorldState) => void): WorldState {
  const prev = getWorld()
  const next = clone(prev)
  mutate(next)
  history.push({ state: prev, label })
  if (history.length > HISTORY_LIMIT) history.shift()
  publish(next)
  return next
}

/** Reverts the last change. Returns its label, or null if there is nothing to undo. */
export function undo(): string | null {
  const last = history.pop()
  if (!last) return null
  publish(last.state)
  return last.label
}

/** Picks up hand edits to world.json (or edits by the CLI) made outside this process. */
export function watchWorldFile() {
  const onChange = () => {
    const text = fs.readFileSync(FILE, 'utf8')
    if (text === lastWritten) return
    try {
      const next = JSON.parse(text) as WorldState
      if (state) history.push({ state, label: 'external edit' })
      lastWritten = text
      state = next
      listeners.forEach((l) => l(next))
    } catch {
      /* ignore half-written files */
    }
  }
  fs.watchFile(FILE, { interval: 300 }, onChange)
  return () => fs.unwatchFile(FILE, onChange)
}

export const findObject = (w: WorldState, id: string): WorldObject | undefined =>
  w.objects.find((o) => o.id === id) ?? w.objects.find((o) => o.id.toLowerCase() === id.toLowerCase())

/** A unique, kebab-case object id derived from a base name. */
export function uniqueId(w: WorldState, base: string): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'object'
  if (!w.objects.some((o) => o.id === slug)) return slug
  for (let i = 2; ; i++) if (!w.objects.some((o) => o.id === `${slug}-${i}`)) return `${slug}-${i}`
}

/** Writes world.json directly (for the CLI, which runs outside the dev server; the server's file watcher picks it up). */
export function writeWorldFile(mutate: (w: WorldState) => void) {
  const w = read()
  mutate(w)
  fs.writeFileSync(FILE, JSON.stringify(w, null, 2) + '\n')
  return w
}
