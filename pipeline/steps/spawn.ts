import fs from 'node:fs/promises'
import path from 'node:path'
import type { AssetMeta } from '../../shared/meta.ts'
import { ENTITIES_DIR, STATE_DIR, readJson, toPascal } from '../util.ts'

export async function resolveAt(at?: string): Promise<[number, number]> {
  if (at) {
    const [x, z] = at.split(',').map(Number)
    if (Number.isFinite(x) && Number.isFinite(z)) return [x, z]
    throw new Error(`Invalid --at "${at}", expected x,z`)
  }
  const cursor = await readJson<{ x: number; z: number }>(path.join(STATE_DIR, 'cursor.json'))
  return cursor ? [round(cursor.x), round(cursor.z)] : [0, 0]
}

const round = (n: number) => Math.round(n * 10) / 10

function behaviorHint(meta: AssetMeta): string {
  switch (meta.kind) {
    case 'vehicle':
      return `{/* e.g. wrap in <Drive radius={15}> and add <SpinNodes match={/wheel/i} /> inside <Entity> */}`
    case 'plant':
      return `{/* e.g. wrap in <Sway> */}`
    case 'character':
    case 'creature':
      return `{/* e.g. wrap in <Wander radius={10}> or <Fly radius={20} altitude={12}>${meta.bones.length ? `; bones: ${meta.bones.slice(0, 8).join(', ')}${meta.bones.length > 8 ? ', …' : ''}` : ''} */}`
    default:
      return ''
  }
}

export async function spawn(meta: AssetMeta, opts: { name?: string; at: [number, number]; force?: boolean }) {
  const name = opts.name ?? meta.id
  const file = path.join(ENTITIES_DIR, `${name}.tsx`)
  const exists = await fs.stat(file).then(() => true, () => false)
  if (exists && !opts.force) throw new Error(`${path.relative(process.cwd(), file)} exists; pass --force or --name`)
  const hint = behaviorHint(meta)
  const src = `import { Entity, Place } from '../engine'

/** ${meta.prompt.replace(/\*\//g, '')} (${meta.kind}${meta.rigType ? `, ${meta.rigType} rig` : ''}${meta.clips.length ? `, clips: ${meta.clips.join(', ')}` : ''}) */
export default function ${toPascal(name)}() {
  return (
    <Place at={[${opts.at[0]}, ${opts.at[1]}]}>
      ${hint ? `${hint}\n      ` : ''}<Entity asset="${meta.id}"${name !== meta.id ? ` id="${name}"` : ''} />
    </Place>
  )
}
`
  await fs.mkdir(ENTITIES_DIR, { recursive: true })
  await fs.writeFile(file, src)
  return file
}
