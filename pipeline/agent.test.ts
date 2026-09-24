import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WorldState } from '../shared/world.ts'

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nc-world-')), 'world.json')
const seed: WorldState = {
  version: 1,
  time: 'day',
  objects: [
    { id: 'man', asset: 'man', label: 'man', at: [0, 0], height: 1.8, count: 4 },
    { id: 'castle', asset: 'castle', label: 'stone castle', at: [-49, -49], height: 22 },
  ],
}

let world: typeof import('./world.ts')
let tools: typeof import('./agent/tools.ts')

beforeAll(async () => {
  fs.writeFileSync(file, JSON.stringify(seed))
  process.env.NC_WORLD_FILE = file
  world = await import('./world.ts')
  tools = await import('./agent/tools.ts')
})

describe('world store', () => {
  it('commits, persists and undoes', () => {
    world.commit('night', (w) => {
      w.time = 'night'
    })
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).time).toBe('night')
    expect(world.undo()).toBe('night')
    expect(world.getWorld().time).toBe('day')
  })

  it('makes unique ids', () => {
    expect(world.uniqueId(world.getWorld(), 'Stone Castle!')).toBe('stone-castle')
    expect(world.uniqueId(world.getWorld(), 'castle')).toBe('castle-2')
  })
})

describe('agent tools', () => {
  it('scales, tints and changes copies', async () => {
    await tools.runTool('update_object', { id: 'man', scale_factor: 2, tint: 'gold', count: 2 })
    const man = world.getWorld().objects.find((o) => o.id === 'man')!
    expect(man).toMatchObject({ height: 3.6, tint: 'gold', count: 2 })
  })

  it('validates animation clips against the asset and matches case-insensitively', async () => {
    await expect(tools.runTool('update_object', { id: 'man', clip: 'dance' })).rejects.toThrow(/available: .*Walk/)
    await tools.runTool('update_object', { id: 'man', clip: 'run' })
    expect(world.getWorld().objects.find((o) => o.id === 'man')!.clip).toBe('Run')
  })

  it('removes some copies, then the whole object', async () => {
    await tools.runTool('remove_object', { id: 'man', count: 1 })
    expect(world.getWorld().objects.find((o) => o.id === 'man')!.count).toBe(1)
    await tools.runTool('remove_object', { id: 'man' })
    expect(world.getWorld().objects.some((o) => o.id === 'man')).toBe(false)
  })

  it('moves to coordinates and rejects unknown ids with the list of real ones', async () => {
    await tools.runTool('move_object', { id: 'castle', to: '10, -20' })
    expect(world.getWorld().objects.find((o) => o.id === 'castle')!.at).toEqual([10, -20])
    await expect(tools.runTool('update_object', { id: 'dragon', height: 5 })).rejects.toThrow(/Existing ids: castle/)
  })

  it('exposes JSON-schema tool specs', () => {
    const add = tools.toolSpecs.find((t) => t.function.name === 'add_object')!
    expect(add.function.parameters).toMatchObject({ type: 'object', required: expect.arrayContaining(['query', 'kind']) })
  })
})

describe('llm client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('moves to the next Groq model when one is rate limited', async () => {
    process.env.GROQ_API_KEY = 'test-key'
    const models: string[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const { model } = JSON.parse(String(init.body)) as { model: string }
      models.push(model)
      if (models.length === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '30' } })
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status: 200 })
    })
    const { chat } = await import('./llm.ts')
    const reply = await chat([{ role: 'user', content: 'hi' }])
    expect(reply.content).toBe('ok')
    expect(models).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
  })
})
