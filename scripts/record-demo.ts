/**
 * Records a demo clip of the real flow: types prompts into the chat bar, waits for the world to change, orbits the camera.
 *   npx tsx scripts/record-demo.ts --name demo --prompt "a castle on the hill" [--prompt "..."] [--hold 5]
 * Frames are captured straight from the browser compositor (CDP screencast, high-quality JPEG) instead of Playwright's
 * low-bitrate video, then cut trailer-style. Outputs docs/media/<name>.webp (sharp master), .mp4 and .gif (for the README).
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { chromium, type Page } from 'playwright'

const { values: f } = parseArgs({
  options: {
    name: { type: 'string', default: 'demo' },
    prompt: { type: 'string', multiple: true, default: [] },
    url: { type: 'string', default: 'http://localhost:5173/' },
    hold: { type: 'string', default: '5' },
    intro: { type: 'string', default: '3' },
    timeout: { type: 'string', default: '240' },
    headed: { type: 'boolean', default: false },
    /** Entity to frame before the first prompt. */
    focus: { type: 'string' },
    /** Max seconds the fast-forwarded "working" stretch takes in the final cut. */
    work: { type: 'string', default: '7' },
    /** Re-cut an existing raw recording (.cache/recordings/<name>.webm) without recording again. */
    recut: { type: 'boolean', default: false },
    /** JSON [{prompt, cmd}]: type each prompt, then run its real pipeline commands directly. */
    steps: { type: 'string' },
    /** README GIF width and frame rate (quality vs file size). */
    'gif-width': { type: 'string', default: '800' },
    'gif-fps': { type: 'string', default: '10' },
    'gif-speed': { type: 'string', default: '1.25' },
  },
})

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'docs', 'media')
const W = 1280
const H = 720
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type NcWindow = { __nc: { autoRotate: (on: boolean) => void; focus: (id: string) => void } }

const panelHead = (page: Page) => page.locator('.nc-act-head').innerText().catch(() => '')

/** Waits until the in-page agent is idle (agent mode reports busy/pending); falls back to the panel for relay mode. */
async function waitForWork(page: Page, timeoutS: number) {
  const start = Date.now()
  await sleep(500)
  while (Date.now() - start < timeoutS * 1000) {
    const s = (await fetch(new URL('/__nc/chat/status', f.url)).then((r) => r.json())) as { mode: string; busy: boolean; pending?: number }
    if (s.mode !== 'agent') break
    if (!s.busy && !s.pending) return
    await sleep(300)
  }
  while (Date.now() - start < 20_000 && !(await panelHead(page)).includes('Working')) await sleep(250)
  while (Date.now() - start < timeoutS * 1000 && (await panelHead(page)).includes('Working')) await sleep(500)
}

/** Seconds into the raw video: when each prompt was sent and when its work finished. */
interface Marks {
  prompts: { sent: number; done: number }[]
  end: number
}

/**
 * Trailer-style cut: normal speed for typing and results, the waiting stretch between send and done
 * fast-forwarded to at most `workS` seconds (so progress still visibly streams in the panel).
 */
function cut(raw: string, marks: Marks, name: string, workS: number) {
  const segs: { from: number; to: number; speed: number }[] = []
  let t = 0
  for (const { sent, done } of marks.prompts) {
    const a = sent + 1.5
    const b = Math.max(a, done - 0.5)
    segs.push({ from: t, to: a, speed: 1 })
    segs.push({ from: a, to: b, speed: Math.max(1, (b - a) / workS) })
    t = b
  }
  segs.push({ from: t, to: marks.end, speed: 1 })
  const parts = segs.filter((s) => s.to - s.from > 0.05)
  const filter =
    parts.map((s, i) => `[0:v]trim=start=${s.from.toFixed(2)}:end=${s.to.toFixed(2)},setpts=(PTS-STARTPTS)/${s.speed.toFixed(3)}[v${i}]`).join(';') +
    `;${parts.map((_, i) => `[v${i}]`).join('')}concat=n=${parts.length}:v=1:a=0,fps=25[out]`
  const ff = ffmpegPath as unknown as string
  const run = (args: string[]) => execFileSync(ff, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  const master = path.join(RAW_DIR, `${name}.cut.mp4`)
  const webp = path.join(OUT, `${name}.webp`)
  const mp4 = path.join(OUT, `${name}.mp4`)
  const gif = path.join(OUT, `${name}.gif`)
  // Near-lossless cut master; every deliverable is derived from it.
  run(['-i', raw, '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-crf', '10', '-preset', 'medium', master])
  run(['-i', master, '-vf', 'fps=15', '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', '82', '-compression_level', '5', '-loop', '0', webp])
  run(['-i', master, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', mp4])
  // README GIF from the sharp master: lanczos scaling, per-clip palette, ordered dithering (compresses far better than
  // error diffusion on a moving camera), slightly sped up to keep it well under GitHub's 100 MB file limit.
  run([
    '-i',
    master,
    '-vf',
    `setpts=PTS/${f['gif-speed']},fps=${f['gif-fps']},scale=${f['gif-width']}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    gif,
  ])
  const size = (p: string) => +(fs.statSync(p).size / 1e6).toFixed(1)
  const seconds = parts.reduce((s, p) => s + (p.to - p.from) / p.speed, 0)
  return { webp, mp4, gif, webpMB: size(webp), mp4MB: size(mp4), gifMB: size(gif), seconds: +seconds.toFixed(1) }
}

/** Captures compositor frames via CDP screencast; returns a stop() that writes a constant-30fps near-lossless video. */
async function startCapture(page: Page, dir: string, t0: number) {
  const cdp = await page.context().newCDPSession(page)
  const frames: { file: string; t: number }[] = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }: { data: string; metadata: { timestamp?: number }; sessionId: number }) => {
    const file = path.join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`)
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    frames.push({ file, t: metadata.timestamp ? metadata.timestamp * 1000 - t0 : Date.now() - t0 })
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
  return async (out: string, endMs: number) => {
    await cdp.send('Page.stopScreencast').catch(() => {})
    // Concat list with real frame durations (frames only arrive when the page repaints).
    const lines: string[] = []
    frames.forEach((fr, i) => {
      const start = i === 0 ? 0 : fr.t
      const next = frames[i + 1]?.t ?? endMs
      lines.push(`file '${fr.file.replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, (next - start) / 1000).toFixed(4)}`)
    })
    lines.push(`file '${frames.at(-1)!.file.replace(/\\/g, '/')}'`)
    const list = path.join(dir, 'frames.txt')
    fs.writeFileSync(list, lines.join('\n'))
    execFileSync(ffmpegPath as unknown as string, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=30,scale=${W}:${H}`, '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-crf', '8', '-preset', 'fast', out], { stdio: 'inherit' })
    return frames.length
  }
}

const RAW_DIR = path.join(ROOT, '.cache', 'recordings')

/** Runs a demo step's shell command (bash) with $R = run title; resolves when it exits. */
function run(cmd: string, R: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('bash', ['-c', cmd], { cwd: ROOT, env: { ...process.env, R }, stdio: 'ignore' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`step failed (${code}): ${cmd.slice(0, 120)}`))))
    child.on('error', reject)
  })
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  fs.mkdirSync(RAW_DIR, { recursive: true })
  const rawPath = path.join(RAW_DIR, `${f.name}.raw.mp4`)
  const marksPath = path.join(RAW_DIR, `${f.name}.json`)
  if (f.recut) {
    console.log(JSON.stringify(cut(rawPath, JSON.parse(fs.readFileSync(marksPath, 'utf8')) as Marks, f.name, Number(f.work))))
    return
  }
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-frames-'))
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: !f.headed,
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'],
  })
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const t0 = Date.now()
  const now = () => (Date.now() - t0) / 1000
  const marks: Marks = { prompts: [], end: 0 }
  const stopCapture = await startCapture(page, frameDir, t0)
  await page.goto(f.url)
  await page.waitForSelector('.nc-chatbar textarea')
  await sleep(2500)
  if (f.focus) await page.evaluate((id) => (globalThis as unknown as NcWindow).__nc.focus(id), f.focus)
  await page.evaluate(() => (globalThis as unknown as NcWindow).__nc.autoRotate(true))
  await sleep(Number(f.intro) * 1000)

  const box = page.locator('.nc-chatbar textarea')
  const type = async (prompt: string) => {
    await box.click()
    await box.pressSequentially(prompt, { delay: 55 })
    await sleep(500)
  }

  if (f.steps) {
    // Self-driving: each step's real pipeline commands run right away, no listener in the loop.
    const steps = JSON.parse(fs.readFileSync(f.steps, 'utf8')) as { prompt: string; cmd: string }[]
    for (const { prompt, cmd } of steps) {
      await type(prompt)
      await box.fill('')
      const sent = now()
      const R = `${prompt} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      await run(`npm run -s nc -- say "${prompt.replace(/"/g, '\\"')}" --run "$R" && ${cmd}`, R)
      marks.prompts.push({ sent, done: now() })
      await sleep(Number(f.hold) * 1000)
    }
  }

  for (const prompt of f.prompt) {
    await type(prompt)
    await page.keyboard.press('Enter')
    const sent = now()
    await waitForWork(page, Number(f.timeout))
    marks.prompts.push({ sent, done: now() })
    await sleep(Number(f.hold) * 1000)
  }
  marks.end = now()

  const frames = await stopCapture(rawPath, marks.end * 1000)
  await context.close()
  await browser.close()
  fs.writeFileSync(marksPath, JSON.stringify(marks, null, 2))
  fs.rmSync(frameDir, { recursive: true, force: true })
  console.log(JSON.stringify({ frames, ...cut(rawPath, marks, f.name, Number(f.work)) }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
