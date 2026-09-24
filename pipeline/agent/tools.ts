import { z } from 'zod'
import { KINDS } from '../../shared/meta.ts'
import { BEHAVIORS, TIMES_OF_DAY, type WorldObject, type WorldState } from '../../shared/world.ts'
import type { ToolSpec } from '../llm.ts'
import { PROFILES } from '../profiles.ts'
import { commit, findObject, getWorld, undo, uniqueId } from '../world.ts'
import { enqueue, listenerState } from '../inbox.ts'
import { acquireAsset } from './assets.ts'
import { cursor, footprint, library, objectForEntity, sceneReport, selection } from './context.ts'

const behavior = z
  .object({
    type: z.enum(BEHAVIORS),
    radius: z.number().positive().max(200).optional().describe('path or roaming radius in meters'),
    altitude: z.number().min(0).max(150).optional().describe('fly: meters above ground'),
    depth: z.number().min(0).max(20).optional().describe('swim: meters below water'),
    speed: z.number().positive().max(60).optional().describe('m/s for paths and wander; rad/s for spin'),
    path: z.enum(['circle', 'figure8']).optional(),
  })
  .describe('How the object moves. none = stands still')

const place = z
  .string()
  .optional()
  .describe('Where: "here" (double-clicked point), "it" (selected object), an object id to go next to, or "x,z" coordinates. Omit = where the camera looks')

const boneFx = z.object({
  type: z.enum(['flap', 'wiggle', 'spinNodes']),
  match: z.string().describe('regex over bone/node names, e.g. "wing", "tail", "wheel"'),
  amplitude: z.number().optional(),
  frequency: z.number().optional(),
  speed: z.number().optional(),
  axis: z.enum(['x', 'y', 'z']).optional(),
})

export const schemas = {
  add_object: z.object({
    query: z.string().describe('what to find/create, as a short noun phrase: "wolf", "stone castle", "red sports car"'),
    kind: z.enum(KINDS),
    count: z.number().int().min(1).max(200).optional(),
    near: place,
    height: z.number().positive().max(300).optional().describe('real-world height in meters (wolf 0.9, human 1.8, house 7, tree 8)'),
    tint: z.string().optional().describe('css color to tint it'),
    behavior: behavior.optional(),
  }),
  update_object: z.object({
    id: z.string().describe('object id, or "it"'),
    height: z.number().positive().max(300).optional().describe('new height in meters'),
    scale_factor: z.number().positive().max(50).optional().describe('multiply current size, e.g. 2 = twice as big'),
    tint: z.string().nullable().optional().describe('css color, or null to remove tint'),
    rotation: z.number().optional().describe('yaw in degrees'),
    clip: z.string().nullable().optional().describe('animation clip name from "clips available"'),
    anim_speed: z.number().positive().max(5).optional(),
    count: z.number().int().min(1).max(200).optional().describe('total number of copies'),
    behavior: behavior.optional(),
    bones: z.array(boneFx).optional().describe('procedural wing flapping / tail wiggling / wheel spinning'),
    around: z.string().optional().describe('object id to center this object on, e.g. to fly/circle around or above it'),
    label: z.string().optional(),
  }),
  move_object: z.object({ id: z.string(), to: z.string().describe('"here", "it", an object id to move next to, or "x,z"') }),
  remove_object: z.object({ id: z.string(), count: z.number().int().min(1).optional().describe('remove only this many copies') }),
  set_time: z.object({ time: z.enum(TIMES_OF_DAY) }),
  focus_camera: z.object({ id: z.string() }),
  undo: z.object({ steps: z.number().int().min(1).max(10).optional() }),
  ask_devin: z.object({ request: z.string().describe('the request, rephrased as a clear task for a coding agent') }),
}

export type ToolName = keyof typeof schemas

const DESCRIPTIONS: Record<ToolName, string> = {
  add_object: 'Find or create a 3D model and place it in the world. Reuses already-downloaded assets automatically.',
  update_object: 'Change an existing object: size, color, animation, number of copies, movement behavior, bone effects.',
  move_object: 'Move an object to another place.',
  remove_object: 'Delete an object (or some of its copies).',
  set_time: 'Change the time of day / lighting mood.',
  focus_camera: 'Point the camera at an object.',
  undo: 'Undo the last change(s) to the world.',
  ask_devin: 'Only for requests the other tools cannot express (new kinds of behavior, custom interactions, new UI). Hands the task to a coding agent.',
}

export const toolSpecs: ToolSpec[] = (Object.keys(schemas) as ToolName[]).map((name) => {
  const { $schema: _, ...parameters } = z.toJSONSchema(schemas[name]) as Record<string, unknown>
  return { type: 'function', function: { name, description: DESCRIPTIONS[name], parameters } }
})

export interface ToolResult {
  /** Returned to the LLM. */
  result: string
  /** Shown in the activity panel. */
  summary: string
  focus?: string
}

function resolveId(w: WorldState, id: string): WorldObject {
  if (/^(it|this|that)$/i.test(id)) {
    const s = selection()
    const owner = s && objectForEntity(w, s.id)
    if (owner) return owner
    throw new Error('nothing is selected; ask the user to double-click the object, or name it')
  }
  const o = findObject(w, id) ?? objectForEntity(w, id)
  if (!o) throw new Error(`no object "${id}". Existing ids: ${w.objects.map((x) => x.id).join(', ')}`)
  return o
}

/** Area an object occupies: its footprint plus the loop it moves along or the patch it is scattered over. */
function occupied(o: WorldObject): number {
  const path = o.behavior && ['drive', 'swim', 'wander'].includes(o.behavior.type) ? (o.behavior.radius ?? 15) : 0
  const scatter = (o.count ?? 1) > 1 ? (o.scatter?.radius ?? 6) : 0
  return footprint(o) + Math.max(path, scatter)
}

/** Nearest spot to `p` (spiralling outwards) that doesn't overlap other objects. Ground cover (many copies) is ignored. */
function freeSpot(w: WorldState, p: [number, number], selfRadius: number, ignore?: string): [number, number] {
  const blockers = w.objects.filter((o) => o.id !== ignore && (o.count ?? 1) <= 20)
  const clear = (x: number, z: number) => blockers.every((o) => Math.hypot(o.at[0] - x, o.at[1] - z) > occupied(o) + selfRadius + 1)
  for (let r = 0; r <= 60; r += 3) {
    for (let a = 0; a < 16; a++) {
      const x = p[0] + Math.cos((a / 16) * Math.PI * 2) * r
      const z = p[1] + Math.sin((a / 16) * Math.PI * 2) * r
      if (clear(x, z)) return [round(x), round(z)]
      if (r === 0) break
    }
  }
  return p
}

/** Turns a place spec into ground coordinates. Explicit coordinates are exact; everything else avoids overlaps. */
function resolvePlace(w: WorldState, spec: string | undefined, selfRadius: number, self?: string): [number, number] {
  const cam = sceneReport().camera
  const right = cam ? normalize([cam.target[2] - cam.position[2], -(cam.target[0] - cam.position[0])]) : ([1, 0] as [number, number])
  const coords = spec?.match(/^\s*\[?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]?\s*$/)
  if (coords) return [Number(coords[1]), Number(coords[2])]
  if (spec && /^here$/i.test(spec)) {
    const c = cursor()
    if (c) return [round(c.x), round(c.z)]
  }
  if (spec && !/^here$/i.test(spec)) {
    const ref = resolveId(w, spec)
    const gap = footprint(ref) + selfRadius + 2
    return freeSpot(w, [round(ref.at[0] + right[0] * gap), round(ref.at[1] + right[1] * gap)], selfRadius, self)
  }
  return freeSpot(w, cam ? [round(cam.target[0]), round(cam.target[2])] : [0, 0], selfRadius, self)
}

const round = (n: number) => Math.round(n * 10) / 10
function normalize([x, z]: [number, number]): [number, number] {
  const l = Math.hypot(x, z) || 1
  return [x / l, z / l]
}

const metaFor = (asset: string) => library().find((m) => m.id === asset)

export async function runTool(name: ToolName, rawArgs: unknown): Promise<ToolResult> {
  switch (name) {
    case 'add_object': {
      const a = schemas.add_object.parse(rawArgs)
      const height = a.height ?? PROFILES[a.kind].defaultHeight
      const wantsMotion = a.kind === 'creature' || a.kind === 'character'
      const { meta, reused } = await acquireAsset(a.query, a.kind, { height, wantsMotion })
      const at = resolvePlace(getWorld(), a.near, height * 0.6)
      let id = ''
      commit(`add ${a.query}`, (w) => {
        id = uniqueId(w, a.query)
        const count = a.count ?? 1
        w.objects.push({
          id,
          asset: meta.id,
          label: a.query,
          at,
          height,
          ...(a.tint ? { tint: a.tint } : {}),
          ...(count > 1 ? { count, scatter: { radius: Math.max(4, Math.sqrt(count) * height * 1.5), spacing: height * 0.8 } } : {}),
          ...(a.behavior && a.behavior.type !== 'none' ? { behavior: a.behavior } : {}),
        })
      })
      const clips = meta.clips.length ? ` It has animations: ${meta.clips.join(', ')}.` : ''
      return {
        result: `Added "${id}" (asset ${meta.id}${reused ? ', reused' : ''}) at [${at}], ${height} m tall.${clips}`,
        summary: `Added ${a.count && a.count > 1 ? `${a.count}× ` : ''}${a.query}`,
        focus: id,
      }
    }
    case 'update_object': {
      const a = schemas.update_object.parse(rawArgs)
      const target = resolveId(getWorld(), a.id)
      const clips = metaFor(target.asset)?.clips ?? []
      if (a.clip) {
        const match = clips.find((c) => c.toLowerCase() === a.clip!.toLowerCase()) ?? clips.find((c) => c.toLowerCase().includes(a.clip!.toLowerCase()))
        if (!match) throw new Error(clips.length ? `no clip "${a.clip}"; available: ${clips.join(', ')}` : `${target.id} has no animations; it can move around (behavior) but its body won't animate. Omit clip.`)
        a.clip = match
      }
      const changes: string[] = []
      commit(`update ${target.id}`, (w) => {
        const o = w.objects.find((x) => x.id === target.id)!
        const baseHeight = o.height ?? metaFor(o.asset)?.defaultHeight ?? 2
        if (a.scale_factor) (o.height = round(baseHeight * a.scale_factor)), changes.push(`${a.scale_factor}× size`)
        if (a.height) (o.height = a.height), changes.push(`${a.height} m tall`)
        if (a.tint !== undefined) a.tint === null ? delete o.tint : (o.tint = a.tint), changes.push(a.tint ? `tinted ${a.tint}` : 'original colors')
        if (a.rotation !== undefined) (o.rotation = a.rotation), changes.push(`turned to ${a.rotation}°`)
        if (a.clip !== undefined) (o.clip = a.clip), changes.push(a.clip ? `playing "${a.clip}"` : 'animation off')
        if (a.anim_speed) (o.animSpeed = a.anim_speed), changes.push(`animation ${a.anim_speed}×`)
        if (a.count) {
          o.count = a.count
          if (a.count > 1 && !o.scatter) o.scatter = { radius: Math.max(4, Math.sqrt(a.count) * baseHeight * 1.5), spacing: baseHeight * 0.8 }
          changes.push(`${a.count} copies`)
        }
        if (a.behavior) (a.behavior.type === 'none' ? delete o.behavior : (o.behavior = a.behavior)), changes.push(a.behavior.type === 'none' ? 'standing still' : `${a.behavior.type}ing`)
        if (a.bones) (o.bones = a.bones), changes.push(a.bones.map((b) => `${b.type} ${b.match}`).join(', '))
        if (a.around) {
          const ref = resolveId(w, a.around)
          o.at = [...ref.at]
          changes.push(`centered on ${ref.label ?? ref.id}`)
        }
        if (a.label) o.label = a.label
      })
      return { result: `Updated ${target.id}: ${changes.join(', ') || 'no changes'}`, summary: `${target.label ?? target.id}: ${changes.join(', ') || 'no changes'}`, focus: target.id }
    }
    case 'move_object': {
      const a = schemas.move_object.parse(rawArgs)
      const w = getWorld()
      const target = resolveId(w, a.id)
      const at = resolvePlace(w, a.to, footprint(target), target.id)
      commit(`move ${target.id}`, (next) => {
        next.objects.find((x) => x.id === target.id)!.at = at
      })
      return { result: `Moved ${target.id} to [${at}]`, summary: `Moved ${target.label ?? target.id}`, focus: target.id }
    }
    case 'remove_object': {
      const a = schemas.remove_object.parse(rawArgs)
      const target = resolveId(getWorld(), a.id)
      const left = a.count ? Math.max(0, (target.count ?? 1) - a.count) : 0
      commit(`remove ${target.id}`, (w) => {
        if (left > 0) w.objects.find((x) => x.id === target.id)!.count = left
        else w.objects = w.objects.filter((x) => x.id !== target.id)
      })
      return { result: left > 0 ? `${target.id} now has ${left} copies` : `Removed ${target.id}`, summary: left > 0 ? `${target.label ?? target.id}: ${left} left` : `Removed ${target.label ?? target.id}` }
    }
    case 'set_time': {
      const a = schemas.set_time.parse(rawArgs)
      commit(`time ${a.time}`, (w) => {
        w.time = a.time
      })
      return { result: `Time of day is now ${a.time}`, summary: `Light: ${a.time}` }
    }
    case 'focus_camera': {
      const a = schemas.focus_camera.parse(rawArgs)
      const target = resolveId(getWorld(), a.id)
      return { result: `Camera on ${target.id}`, summary: `Looking at ${target.label ?? target.id}`, focus: target.id }
    }
    case 'undo': {
      const a = schemas.undo.parse(rawArgs)
      const undone: string[] = []
      for (let i = 0; i < (a.steps ?? 1); i++) {
        const label = undo()
        if (!label) break
        undone.push(label)
      }
      return { result: undone.length ? `Undid: ${undone.join('; ')}` : 'Nothing to undo', summary: undone.length ? `Undid ${undone.join(', ')}` : 'Nothing to undo' }
    }
    case 'ask_devin': {
      const a = schemas.ask_devin.parse(rawArgs)
      const title = `${a.request.slice(0, 70)} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      enqueue(a.request, title)
      const listening = listenerState().state !== 'offline'
      return {
        result: listening ? 'Handed to Devin, who is working on it.' : 'Queued for Devin; it will be picked up when Devin checks the inbox.',
        summary: listening ? 'Handed to Devin (needs new code)' : 'Queued for Devin (needs new code)',
      }
    }
  }
}
