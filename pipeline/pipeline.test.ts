import { describe, expect, it } from 'vitest'
import { Document } from '@gltf-transform/core'
import { Tripo, modelUrl, type TripoTask } from './providers/tripo.ts'
import { inspect, mergeAnimations } from './steps/gltf.ts'
import { clipName, toPreset } from './profiles.ts'

function mockFetch(responses: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(responses.shift()), { status: 200 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('Tripo', () => {
  it('creates a task, polls until success and sums credits', async () => {
    const { impl, calls } = mockFetch([
      { code: 0, data: { task_id: 'task_1' } },
      { code: 0, data: { task_id: 'task_1', status: 'queued', progress: 0 } },
      { code: 0, data: { task_id: 'task_1', status: 'running', progress: 50 } },
      { code: 0, data: { task_id: 'task_1', status: 'success', progress: 100, credits_consumed: 20, output: { pbr_model: 'https://x/m.glb' } } },
    ])
    const tripo = new Tripo('key', impl, 1)
    const task = await tripo.textToModel('a red dragon')
    expect(modelUrl(task)).toBe('https://x/m.glb')
    expect(tripo.credits).toBe(20)
    expect(calls[0].url).toBe('https://openapi.tripo3d.ai/v3/generation/text-to-model')
    expect(JSON.parse(calls[0].init!.body as string)).toMatchObject({ prompt: 'a red dragon', texture: true, pbr: true })
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer key')
    expect(calls.slice(1).every((c) => c.url.endsWith('/tasks/task_1'))).toBe(true)
  })

  it('throws on failed tasks and API errors', async () => {
    const failed = mockFetch([{ code: 0, data: { task_id: 't' } }, { code: 0, data: { task_id: 't', status: 'failed', progress: 0, error_message: 'bad' } }])
    await expect(new Tripo('k', failed.impl, 1).rigCheck('t')).rejects.toThrow(/failed.*bad/)
    const apiErr = mockFetch([{ code: 1002, message: 'no credits' }])
    await expect(new Tripo('k', apiErr.impl, 1).textToModel('x')).rejects.toThrow(/no credits/)
  })

  it('picks model URLs from the various output shapes', () => {
    const t = (output: Record<string, unknown>) => ({ task_id: 't', output }) as TripoTask
    expect(modelUrl(t({ model_url: 'a' }))).toBe('a')
    expect(modelUrl(t({ model_urls: ['b'] }))).toBe('b')
    expect(modelUrl(t({ model_urls: { walk: 'c' } }))).toBe('c')
    expect(() => modelUrl(t({}))).toThrow()
  })
})

describe('profiles', () => {
  it('maps preset names', () => {
    expect(toPreset('quadruped:walk')).toBe('preset:quadruped:walk')
    expect(toPreset('preset:idle')).toBe('preset:idle')
    expect(clipName('preset:quadruped:walk')).toBe('walk')
  })
})

function riggedDoc(withAnimation: boolean) {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const hip = doc.createNode('Hip')
  const tail = doc.createNode('Tail').setTranslation([0, 0, -1])
  hip.addChild(tail)
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 2, 0, 0, 2, 1])).setBuffer(buffer)
  const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos))
  const skin = doc.createSkin().addJoint(hip).addJoint(tail)
  doc.createScene().addChild(hip).addChild(doc.createNode('Body').setMesh(mesh).setSkin(skin))
  if (withAnimation) {
    const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buffer)
    const output = doc.createAccessor().setType('VEC4').setArray(new Float32Array([0, 0, 0, 1, 0, 0.7, 0, 0.7])).setBuffer(buffer)
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output)
    doc.createAnimation('Take 001').addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(tail).setTargetPath('rotation').setSampler(sampler))
  }
  return doc
}

describe('gltf steps', () => {
  it('merges animation clips onto the base skeleton by node name', () => {
    const base = riggedDoc(false)
    expect(mergeAnimations(base, riggedDoc(true), 'walk')).toBe(1)
    const [anim] = base.getRoot().listAnimations()
    expect(anim.getName()).toBe('walk')
    expect(anim.listChannels()[0].getTargetNode()).toBe(base.getRoot().listNodes().find((n) => n.getName() === 'Tail'))
  })

  it('inspects bones, clips, bbox and triangles', () => {
    const info = inspect(riggedDoc(true))
    expect(info.bones).toEqual(['Hip', 'Tail'])
    expect(info.clips).toEqual(['Take 001'])
    expect(info.height).toBe(2)
    expect(info.triangles).toBe(1)
  })
})
