import fs from 'node:fs'
import path from 'node:path'
import type { AssetMeta } from '../../shared/meta.ts'
import type { WorldObject, WorldState } from '../../shared/world.ts'
import { heightAt, WATER_LEVEL } from '../../src/world/heightfield.ts'
import { ASSETS_DIR, STATE_DIR } from '../util.ts'

/** What the page last reported (via the dev plugin): live entity positions/sizes, camera, "here" and "it". */
interface SceneReport {
  entities?: { id: string; asset: string; position: [number, number, number]; size: [number, number, number] }[]
  camera?: { position: [number, number, number]; target: [number, number, number] }
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

export const sceneReport = () => readJson<SceneReport>(path.join(STATE_DIR, 'scene.json')) ?? {}
export const cursor = () => readJson<{ x: number; z: number; at?: string }>(path.join(STATE_DIR, 'cursor.json'))
export const selection = () => readJson<{ id: string; asset: string }>(path.join(STATE_DIR, 'selection.json'))

export function library(): AssetMeta[] {
  if (!fs.existsSync(ASSETS_DIR)) return []
  return fs.readdirSync(ASSETS_DIR).flatMap((id) => {
    const m = readJson<AssetMeta>(path.join(ASSETS_DIR, id, 'meta.json'))
    return m ? [m] : []
  })
}

/** World object that owns an entity id ("man-3" → "man"). */
export function objectForEntity(w: WorldState, entityId: string): WorldObject | undefined {
  return w.objects.find((o) => o.id === entityId) ?? w.objects.find((o) => entityId.startsWith(`${o.id}-`))
}

/** Approximate footprint radius of an object in meters, from the live scene report or its height. */
export function footprint(o: WorldObject): number {
  const e = sceneReport().entities?.find((x) => x.id === o.id || x.id === `${o.id}-1`)
  if (e) return Math.max(e.size[0], e.size[2]) / 2
  return (o.height ?? 2) * 0.6
}

const r1 = (n: number) => Math.round(n * 10) / 10

function describe(o: WorldObject, meta?: AssetMeta) {
  const parts = [`${o.id}: ${o.label ?? o.asset}`, `asset=${o.asset}`, `at=[${o.at.map(r1).join(',')}]`, `height=${o.height ?? meta?.defaultHeight ?? '?'}m`]
  if (o.count && o.count > 1) parts.push(`count=${o.count}`)
  if (o.scale && o.scale !== 1) parts.push(`scale=${o.scale}`)
  if (o.tint) parts.push(`tint=${o.tint}`)
  if (o.clip !== undefined) parts.push(`clip=${o.clip}`)
  if (o.behavior && o.behavior.type !== 'none') parts.push(`behavior=${JSON.stringify(o.behavior)}`)
  if (meta?.clips.length) parts.push(`clips available: ${meta.clips.join('/')}`)
  if (meta?.kind) parts.push(`kind=${meta.kind}`)
  return parts.join(' · ')
}

/** Compact scene summary for the system prompt. */
export function describeScene(w: WorldState): string {
  const metas = new Map(library().map((m) => [m.id, m]))
  const lines = [`time of day: ${w.time}`, 'objects:', ...w.objects.map((o) => `- ${describe(o, metas.get(o.asset))}`)]
  const unused = [...metas.values()].filter((m) => !w.objects.some((o) => o.asset === m.id))
  if (unused.length) lines.push(`downloaded assets not placed yet (reusable instantly): ${unused.map((m) => `${m.id} (${m.prompt}, ${m.kind})`).join('; ')}`)
  const c = cursor()
  if (c) lines.push(`"here" (last double-clicked ground point): [${r1(c.x)}, ${r1(c.z)}]`)
  const s = selection()
  if (s) {
    const owner = objectForEntity(w, s.id)
    lines.push(`"it"/"this" (last double-clicked object): ${owner ? owner.id : s.id}`)
  }
  const cam = sceneReport().camera
  if (cam) lines.push(`camera is looking at [${r1(cam.target[0])}, ${r1(cam.target[2])}]`)
  lines.push(`landmarks (use "x,z" as a place): ${landmarks()}`)
  return lines.join('\n')
}

let landmarkCache = ''
/** Hilltops and lakes from the terrain height function, so "on that hill" / "by the lake" resolve to coordinates. */
function landmarks(): string {
  if (landmarkCache) return landmarkCache
  const samples: { x: number; z: number; h: number }[] = []
  for (let x = -100; x <= 100; x += 5) for (let z = -100; z <= 100; z += 5) samples.push({ x, z, h: heightAt(x, z) })
  const isPeak = (p: (typeof samples)[number]) => samples.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 20 || q.h <= p.h)
  const hills = samples
    .filter((p) => p.h > 3 && Math.hypot(p.x, p.z) < 95 && isPeak(p))
    .sort((a, b) => b.h - a.h)
    .filter((p, i, arr) => arr.slice(0, i).every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 35))
    .slice(0, 5)
  const lakes = samples
    .filter((p) => p.h < WATER_LEVEL - 1.5)
    .filter((p, i, arr) => arr.slice(0, i).every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 40))
    .slice(0, 3)
  landmarkCache = [
    ...hills.map((p) => `hill top [${p.x},${p.z}] (${r1(p.h)} m high)`),
    ...lakes.map((p) => `lake around [${p.x},${p.z}]`),
    'mountains ring the world beyond ~130 m from the center',
  ].join('; ')
  return landmarkCache
}
