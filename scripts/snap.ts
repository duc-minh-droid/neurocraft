/** Headless still of the running world: npx tsx scripts/snap.ts <out.png> [url] [waitMs] */
import { chromium } from 'playwright'

const [out = 'snap.png', url = 'http://localhost:5173/', wait = '4000'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url)
await page.waitForTimeout(Number(wait))
await page.screenshot({ path: out })
await browser.close()
console.log(out)
