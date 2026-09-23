import type { AssetMeta } from '../../shared/meta'

const metas = import.meta.glob<AssetMeta>('/assets/*/meta.json', { eager: true, import: 'default' })
const files = import.meta.glob<string>('/assets/*/*.glb', { eager: true, query: '?url', import: 'default' })

export interface Asset {
  meta: AssetMeta
  url: string
}

export function getAsset(id: string): Asset {
  const meta = metas[`/assets/${id}/meta.json`]
  const url = meta && files[`/assets/${id}/${meta.file}`]
  if (!meta || !url) throw new Error(`Asset "${id}" not found. Run: npm run nc -- make "<prompt>" --id ${id}`)
  return { meta, url }
}

export const allAssets = (): AssetMeta[] => Object.values(metas)
