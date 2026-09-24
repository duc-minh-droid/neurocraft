import { useSyncExternalStore } from 'react'
import { ASSETS_EVENT, type AssetMeta } from '../../shared/meta'

/*
 * Runtime asset registry: /assets/index.json (public/), refreshed live over the dev websocket.
 * Deliberately not bundled with import.meta.glob: adding a model would otherwise force a full page reload.
 * Keep this module free of imports that change at runtime so its subscription survives hot updates.
 */

let metas: Record<string, AssetMeta> = {}
let loaded = false
const listeners = new Set<() => void>()

function set(list: AssetMeta[]) {
  metas = Object.fromEntries(list.map((m) => [m.id, m]))
  loaded = true
  listeners.forEach((l) => l())
}

const load = () =>
  fetch(`${import.meta.env.BASE_URL}assets/index.json`, { cache: 'no-store' })
    .then((r) => r.json() as Promise<AssetMeta[]>)
    .then(set)
    .catch(() => set([]))

void load()
import.meta.hot?.on(ASSETS_EVENT, set)

export interface Asset {
  meta: AssetMeta
  url: string
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l))

/** Re-renders when the registry changes. */
export function useAssets(): { loaded: boolean; metas: Record<string, AssetMeta> } {
  const snapshot = useSyncExternalStore(subscribe, () => metas)
  return { loaded, metas: snapshot }
}

export function getAsset(id: string): Asset | null {
  const meta = metas[id]
  return meta ? { meta, url: `${import.meta.env.BASE_URL}assets/${id}/${meta.file}?v=${encodeURIComponent(meta.createdAt)}` } : null
}

export const allAssets = (): AssetMeta[] => Object.values(metas)
export const hasAsset = (id: string) => !!metas[id]
