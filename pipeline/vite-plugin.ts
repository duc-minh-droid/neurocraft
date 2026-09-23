import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { ACTIVITY_EVENT, ACTIVITY_FILE, CHAT_EVENT, type ActivityEvent } from '../shared/activity.ts'
import { cancelChat, chatStatus, onChatStatus, resetChat, sendChat } from './chat.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const STATE_DIR = path.join(ROOT, '.neurocraft')
const ACTIVITY = path.join(STATE_DIR, ACTIVITY_FILE)
const ENTITIES_DIR = path.join(ROOT, 'src', 'entities')
const PREVIEW_DIR = path.join(os.tmpdir(), 'neurocraft')
const STATE_KEYS = new Set(['cursor', 'selection', 'scene'])
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => resolve(body))
  })
}

const isEvent = (e: unknown): e is ActivityEvent =>
  !!e && typeof (e as ActivityEvent).ts === 'number' && typeof (e as ActivityEvent).run === 'string' && typeof (e as ActivityEvent).message === 'string'

function parseLines(text: string): ActivityEvent[] {
  return text.split('\n').flatMap((l) => {
    try {
      const e: unknown = JSON.parse(l)
      return isEvent(e) ? [e] : []
    } catch {
      return []
    }
  })
}

function tailLines(file: string, max: number): ActivityEvent[] {
  try {
    return parseLines(fs.readFileSync(file, 'utf8')).slice(-max)
  } catch {
    return []
  }
}

/** Tiny line diff: good enough to show what changed in a small entity file. */
export function lineDiff(before: string, after: string, max = 14): string {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) (i++, j++)
    else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) out.push(`+ ${b[j++]}`)
    else out.push(`- ${a[i++]}`)
  }
  return out.length > max ? [...out.slice(0, max), `… ${out.length - max} more changed lines`].join('\n') : out.join('\n')
}

/**
 * Dev-only bridge between the CLI agent and the page:
 * - POST /__nc/{cursor,selection,scene}: browser → .neurocraft/*.json ("here", "it", live scene)
 * - GET  /__nc/activity: recent activity history; new lines are pushed live over the HMR socket
 * - GET  /__nc/preview/<file>: search thumbnails / Tripo preview renders from the temp preview dir
 * - entity file edits are appended to the activity feed with a diff
 */
export function neurocraft(): Plugin {
  return {
    name: 'neurocraft',
    apply: (_, env) => env.command === 'serve' && !process.env.VITEST,
    configureServer(server) {
      fs.mkdirSync(STATE_DIR, { recursive: true })
      startActivityTail(server)
      watchEntities(server)
      onChatStatus((s) => server.ws.send({ type: 'custom', event: CHAT_EVENT, data: s }))

      server.middlewares.use('/__nc', async (req, res) => {
        const url = decodeURIComponent(req.url?.split('?')[0] ?? '').replace(/^\//, '')
        const json = (status: number, data: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        }
        if (url.startsWith('chat')) {
          if (req.method === 'GET' && url === 'chat/status') return json(200, chatStatus())
          if (req.method === 'POST' && url === 'chat') {
            const { message } = JSON.parse((await readBody(req)) || '{}') as { message?: string }
            if (!message?.trim()) return json(400, { ok: false, error: 'empty message' })
            const r = await sendChat(message.trim())
            return json(r.ok ? 202 : 409, r)
          }
          if (req.method === 'POST' && url === 'chat/cancel') return json(200, { ok: cancelChat() })
          if (req.method === 'POST' && url === 'chat/reset') return json(200, { ok: resetChat() })
        }
        if (req.method === 'GET' && url === 'activity') {
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify(tailLines(ACTIVITY, 600)))
        }
        if (req.method === 'GET' && url.startsWith('preview/')) {
          const file = path.resolve(PREVIEW_DIR, url.slice('preview/'.length))
          if (!file.startsWith(PREVIEW_DIR + path.sep) || !MIME[path.extname(file).toLowerCase()] || !fs.existsSync(file)) {
            res.statusCode = 404
            return res.end()
          }
          res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()])
          return fs.createReadStream(file).pipe(res)
        }
        if (req.method === 'POST' && STATE_KEYS.has(url)) {
          try {
            const data = JSON.parse(await readBody(req))
            fs.writeFileSync(path.join(STATE_DIR, `${url}.json`), JSON.stringify({ ...data, at: new Date().toISOString() }, null, 2))
            res.statusCode = 204
          } catch {
            res.statusCode = 400
          }
          return res.end()
        }
        res.statusCode = 404
        res.end()
      })
    },
  }
}

let lastEvent: ActivityEvent | undefined

function startActivityTail(server: ViteDevServer) {
  let offset = fs.existsSync(ACTIVITY) ? fs.statSync(ACTIVITY).size : 0
  lastEvent = tailLines(ACTIVITY, 1)[0]
  const listener = (cur: fs.Stats) => {
    if (cur.size < offset) offset = 0
    if (cur.size === offset) return
    const fd = fs.openSync(ACTIVITY, 'r')
    const buf = Buffer.alloc(cur.size - offset)
    fs.readSync(fd, buf, 0, buf.length, offset)
    fs.closeSync(fd)
    const text = buf.toString('utf8')
    const complete = text.slice(0, text.lastIndexOf('\n') + 1)
    offset += Buffer.byteLength(complete)
    const events = parseLines(complete)
    if (!events.length) return
    lastEvent = events[events.length - 1]
    server.ws.send({ type: 'custom', event: ACTIVITY_EVENT, data: events })
  }
  // Vite restarts re-run configureServer: swap only our own listener so an old server's close can't remove the new one.
  if (tailListener) fs.unwatchFile(ACTIVITY, tailListener)
  tailListener = listener
  fs.watchFile(ACTIVITY, { interval: 200 }, listener)
  server.httpServer?.once('close', () => fs.unwatchFile(ACTIVITY, listener))
}

let tailListener: ((cur: fs.Stats) => void) | undefined

function watchEntities(server: ViteDevServer) {
  const cache = new Map<string, string>()
  for (const f of fs.existsSync(ENTITIES_DIR) ? fs.readdirSync(ENTITIES_DIR) : []) {
    if (f.endsWith('.tsx')) cache.set(path.join(ENTITIES_DIR, f), fs.readFileSync(path.join(ENTITIES_DIR, f), 'utf8'))
  }
  const onFile = (kind: 'add' | 'change' | 'unlink') => (rawFile: string) => {
    const file = path.resolve(rawFile)
    if (path.dirname(file).toLowerCase() !== ENTITIES_DIR.toLowerCase() || !file.endsWith('.tsx')) return
    const name = path.basename(file)
    const before = cache.get(file) ?? ''
    const after = kind === 'unlink' ? '' : fs.readFileSync(file, 'utf8')
    if (kind === 'change' && before === after) return
    kind === 'unlink' ? cache.delete(file) : cache.set(file, after)
    const recent = lastEvent && lastEvent.run.startsWith('req:') && Date.now() - lastEvent.ts < 10 * 60_000 && !(lastEvent.status === 'done' && !lastEvent.step)
    const event: ActivityEvent = {
      ts: Date.now(),
      source: 'editor',
      run: recent ? lastEvent!.run : 'editor',
      runTitle: recent ? lastEvent!.runTitle : 'Code edits',
      status: 'info',
      message: kind === 'add' ? `Created src/entities/${name}` : kind === 'unlink' ? `Removed src/entities/${name}` : `Edited src/entities/${name}`,
      detail: kind === 'unlink' ? undefined : lineDiff(before, after),
    }
    fs.appendFileSync(ACTIVITY, JSON.stringify(event) + '\n')
  }
  server.watcher.on('add', onFile('add'))
  server.watcher.on('change', onFile('change'))
  server.watcher.on('unlink', onFile('unlink'))
}
