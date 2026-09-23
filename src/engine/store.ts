import { useSyncExternalStore } from 'react'
import type { Object3D } from 'three'

interface State {
  cursor: [number, number, number] | null
  selection: string | null
}

let state: State = { cursor: null, selection: null }
const listeners = new Set<() => void>()

export function setState(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => select(state),
  )
}

/** Live entity roots, used for the scene report sent to the CLI. */
export const entities = new Map<string, { asset: string; object: Object3D; size: [number, number, number] }>()

/** Camera direction requests, consumed by CameraDirector in the world. */
export const cameraDirector = { focusId: null as string | null, requestedAt: 0, autoRotate: false }

export function focusEntity(id: string) {
  cameraDirector.focusId = id
  cameraDirector.requestedAt = performance.now()
}

export function setAutoRotate(on: boolean) {
  cameraDirector.autoRotate = on
}

export const findEntity = (idOrAsset: string) => entities.get(idOrAsset) ?? [...entities.values()].find((e) => e.asset === idOrAsset)

if (import.meta.env.DEV) Object.assign(window, { __nc: { entities, focus: focusEntity, autoRotate: setAutoRotate } })

export function report(key: 'cursor' | 'selection' | 'scene', data: unknown) {
  if (!import.meta.env.DEV) return
  fetch(`/__nc/${key}`, { method: 'POST', body: JSON.stringify(data) }).catch(() => {})
}
