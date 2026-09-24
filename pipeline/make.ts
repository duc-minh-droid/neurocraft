import fs from 'node:fs/promises'
import path from 'node:path'
import type { Document } from '@gltf-transform/core'
import type { AssetMeta, AssetSource, Kind, RigType } from '../shared/meta.ts'
import { step, type StepHandle } from './activity.ts'
import { writeAssetIndex } from './assetIndex.ts'
import { DEFAULT_ANIMATIONS, PROFILES, clipName, toPreset } from './profiles.ts'
import { Tripo, modelUrl, previewUrl, type OnProgress, type TripoTask } from './providers/tripo.ts'
import { fetchModel } from './providers/sketchfab.ts'
import { inspect, mergeAnimations, normalize, readGlb, writeGlb } from './steps/gltf.ts'
import { ASSETS_DIR, CACHE_DIR, PREVIEW_DIR, download, log, mb, readJson, writeJson } from './util.ts'

export type RigOption = 'auto' | 'none' | RigType

export interface MakeOptions {
  id: string
  prompt: string
  kind: Kind
  /** sketchfab:<uid> | tripo:<taskId> | file:<path>; omitted = generate with Tripo */
  from?: string
  image?: string
  rig?: RigOption
  anims?: string[]
  height?: number
  compress?: boolean
  faceLimit?: number
  quality?: 'standard' | 'detailed'
}

interface Acquired {
  file: string
  source: AssetSource
  /** Tripo generation task usable directly as rig/texture input. */
  taskId?: string
}

const workDir = (id: string) => path.join(CACHE_DIR, id)
export const metaPath = (id: string) => path.join(ASSETS_DIR, id, 'meta.json')
export const loadMeta = async (id: string) => {
  const meta = await readJson<AssetMeta>(metaPath(id))
  if (!meta) throw new Error(`No asset "${id}" (missing ${metaPath(id)})`)
  return meta
}

/** Maps Tripo polling onto a step's progress bar. */
const tripoProgress = (s: StepHandle, label: string): OnProgress => (t) => s.progress(t.progress, `${label} ${t.progress}%`)

/** Downloads a Tripo result (URLs expire in 5 min) and its preview render, showing the render in the activity feed. */
async function saveTripoResult(task: TripoTask, file: string, s: StepHandle, label: string) {
  await download(modelUrl(task), file, (pct, size) => s.progress(pct, `${label}: receiving ${size.toFixed(1)} MB`))
  const preview = previewUrl(task)
  if (preview) {
    const name = `${path.basename(path.dirname(file))}_${path.basename(file, '.glb')}${path.extname(new URL(preview).pathname) || '.webp'}`
    await download(preview, path.join(PREVIEW_DIR, 'previews', name)).then(
      () => s.images([{ url: `previews/${name}`, caption: label }]),
      () => {},
    )
  }
  return file
}

async function acquire(tripo: Tripo, o: MakeOptions): Promise<Acquired> {
  const dest = path.join(workDir(o.id), 'source.glb')
  const [scheme, ...rest] = (o.from ?? '').split(':')
  const ref = rest.join(':')

  if (scheme === 'sketchfab') {
    return step('download', 'Fetching the model', async (s) => {
      const r = await fetchModel(ref, dest, (pct, size) => s.progress(pct, `Fetching the model: ${size.toFixed(1)} MB`))
      if (r.thumbnail) s.images([{ url: r.thumbnail, caption: r.source.name }])
      s.done(`Got "${r.source.name}" (${mb((await fs.stat(dest)).size)})`)
      return r
    })
  }
  if (scheme === 'file') {
    return step('copy', 'Importing the model', async () => {
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.copyFile(path.resolve(ref), dest)
      return { file: dest, source: { type: 'file' as const, url: ref } }
    })
  }

  const label = scheme === 'tripo' ? 'Resuming the sculpt' : o.image ? 'Sculpting a 3D model from your image' : `Sculpting "${o.prompt}" in 3D`
  return step('generate', label, async (s) => {
    let task: TripoTask
    if (scheme === 'tripo') task = await tripo.wait(ref, tripoProgress(s, 'Sculpting'))
    else if (o.image) {
      const input = /^https?:/.test(o.image) ? o.image : await tripo.upload(o.image)
      task = await tripo.imageToModel(input, { faceLimit: o.faceLimit, quality: o.quality }, tripoProgress(s, 'Sculpting'))
    } else {
      const prompt = `${o.prompt}, ${PROFILES[o.kind].promptSuffix}`
      task = await tripo.textToModel(prompt, { faceLimit: o.faceLimit, quality: o.quality }, tripoProgress(s, 'Sculpting'))
    }
    await saveTripoResult(task, dest, s, 'Sculpted model')
    s.done('Sculpted and painted')
    return { file: dest, taskId: task.task_id, source: { type: 'tripo' as const, taskIds: { model: task.task_id } } }
  })
}

/** Retargets presets onto the rig and merges the clips into `doc`. Failed presets are skipped with a warning. */
async function addAnimations(tripo: Tripo, doc: Document, id: string, rigTaskId: string, presets: string[]) {
  const results = await Promise.allSettled(
    presets.map((preset) =>
      step('animate', `Teaching it to ${clipName(preset)}`, async (s) => {
        const file = path.join(workDir(id), `anim_${clipName(preset)}.glb`)
        const task = await tripo.retarget(rigTaskId, preset, tripoProgress(s, `Teaching it to ${clipName(preset)}`))
        await saveTripoResult(task, file, s, `Animation ${clipName(preset)}`)
        s.done(`It can ${clipName(preset)} now`)
        return { preset, anim: await readGlb(file) }
      }),
    ),
  )
  const added: string[] = []
  await step('merge-clips', 'Combining its moves', async (s) => {
    for (const r of results) {
      if (r.status === 'rejected') {
        log(`warning: animation failed: ${r.reason}`)
        continue
      }
      doc.getRoot().listAnimations().find((a) => a.getName() === clipName(r.value.preset))?.dispose()
      if (mergeAnimations(doc, r.value.anim, clipName(r.value.preset))) added.push(r.value.preset)
    }
    s.done(`Moves: ${added.map(clipName).join(', ') || 'none'}`)
  })
  return added
}

interface RigResult {
  doc: Document
  rigType: RigType | null
  rigTaskId?: string
  presets: string[]
}

async function rigAndAnimate(tripo: Tripo, src: Acquired, o: { id: string; kind: Kind; rig?: RigOption; anims?: string[] }): Promise<RigResult> {
  let doc = await readGlb(src.file)
  const mode = o.rig ?? (PROFILES[o.kind].rig === 'check' ? 'auto' : 'none')
  const root = doc.getRoot()
  const staticResult = { doc, rigType: null, presets: [] }

  const decision = await step('rig-decision', 'Deciding how it should move', async (s) => {
    if (mode === 'none') {
      s.done(o.rig === 'none' ? 'It stays still' : `It stays still (${o.kind})`)
      return 'skip'
    }
    if (mode === 'auto' && (root.listSkins().length || root.listAnimations().length)) {
      s.done(`It already knows how to move (${root.listAnimations().map((a) => a.getName()).join(', ') || 'posed'})`)
      return 'skip'
    }
    s.done('It needs a skeleton, building one')
    return 'rig'
  })
  if (decision === 'skip' || mode === 'none') return staticResult

  let rigType: RigType
  let rigTask: TripoTask
  try {
    const input = src.taskId ?? (await step('upload', 'Preparing the model', async () => tripo.upload(src.file)))
    if (mode === 'auto') {
      const check = await step('rig-check', 'Studying its body shape', async (s) => {
        const c = await tripo.rigCheck(input, tripoProgress(s, 'Studying'))
        s.done(c.riggable ? `Body type: ${c.rig_type}` : 'It will stay still')
        return c
      })
      if (!check.riggable) return staticResult
      rigType = check.rig_type
    } else rigType = mode
    rigTask = await step('rig', `Building a ${rigType} skeleton`, async (s) => tripo.rig(input, rigType, tripoProgress(s, 'Building the skeleton')))
  } catch (e) {
    if (mode !== 'auto') throw e
    log(`warning: rigging failed, keeping the model static: ${e instanceof Error ? e.message : e}`)
    return staticResult
  }

  const rigged = path.join(workDir(o.id), 'rigged.glb')
  await step('download-rig', 'Attaching the skeleton', async (s) => saveTripoResult(rigTask, rigged, s, 'Skeleton'))
  doc = await readGlb(rigged)
  const presets = await addAnimations(tripo, doc, o.id, rigTask.task_id, (o.anims ?? DEFAULT_ANIMATIONS[rigType]).map(toPreset))
  return { doc, rigType, rigTaskId: rigTask.task_id, presets }
}

async function finalize(doc: Document, base: Omit<AssetMeta, 'bones' | 'nodes' | 'clips' | 'materials' | 'bbox' | 'height' | 'triangles' | 'file' | 'createdAt'>, compress?: boolean) {
  return step('finalize', 'Polishing', async (s) => {
    await normalize(doc, { compress })
    const dir = path.join(ASSETS_DIR, base.id)
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, 'model.glb')
    await writeGlb(file, doc)
    const meta: AssetMeta = { ...base, ...inspect(doc), file: 'model.glb', createdAt: new Date().toISOString() }
    await writeJson(metaPath(base.id), meta)
    writeAssetIndex()
    s.done(`Ready (${meta.triangles.toLocaleString()} triangles, ${mb((await fs.stat(file)).size)})`)
    return meta
  })
}

export async function make(o: MakeOptions): Promise<AssetMeta> {
  const tripo = new Tripo()
  const src = await acquire(tripo, o)
  const r = await rigAndAnimate(tripo, src, o)
  const source = { ...src.source, taskIds: { ...src.source.taskIds, rig: r.rigTaskId } }
  return finalize(
    r.doc,
    {
      id: o.id,
      prompt: o.prompt,
      kind: o.kind,
      source,
      rigType: r.rigType,
      presets: r.presets,
      defaultHeight: o.height ?? PROFILES[o.kind].defaultHeight,
      credits: tripo.credits,
    },
    o.compress,
  )
}

export async function animate(id: string, anims: string[], compress?: boolean) {
  const meta = await loadMeta(id)
  const rigTaskId = meta.source.taskIds?.rig
  if (!rigTaskId) throw new Error(`"${id}" was not rigged by Tripo; re-make it with --rig auto|<type>`)
  const tripo = new Tripo()
  const doc = await readGlb(path.join(ASSETS_DIR, id, meta.file))
  const added = await addAnimations(tripo, doc, id, rigTaskId, anims.map(toPreset))
  return finalize(doc, { ...meta, presets: [...new Set([...meta.presets, ...added])], credits: meta.credits + tripo.credits }, compress)
}

export async function retexture(id: string, prompt: string, compress?: boolean) {
  const meta = await loadMeta(id)
  const tripo = new Tripo()
  const file = path.join(workDir(id), 'retextured.glb')
  const task = await step('texture', `Repainting it: "${prompt}"`, async (s) => {
    const input = meta.source.taskIds?.model ?? (await tripo.upload(path.join(ASSETS_DIR, id, meta.file)))
    const t = await tripo.texture(input, prompt, tripoProgress(s, 'Repainting'))
    await saveTripoResult(t, file, s, 'Repainted model')
    return t
  })
  const r = await rigAndAnimate(tripo, { file, source: meta.source }, {
    id,
    kind: meta.kind,
    rig: meta.rigType ?? 'none',
    anims: meta.presets,
  })
  const source = { ...meta.source, taskIds: { ...meta.source.taskIds, texture: task.task_id, rig: r.rigTaskId ?? meta.source.taskIds?.rig } }
  return finalize(r.doc, { ...meta, source, prompt: `${meta.prompt} | texture: ${prompt}`, rigType: r.rigType ?? meta.rigType, presets: r.presets, credits: meta.credits + tripo.credits }, compress)
}
