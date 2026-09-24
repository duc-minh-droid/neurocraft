/** Sends messages to the running world's chat bar backend and prints each run's steps: npx tsx scripts/say.ts "msg" ["msg"...] */
export {}
const BASE = process.env.NC_URL ?? 'http://localhost:5173'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Ev { ts: number; run: string; runTitle?: string; step?: string; status: string; message: string; source: string }

for (const message of process.argv.slice(2)) {
  const t0 = Date.now()
  await fetch(`${BASE}/__nc/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) })
  await sleep(300)
  while (((await (await fetch(`${BASE}/__nc/chat/status`)).json()) as { busy: boolean }).busy) await sleep(400)
  const events = (await (await fetch(`${BASE}/__nc/activity`)).json()) as Ev[]
  const mine = events.filter((e) => e.ts >= t0 - 50 && e.runTitle?.startsWith(message.slice(0, 40)))
  console.log(`\n> ${message}   (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  for (const e of mine) if (e.status !== 'start' && e.status !== 'progress') console.log(`   ${e.status === 'error' ? '✕' : e.status === 'done' ? '✓' : '•'} ${e.source === 'agent' ? 'AI: ' : ''}${e.message}`)
}
