import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { KINDS, RIG_TYPES, type AssetMeta, type Kind } from '../shared/meta.ts'
import { beginRun, emit, endRun, step, useRun } from './activity.ts'
import { ack, finishWork, heartbeat, pendingMessages, stopListening, superseded } from './inbox.ts'
import { animate, loadMeta, make, retexture, type RigOption } from './make.ts'
import { Tripo } from './providers/tripo.ts'
import { downloadThumbnail, search } from './providers/sketchfab.ts'
import { resolveAt, spawn } from './steps/spawn.ts'
import { ASSETS_DIR, ENTITIES_DIR, STATE_DIR, readJson } from './util.ts'

const HELP = `NeuroCraft asset pipeline

  nc make "<prompt>" --id <id> [--kind ${KINDS.join('|')}] [--from sketchfab:<uid>|tripo:<task>|file:<path>]
          [--image <path|url>] [--rig auto|none|${RIG_TYPES.join('|')}] [--anims walk,idle] [--height <m>]
          [--at x,z] [--no-spawn] [--name <entityId>] [--force] [--compress] [--faces <n>] [--detailed]
  nc search "<query>" [--animated] [--rigged] [--max-faces <n>] [--count <n>] [--sort likes|views|recent] [--thumbs]
  nc animate <id> <preset...>          e.g. nc animate knight jump dance_01   (biped:  idle walk run jump ...)
  nc retexture <id> "<texture prompt>" regenerate textures (re-rigs automatically)
  nc spawn <id> [--at x,z] [--name <entityId>] [--force]
  nc list                              assets + entity files
  nc status                            cursor ("here"), selection ("it"), live scene
  nc task <taskId>                     inspect a Tripo task
  nc balance                           Tripo credit balance
  nc log "<message>" --run "<user request>" [--done|--error] [--image <url|preview file>] [--focus <entityId>]
                                       narrate a step in the in-page activity feed
  nc inbox [--wait [--timeout 240]] [--stop]
                                       browser text box relay: list queued messages, block until one arrives
                                       (prints {message, run}), or mark this chat as no longer listening

  Global: --run "<user request>"  group this command's steps under the user's request in the activity feed
`

const { values: f, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: 'string' },
    kind: { type: 'string', default: 'prop' },
    from: { type: 'string' },
    image: { type: 'string' },
    rig: { type: 'string' },
    anims: { type: 'string' },
    height: { type: 'string' },
    at: { type: 'string' },
    name: { type: 'string' },
    'no-spawn': { type: 'boolean' },
    force: { type: 'boolean' },
    compress: { type: 'boolean' },
    faces: { type: 'string' },
    detailed: { type: 'boolean' },
    animated: { type: 'boolean' },
    rigged: { type: 'boolean' },
    'max-faces': { type: 'string' },
    count: { type: 'string' },
    sort: { type: 'string' },
    thumbs: { type: 'boolean' },
    run: { type: 'string' },
    wait: { type: 'boolean' },
    focus: { type: 'string' },
    stop: { type: 'boolean' },
    timeout: { type: 'string' },
    done: { type: 'boolean' },
    error: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
})

const num = (v?: string) => (v === undefined ? undefined : Number(v))
const [cmd, ...args] = positionals

async function doSpawn(meta: AssetMeta) {
  const at = await resolveAt(f.at)
  await step('spawn', 'Placing it in the world', async (s) => {
    const file = path.relative(process.cwd(), await spawn(meta, { name: f.name, at, force: f.force }))
    s.done(`Placed at (${at[0]}, ${at[1]})`)
    s.focus(f.name ?? meta.id)
    console.log(`spawned ${file}`)
  })
}

function printMeta(m: AssetMeta) {
  console.log(JSON.stringify({ id: m.id, kind: m.kind, rigType: m.rigType, clips: m.clips, bones: m.bones.length, height: m.height, defaultHeight: m.defaultHeight, triangles: m.triangles, credits: m.credits, source: m.source.type }))
}

async function main() {
  switch (cmd) {
    case 'make': {
      const prompt = args.join(' ')
      if (!prompt || !f.id) throw new Error('make needs "<prompt>" and --id')
      if (!/^[a-z][a-z0-9-]*$/.test(f.id)) throw new Error('--id must be kebab-case, e.g. red-dragon')
      if (!KINDS.includes(f.kind as Kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')}`)
      if (f.rig && f.rig !== 'auto' && f.rig !== 'none' && !RIG_TYPES.includes(f.rig as never)) throw new Error(`bad --rig ${f.rig}`)
      const meta = await make({
        id: f.id,
        prompt,
        kind: f.kind as Kind,
        from: f.from,
        image: f.image,
        rig: f.rig as RigOption | undefined,
        anims: f.anims?.split(',').filter(Boolean),
        height: num(f.height),
        compress: f.compress,
        faceLimit: num(f.faces),
        quality: f.detailed ? 'detailed' : 'standard',
      })
      printMeta(meta)
      if (!f['no-spawn']) await doSpawn(meta)
      return
    }
    case 'search': {
      const q = args.join(' ')
      await step('search', `Looking for "${q}"`, async (s) => {
        const results = await search(q, { animated: f.animated, rigged: f.rigged, maxFaces: num(f['max-faces']), count: num(f.count), sort: f.sort as never })
        s.images(results.map((c) => ({ url: c.thumbnail, caption: `${c.name} · ${c.faces.toLocaleString()} faces · ${c.animations} anims` })))
        for (const c of results) {
          const thumb = f.thumbs ? await downloadThumbnail(c).catch(() => '') : c.thumbnail
          console.log(`${c.uid}  ${c.name}  | by ${c.author} | ${c.license} | ${c.faces} faces | ${c.animations} anims | ${c.glbMB}MB | ${c.likes} likes\n    ${thumb}`)
        }
        if (!results.length) console.log('no downloadable results')
        s.done(`Found ${results.length} option${results.length === 1 ? '' : 's'}`)
      })
      return
    }
    case 'animate': {
      const [id, ...anims] = args
      if (!id || !anims.length) throw new Error('animate <id> <preset...>')
      printMeta(await animate(id, anims, f.compress))
      return
    }
    case 'retexture': {
      const [id, ...rest] = args
      if (!id || !rest.length) throw new Error('retexture <id> "<prompt>"')
      printMeta(await retexture(id, rest.join(' '), f.compress))
      return
    }
    case 'spawn':
      if (!args[0]) throw new Error('spawn <id>')
      return doSpawn(await loadMeta(args[0]))
    case 'list': {
      const ids = await fs.readdir(ASSETS_DIR).catch(() => [] as string[])
      for (const id of ids) {
        const m = await readJson<AssetMeta>(path.join(ASSETS_DIR, id, 'meta.json'))
        if (m) printMeta(m)
      }
      const entities = await fs.readdir(ENTITIES_DIR).catch(() => [] as string[])
      console.log(`entities: ${entities.filter((e) => e.endsWith('.tsx')).join(', ') || '(none)'}`)
      return
    }
    case 'status':
      for (const k of ['cursor', 'selection', 'scene']) {
        console.log(`${k}: ${JSON.stringify(await readJson(path.join(STATE_DIR, `${k}.json`)))}`)
      }
      return
    case 'task':
      console.log(JSON.stringify(await new Tripo().getTask(args[0]), null, 2))
      return
    case 'balance':
      console.log(JSON.stringify(await new Tripo().balance()))
      return
    case 'inbox': {
      if (f.stop) {
        stopListening()
        console.log('stopped listening')
        return
      }
      if (!f.wait) {
        console.log(JSON.stringify(pendingMessages(), null, 2))
        return
      }
      const deadline = Date.now() + (num(f.timeout) ?? 240) * 1000
      heartbeat('listening')
      while (Date.now() < deadline) {
        if (superseded()) {
          console.log(JSON.stringify({ message: null, stopped: true }))
          return
        }
        const [next] = pendingMessages()
        if (next) {
          ack(next.id)
          heartbeat('working', next.run)
          useRun(next.run)
          emit({ source: 'agent', status: 'info', message: 'On it' })
          console.log(JSON.stringify({ message: next.message, run: next.run, queuedAfter: pendingMessages().length }))
          return
        }
        heartbeat('listening')
        await new Promise((r) => setTimeout(r, 700))
      }
      console.log(JSON.stringify({ message: null }))
      return
    }
    case 'say': {
      const message = args.join(' ')
      if (!message || !f.run) throw new Error('say "<message>" --run "<title>"')
      useRun(f.run)
      emit({ source: 'user', status: 'start', message })
      return
    }
    case 'log': {
      const message = args.join(' ')
      if (!message) throw new Error('log "<message>" --run "<user request>"')
      useRun(f.run ?? 'Agent')
      const images = f.image ? [{ url: f.image }] : undefined
      emit({ source: 'agent', status: f.done ? 'done' : f.error ? 'error' : 'info', message, images, focus: f.focus })
      if ((f.done || f.error) && f.run) finishWork(f.run)
      return
    }
    default:
      console.log(HELP)
  }
}

/** Commands that do work are reported to the in-page activity feed. */
const TRACKED = new Set(['make', 'search', 'animate', 'retexture', 'spawn'])

async function run() {
  if (!TRACKED.has(cmd)) return main()
  const commandLine = `nc ${process.argv.slice(2).filter((a, i, all) => a !== '--run' && all[i - 1] !== '--run').join(' ')}`
  beginRun(f.run ?? commandLine, { shared: !!f.run, message: `$ ${commandLine}` })
  try {
    await main()
    endRun(true, `Finished: ${cmd}`)
  } catch (e) {
    endRun(false, `Failed: ${e instanceof Error ? e.message : e}`)
    throw e
  }
}

run().catch((e) => {
  console.error(`error: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
