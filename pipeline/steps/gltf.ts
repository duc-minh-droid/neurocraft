import { Document, NodeIO, getBounds, type Accessor, type Node } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import type { AssetMeta, Vec3 } from '../../shared/meta.ts'
import { log } from '../util.ts'

let io: NodeIO | undefined
export async function getIO() {
  if (io) return io
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
  io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
  return io
}

export const readGlb = async (file: string) => (await getIO()).read(file)
export const writeGlb = async (file: string, doc: Document) => (await getIO()).write(file, doc)

/**
 * Copies every animation from `src` into `base`, re-targeting channels onto base nodes with the same name
 * (Tripo retarget outputs share the rigged model's skeleton). The first copied clip is renamed to `name`.
 * Returns the number of channels that could be bound.
 */
export function mergeAnimations(base: Document, src: Document, name: string): number {
  const byName = new Map<string, Node>()
  for (const n of base.getRoot().listNodes()) if (!byName.has(n.getName())) byName.set(n.getName(), n)
  const buffer = base.getRoot().listBuffers()[0] ?? base.createBuffer()
  const copy = (a: Accessor) =>
    base.createAccessor().setType(a.getType()).setArray(a.getArray()!.slice()).setNormalized(a.getNormalized()).setBuffer(buffer)

  let bound = 0
  src.getRoot().listAnimations().forEach((anim, i) => {
    const out = base.createAnimation(i === 0 ? name : `${name}_${i}`)
    const samplers = new Map<object, ReturnType<Document['createAnimationSampler']>>()
    for (const ch of anim.listChannels()) {
      const target = byName.get(ch.getTargetNode()?.getName() ?? '')
      const s = ch.getSampler()
      if (!target || !s) continue
      let sampler = samplers.get(s)
      if (!sampler) {
        sampler = base.createAnimationSampler().setInput(copy(s.getInput()!)).setOutput(copy(s.getOutput()!)).setInterpolation(s.getInterpolation())
        out.addSampler(sampler)
        samplers.set(s, sampler)
      }
      out.addChannel(base.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()!).setSampler(sampler))
      bound++
    }
    if (!out.listChannels().length) out.dispose()
  })
  if (!bound) log(`warning: animation "${name}" had no channels matching the base skeleton`)
  return bound
}

export async function normalize(doc: Document, opts: { compress?: boolean } = {}) {
  doc.getRoot().listAnimations().forEach((a, i) => a.getName() || a.setName(`clip_${i}`))
  await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true }))
  if (opts.compress) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  return doc
}

export function inspect(doc: Document): Pick<AssetMeta, 'bones' | 'nodes' | 'clips' | 'materials' | 'bbox' | 'height' | 'triangles'> {
  const root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const { min, max } = getBounds(scene)
  let triangles = 0
  for (const node of root.listNodes()) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      if (prim.getMode() !== 4) continue
      triangles += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0) / 3
    }
  }
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))]
  return {
    bones: uniq(root.listSkins().flatMap((s) => s.listJoints().map((j) => j.getName()))),
    nodes: uniq(root.listNodes().map((n) => n.getName())),
    clips: root.listAnimations().map((a) => a.getName()),
    materials: uniq(root.listMaterials().map((m) => m.getName())),
    bbox: { min: min.map(round) as Vec3, max: max.map(round) as Vec3 },
    height: round(max[1] - min[1]),
    triangles: Math.round(triangles),
  }
}

const round = (n: number) => Math.round(n * 1e4) / 1e4
