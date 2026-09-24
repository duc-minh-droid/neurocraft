import path from 'node:path'
import type { AssetMeta } from '../../shared/meta.ts'
import { STATE_DIR, readJson } from '../util.ts'
import { uniqueId, writeWorldFile } from '../world.ts'

export async function resolveAt(at?: string): Promise<[number, number]> {
  if (at) {
    const [x, z] = at.split(',').map(Number)
    if (Number.isFinite(x) && Number.isFinite(z)) return [x, z]
    throw new Error(`Invalid --at "${at}", expected x,z`)
  }
  const cursor = await readJson<{ x: number; z: number }>(path.join(STATE_DIR, 'cursor.json'))
  return cursor ? [round(cursor.x), round(cursor.z)] : [0, 0]
}

const round = (n: number) => Math.round(n * 10) / 10

/** Adds (or with force, replaces) a world.json object for the asset. Returns the object id. */
export async function spawn(meta: AssetMeta, opts: { name?: string; at: [number, number]; force?: boolean }) {
  let id = opts.name ?? meta.id
  writeWorldFile((w) => {
    const existing = w.objects.findIndex((o) => o.id === id)
    if (existing >= 0 && opts.force) w.objects.splice(existing, 1)
    else if (existing >= 0) id = uniqueId(w, id)
    w.objects.push({ id, asset: meta.id, label: meta.prompt, at: opts.at, height: meta.defaultHeight })
  })
  return id
}
