import { useSyncExternalStore } from 'react'
import initialWorld from '../../world.json'
import { WORLD_EVENT, type WorldState } from '../../shared/world'

/*
 * Live world state, kept in its own tiny module on purpose: it must not import anything that changes at runtime
 * (like the asset registry, which hot-reloads whenever a new model is downloaded). If this module were hot-replaced,
 * its websocket subscription would be dropped and the page would stop receiving world updates.
 */

let world = initialWorld as WorldState
const listeners = new Set<() => void>()

function set(next: WorldState) {
  world = next
  listeners.forEach((l) => l())
}

if (import.meta.hot) {
  import.meta.hot.on(WORLD_EVENT, set)
  fetch('/__nc/world')
    .then((r) => r.json() as Promise<WorldState>)
    .then(set)
    .catch(() => {})
}

export function useWorld(): WorldState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => world,
  )
}
