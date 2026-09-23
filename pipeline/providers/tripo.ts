import fs from 'node:fs/promises'
import path from 'node:path'
import type { RigType } from '../../shared/meta.ts'
import { env, log, sleep } from '../util.ts'

const BASE = 'https://openapi.tripo3d.ai/v3'
export const GEN_MODEL = 'v3.1-20260211'
export const RIG_MODEL = 'v2.5-20260210'
export const TEXTURE_MODEL = 'v3.0-20250812'

export interface TripoTask {
  task_id: string
  type: string
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'banned' | 'expired' | 'unknown'
  progress: number
  output?: Record<string, unknown>
  error_code?: number
  error_message?: string
  credits_consumed?: number
}

type Fetch = typeof fetch
export type OnProgress = (task: TripoTask) => void

export class Tripo {
  credits = 0

  constructor(
    private apiKey = env('TRIPO_API_KEY'),
    private fetchImpl: Fetch = fetch,
    private pollMs = 2000,
  ) {}

  private async call<T>(method: string, route: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${this.apiKey}` } }
    if (body instanceof FormData) init.body = body
    else if (body !== undefined) {
      init.body = JSON.stringify(body)
      ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    }
    const res = await this.fetchImpl(BASE + route, init)
    const json = (await res.json().catch(() => ({}))) as { code?: number; data?: T; message?: string; suggestion?: string }
    if (!res.ok || json.code !== 0) {
      throw new Error(`Tripo ${method} ${route} failed (${res.status}, code ${json.code}): ${json.message ?? ''} ${json.suggestion ?? ''}`)
    }
    return json.data as T
  }

  async create(route: string, body: Record<string, unknown>): Promise<string> {
    const { task_id } = await this.call<{ task_id: string }>('POST', route, body)
    log(`tripo ${route} -> ${task_id}`)
    return task_id
  }

  balance() {
    return this.call<{ balance: number; frozen: number }>('GET', '/account/balance')
  }

  getTask(id: string) {
    return this.call<TripoTask>('GET', `/tasks/${id}`)
  }

  async wait(id: string, onProgress?: OnProgress, timeoutMs = 15 * 60_000): Promise<TripoTask> {
    const start = Date.now()
    let last = -1
    for (;;) {
      const t = await this.getTask(id)
      if (t.status === 'success') {
        this.credits += t.credits_consumed ?? 0
        log(`  ${id} done (${t.credits_consumed ?? 0} credits)`)
        return t
      }
      if (!['queued', 'running'].includes(t.status)) {
        throw new Error(`Tripo task ${id} ${t.status}: ${t.error_code ?? ''} ${t.error_message ?? ''}`)
      }
      if (t.progress !== last) {
        log(`  ${id} ${t.status} ${t.progress}%`)
        onProgress?.(t)
      }
      last = t.progress
      if (Date.now() - start > timeoutMs) throw new Error(`Tripo task ${id} timed out`)
      await sleep(this.pollMs)
    }
  }

  async run(route: string, body: Record<string, unknown>, onProgress?: OnProgress) {
    return this.wait(await this.create(route, body), onProgress)
  }

  async upload(file: string): Promise<string> {
    const form = new FormData()
    form.append('file', new Blob([await fs.readFile(file)]), path.basename(file))
    const { file_token } = await this.call<{ file_token: string }>('POST', '/files', form)
    return file_token
  }

  textToModel(prompt: string, opts: { faceLimit?: number; quality?: 'standard' | 'detailed'; negativePrompt?: string } = {}, onProgress?: OnProgress) {
    return this.run('/generation/text-to-model', {
      prompt,
      model: GEN_MODEL,
      texture: true,
      pbr: true,
      texture_quality: opts.quality ?? 'standard',
      face_limit: opts.faceLimit,
      negative_prompt: opts.negativePrompt,
    }, onProgress)
  }

  imageToModel(input: string, opts: { faceLimit?: number; quality?: 'standard' | 'detailed' } = {}, onProgress?: OnProgress) {
    return this.run('/generation/image-to-model', {
      input,
      model: GEN_MODEL,
      texture: true,
      pbr: true,
      texture_quality: opts.quality ?? 'standard',
      face_limit: opts.faceLimit,
    }, onProgress)
  }

  async rigCheck(input: string, onProgress?: OnProgress): Promise<{ riggable: boolean; rig_type: RigType }> {
    const t = await this.run('/animations/rig-check', { input }, onProgress)
    return t.output as { riggable: boolean; rig_type: RigType }
  }

  rig(input: string, rigType: RigType, onProgress?: OnProgress) {
    return this.run('/animations/rig', { input, model: RIG_MODEL, rig_type: rigType, spec: 'tripo', out_format: 'glb' }, onProgress)
  }

  retarget(rigTaskId: string, preset: string, onProgress?: OnProgress) {
    return this.run('/animations/retarget', { input: rigTaskId, animation: preset, out_format: 'glb', animate_in_place: true }, onProgress)
  }

  texture(input: string, prompt?: string, onProgress?: OnProgress) {
    return this.run('/models/texture', {
      input,
      model: TEXTURE_MODEL,
      texture_prompt: prompt ? { text: prompt } : undefined,
      pbr: true,
    }, onProgress)
  }
}

/** Tripo outputs vary by task type (model_url, pbr_model, base_model, ...). Pick the best GLB URL. */
export function modelUrl(task: TripoTask): string {
  const o = task.output ?? {}
  for (const k of ['pbr_model', 'model_url', 'model', 'base_model']) {
    const v = o[k]
    if (typeof v === 'string' && v) return v
  }
  const urls = o.model_urls
  if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0]
  if (urls && typeof urls === 'object') {
    const first = Object.values(urls)[0]
    if (typeof first === 'string') return first
  }
  throw new Error(`No model URL in Tripo task ${task.task_id} output: ${JSON.stringify(o)}`)
}

export const previewUrl = (task: TripoTask) =>
  typeof task.output?.rendered_image_url === 'string' ? (task.output.rendered_image_url as string) : undefined
