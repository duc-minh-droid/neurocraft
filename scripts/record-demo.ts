/**
 * Records a demo clip of the real flow: types prompts into the chat bar, waits for the world to change, orbits the camera.
 *   npx tsx scripts/record-demo.ts --name castle --prompt "add a castle on the hill" [--prompt "..."] [--hold 5]
 * Someone (Devin, listening via `nc inbox --wait`) must handle the prompts while this runs.
 * Outputs docs/media/<name>.mp4 and docs/media/<name>.gif.
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
  },
})

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'docs', 'media')
const W = 1280
const H = 720
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type NcWindow = { __nc: { autoRotate: (on: boolean) => void; focus: (id: string) => void } }

const panelHead = (page: Page) => page.locator('.nc-act-head').innerText().catch(() => '')

async function waitForWork(page: Page, timeoutS: number) {
  const start = Date.now()
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
  const mp4 = path.join(OUT, `${name}.mp4`)
  const gif = path.join(OUT, `${name}.gif`)
  execFileSync(ff, ['-y', '-i', raw, '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', mp4], { stdio: 'ignore' })
  execFileSync(
    ff,
    ['-y', '-i', mp4, '-vf', 'fps=9,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', gif],
    { stdio: 'ignore' },
  )
  const size = (p: string) => +(fs.statSync(p).size / 1e6).toFixed(1)
  const seconds = parts.reduce((s, p) => s + (p.to - p.from) / p.speed, 0)
  return { mp4, gif, mp4MB: size(mp4), gifMB: size(gif), seconds: +seconds.toFixed(1) }
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
  const rawPath = path.join(RAW_DIR, `${f.name}.webm`)
  const marksPath = path.join(RAW_DIR, `${f.name}.json`)
  if (f.recut) {
    console.log(JSON.stringify(cut(rawPath, JSON.parse(fs.readFileSync(marksPath, 'utf8')) as Marks, f.name, Number(f.work))))
    return
  }
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-video-'))
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: !f.headed,
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'],
  })
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: videoDir, size: { width: W, height: H } } })
  const page = await context.newPage()
  const t0 = Date.now()
  const now = () => (Date.now() - t0) / 1000
  const marks: Marks = { prompts: [], end: 0 }
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

  const video = page.video()
  await context.close()
  await browser.close()
  fs.copyFileSync((await video!.path()), rawPath)
  fs.writeFileSync(marksPath, JSON.stringify(marks, null, 2))
  fs.rmSync(videoDir, { recursive: true, force: true })
  console.log(JSON.stringify(cut(rawPath, marks, f.name, Number(f.work))))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
