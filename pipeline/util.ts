import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import dotenv from 'dotenv'

export const ROOT = path.resolve(import.meta.dirname, '..')
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true })
export const ASSETS_DIR = path.join(ROOT, 'assets')
export const CACHE_DIR = path.join(ROOT, '.cache')
export const STATE_DIR = path.join(ROOT, '.neurocraft')
export const ENTITIES_DIR = path.join(ROOT, 'src', 'entities')
/** Images for visual review (search thumbnails, Tripo previews). Kept outside the repo. */
export const PREVIEW_DIR = path.join(os.tmpdir(), 'neurocraft')

export function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing ${name} in .env`)
  return v
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const log = (...args: unknown[]) => console.error('[nc]', ...args)

export async function download(url: string, dest: string, onProgress?: (pct: number, mb: number) => void) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status} ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  const chunks: Uint8Array[] = []
  let received = 0
  let lastPct = -1
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
    received += chunk.length
    const pct = total ? Math.floor((received / total) * 100) : 0
    if (onProgress && pct !== lastPct && pct % 5 === 0) onProgress(pct, received / 1e6)
    lastPct = pct
  }
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.writeFile(dest, Buffer.concat(chunks))
  return dest
}

export const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

export async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n')
}

export const toPascal = (id: string) =>
  id.replace(/(^|[-_\s]+)(\w)/g, (_, __, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '')
