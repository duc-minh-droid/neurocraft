import fs from 'node:fs'
import path from 'node:path'
import { ASSET_INDEX, type AssetMeta } from '../shared/meta.ts'
import { ASSETS_DIR } from './util.ts'

export const ASSET_INDEX_FILE = path.join(ASSETS_DIR, ASSET_INDEX)

/** Rebuilds public/assets/index.json from every public/assets/<id>/meta.json. */
export function writeAssetIndex(): AssetMeta[] {
  const metas = fs.existsSync(ASSETS_DIR)
    ? fs.readdirSync(ASSETS_DIR).flatMap((id) => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, id, 'meta.json'), 'utf8')) as AssetMeta]
        } catch {
          return []
        }
      })
    : []
  fs.mkdirSync(ASSETS_DIR, { recursive: true })
  fs.writeFileSync(ASSET_INDEX_FILE, JSON.stringify(metas, null, 1) + '\n')
  return metas
}
