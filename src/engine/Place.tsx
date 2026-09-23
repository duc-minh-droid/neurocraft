import { createContext, use, useMemo, type ReactNode } from 'react'
import { heightAt } from '../world/heightfield'

type V3 = [number, number, number]
const PlaceContext = createContext<V3>([0, 0, 0])

export interface PlaceProps {
  /** [x, z] snaps to terrain; [x, y, z] uses absolute y. */
  at: [number, number] | V3
  /** Extra height above the ground. */
  offset?: number
  children: ReactNode
}

/** Positions its children in the world. Pure translation, so motion behaviors inside can resolve terrain correctly. */
export function Place({ at, offset = 0, children }: PlaceProps) {
  const [x, y, z] = at.length === 3 ? at : [at[0], heightAt(at[0], at[1]), at[1]]
  const pos: V3 = [x, y + offset, z]
  return (
    <PlaceContext value={pos}>
      <group position={pos}>{children}</group>
    </PlaceContext>
  )
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ScatterItem {
  index: number
  /** Random 0..360 yaw in degrees. */
  rotation: number
  /** Random multiplier within scaleRange. */
  scale: number
}

export interface ScatterProps {
  count: number
  radius: number
  seed?: number
  scaleRange?: [number, number]
  /** Minimum distance between items. */
  spacing?: number
  /** Skip spots below this terrain height (e.g. WATER_LEVEL + 0.3 to stay on land). */
  minHeight?: number
  children: (item: ScatterItem) => ReactNode
}

/** Deterministically scatters `count` copies around the parent <Place>, each snapped to terrain. */
export function Scatter({ count, radius, seed = 1, scaleRange = [0.8, 1.2], spacing = 0, minHeight = -Infinity, children }: ScatterProps) {
  const [ox, oy, oz] = use(PlaceContext)
  const [smin, smax] = scaleRange
  const items = useMemo(() => {
    const rand = mulberry32(seed)
    const out: (ScatterItem & { pos: V3 })[] = []
    for (let tries = 0; out.length < count && tries < count * 30; tries++) {
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(rand()) * radius
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const h = heightAt(ox + x, oz + z)
      if (h < minHeight) continue
      if (spacing && out.some((o) => Math.hypot(o.pos[0] - x, o.pos[2] - z) < spacing)) continue
      out.push({ index: out.length, pos: [x, h - oy, z], rotation: rand() * 360, scale: smin + rand() * (smax - smin) })
    }
    return out
  }, [count, radius, seed, smin, smax, spacing, minHeight, ox, oy, oz])

  return (
    <>
      {items.map((it) => (
        <group key={it.index} position={it.pos}>
          {children(it)}
        </group>
      ))}
    </>
  )
}
