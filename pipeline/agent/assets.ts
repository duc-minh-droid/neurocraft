import fs from 'node:fs'
import path from 'node:path'
import type { AssetMeta, Kind } from '../../shared/meta.ts'
import { step } from '../activity.ts'
import { chat, lightModel } from '../llm.ts'
import { make } from '../make.ts'
import { search, type Candidate } from '../providers/sketchfab.ts'
import { Tripo } from '../providers/tripo.ts'
import { ASSETS_DIR, log } from '../util.ts'
import { library } from './context.ts'

/** Licenses that allow modifying and redistributing the model (we optimize it and keep it in the repo). */
const OK_LICENSES = /^(CC Attribution(-ShareAlike)?|CC0 Public Domain)$/

const STOP = new Set(['a', 'an', 'the', 'of', 'with', 'and', 'some', 'low', 'poly', 'lowpoly', 'model', 'big', 'small'])
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t))

/** An already-downloaded asset whose description covers the request ("another castle" → castle). */
export function findInLibrary(query: string): AssetMeta | undefined {
  const q = tokens(query)
  if (!q.length) return undefined
  let best: { meta: AssetMeta; score: number } | undefined
  for (const meta of library()) {
    const have = new Set([...tokens(meta.prompt), ...tokens(meta.id), ...tokens(meta.source.name ?? '')])
    const score = q.filter((t) => have.has(t) || have.has(t.replace(/s$/, ''))).length / q.length
    if (score >= 0.6 && (!best || score > best.score)) best = { meta, score }
  }
  return best?.meta
}

function rank(c: Candidate, i: number, query: string, wantsMotion: boolean) {
  const name = new Set(tokens(c.name))
  const nameHits = tokens(query).filter((t) => name.has(t) || name.has(t.replace(/s$/, ''))).length
  return (12 - i) * 1.5 + Math.log10(c.likes + 1) * 2 + nameHits * 4 + (wantsMotion && c.animations > 0 ? 12 : 0) - (c.faces > 100_000 ? 6 : 0) - (c.glbMB > 30 ? 6 : c.glbMB > 12 ? 2 : 0)
}

async function llmPick(query: string, kind: Kind, options: Candidate[]): Promise<number> {
  try {
    const list = options.map((c, i) => `${i}: "${c.name}" (${c.faces} faces, ${c.animations} animations, ${c.glbMB} MB)`).join('\n')
    const reply = await chat(
      [
        { role: 'system', content: 'You pick the best 3D model for a request in a stylized game world. Prefer a single object (not a scene or pack), matching the request closely. Reply with JSON: {"index": <number>}.' },
        { role: 'user', content: `Request: "${query}" (${kind})\nOptions:\n${list}` },
      ],
      undefined,
      { json: true, temperature: 0, model: lightModel() },
    )
    const index = Number((JSON.parse(reply.content ?? '{}') as { index?: number }).index)
    return Number.isInteger(index) && index >= 0 && index < options.length ? index : 0
  } catch (e) {
    log(`llm pick failed, using top ranked: ${e instanceof Error ? e.message : e}`)
    return 0
  }
}

function uniqueAssetId(query: string) {
  const base = tokens(query).slice(0, 3).join('-') || 'object'
  if (!fs.existsSync(path.join(ASSETS_DIR, base))) return base
  for (let i = 2; ; i++) if (!fs.existsSync(path.join(ASSETS_DIR, `${base}-${i}`))) return `${base}-${i}`
}

let tripoBalance: { value: number; at: number } | null = null
async function canGenerate() {
  if (!process.env.TRIPO_API_KEY) return false
  if (!tripoBalance || Date.now() - tripoBalance.at > 60_000) {
    const b = await new Tripo().balance().catch(() => ({ balance: 0 }))
    tripoBalance = { value: b.balance, at: Date.now() }
  }
  return tripoBalance.value >= 40
}

/** Library reuse → search + rank + LLM pick + fetch → generate (if credits) → error. */
export async function acquireAsset(query: string, kind: Kind, opts: { height?: number; wantsMotion?: boolean } = {}): Promise<{ meta: AssetMeta; reused: boolean }> {
  const reuse = findInLibrary(query)
  if (reuse) return { meta: reuse, reused: true }

  const options = await step('search', `Looking for "${query}"`, async (s) => {
    const usable = (cs: Candidate[]) => cs.filter((c) => OK_LICENSES.test(c.license) && c.glbMB <= 60)
    // Things that should move: prefer models that already come animated (rigging needs paid credits).
    let results = opts.wantsMotion ? usable(await search(query, { count: 16, maxFaces: 150_000, animated: true })) : []
    if (results.length < 3) {
      const seen = new Set(results.map((c) => c.uid))
      results = [...results, ...usable(await search(query, { count: 16, maxFaces: 150_000 })).filter((c) => !seen.has(c.uid))]
    }
    const ranked = results
      .map((c, i) => ({ c, score: rank(c, i, query, !!opts.wantsMotion) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => x.c)
    if (ranked.length) s.images(ranked.map((c) => ({ url: c.thumbnail, caption: c.name })))
    s.done(ranked.length ? `Found ${ranked.length} good options` : 'Nothing suitable in the library')
    return ranked
  })

  const id = uniqueAssetId(query)
  if (options.length) {
    const choice = options[await llmPick(query, kind, options)]
    const meta = await make({ id, prompt: query, kind, from: `sketchfab:${choice.uid}`, height: opts.height })
    return { meta, reused: false }
  }
  if (await canGenerate()) return { meta: await make({ id, prompt: query, kind, height: opts.height }), reused: false }
  throw new Error(`couldn't find a free "${query}" model, and generation needs Tripo credits`)
}
