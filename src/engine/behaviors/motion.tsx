import { useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { heightAt, WATER_LEVEL } from '../../world/heightfield'

/*
 * Motion wrappers move their children. They are meant to sit inside <Place>; all coordinates are relative
 * to the parent's position, and ground/altitude are resolved against the real terrain in world space.
 * Models are assumed to face +Z (fix with <Entity rotation={deg}>).
 */

type XZ = [number, number]
const _parent = new THREE.Vector3()

function parentWorld(group: THREE.Group) {
  return group.parent ? group.parent.getWorldPosition(_parent) : _parent.set(0, 0, 0)
}

const ground = (x: number, z: number) => Math.max(heightAt(x, z), WATER_LEVEL)

function buildCurve(path: 'circle' | 'figure8' | XZ[], center: XZ, radius: number) {
  let pts: XZ[]
  if (path === 'circle') pts = Array.from({ length: 24 }, (_, i) => [Math.cos((i / 24) * Math.PI * 2) * radius, Math.sin((i / 24) * Math.PI * 2) * radius])
  else if (path === 'figure8')
    pts = Array.from({ length: 32 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2
      const d = 1 + Math.sin(a) ** 2
      return [(radius * Math.cos(a)) / d, (radius * Math.sin(a) * Math.cos(a)) / d]
    })
  else return new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)), true)
  return new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x + center[0], 0, z + center[1])), true)
}

export interface PathMotionProps {
  children: ReactNode
  /** 'circle' | 'figure8' around `center`, or a closed loop of [x, z] waypoints relative to the parent. */
  path?: 'circle' | 'figure8' | XZ[]
  center?: XZ
  radius?: number
  /** Meters per second. */
  speed?: number
  /** Height above ground (terrain/water); ignored when `grounded`. */
  altitude?: number
  grounded?: boolean
  /** Absolute world Y instead of terrain-relative altitude (e.g. underwater). */
  absoluteY?: number
  /** 0..2, how much to roll into turns. */
  bank?: number
  /** Vertical bob amplitude in meters. */
  bob?: number
  bobHz?: number
  /** 0..1 start offset along the path. */
  phase?: number
  reverse?: boolean
}

export function PathMotion({ children, path = 'circle', center = [0, 0], radius = 15, speed = 5, altitude = 0, grounded = false, absoluteY, bank = 0, bob = 0, bobHz = 0.5, phase = 0, reverse = false }: PathMotionProps) {
  const ref = useRef<THREE.Group>(null)
  const pathKey = JSON.stringify(path)
  const [cx, cz] = center
  const curve = useMemo(() => buildCurve(JSON.parse(pathKey), [cx, cz], radius), [pathKey, cx, cz, radius])
  const length = useMemo(() => curve.getLength(), [curve])
  const state = useRef({ roll: 0, y: NaN })

  useFrame(({ clock }, dt) => {
    const g = ref.current
    if (!g) return
    const origin = parentWorld(g)
    const dir = reverse ? -1 : 1
    const u = (((clock.elapsedTime * speed * dir) / length + phase) % 1 + 1) % 1
    const du = 0.01 * dir
    const p = curve.getPointAt(u)
    const t0 = curve.getTangentAt(u).multiplyScalar(dir)
    const t1 = curve.getTangentAt((u + du + 1) % 1).multiplyScalar(dir)

    const wx = origin.x + p.x
    const wz = origin.z + p.z
    const targetY = absoluteY ?? (grounded ? heightAt(wx, wz) : ground(wx, wz) + altitude)
    const s = state.current
    s.y = Number.isNaN(s.y) || grounded ? targetY : THREE.MathUtils.damp(s.y, targetY, 1.5, dt)
    const y = s.y + bob * Math.sin(clock.elapsedTime * Math.PI * 2 * bobHz)

    const yaw = Math.atan2(t0.x, t0.z)
    const turn = Math.atan2(t0.x * t1.z - t0.z * t1.x, t0.x * t1.x + t0.z * t1.z)
    const yawRate = turn / ((Math.abs(du) * length) / Math.max(speed, 0.01))
    s.roll = THREE.MathUtils.damp(s.roll, THREE.MathUtils.clamp(yawRate * bank * 0.5, -0.9, 0.9), 3, dt)

    g.position.set(p.x, y - origin.y, p.z)
    g.rotation.set(0, yaw, s.roll, 'YXZ')
  })

  return <group ref={ref}>{children}</group>
}

/** Airborne path with banking and gentle bob. */
export const Fly = (p: PathMotionProps) => <PathMotion altitude={12} bank={1} bob={0.6} speed={8} radius={25} {...p} />
/** Ground-hugging path (cars, trains, walkers on a route). */
export const Drive = (p: PathMotionProps) => <PathMotion grounded speed={6} {...p} />
/** Underwater path at fixed depth below the water surface. */
export const Swim = ({ depth = 1.5, ...p }: PathMotionProps & { depth?: number }) => (
  <PathMotion absoluteY={WATER_LEVEL - depth} bank={0.6} bob={0.2} speed={2} radius={8} {...p} />
)

export interface WanderProps {
  children: ReactNode
  center?: XZ
  radius?: number
  speed?: number
  /** Radians per second. */
  turnRate?: number
  /** Stay above water. */
  avoidWater?: boolean
}

/** Random roaming on the terrain within a radius. */
export function Wander({ children, center = [0, 0], radius = 10, speed = 1.5, turnRate = 1.5, avoidWater = true }: WanderProps) {
  const ref = useRef<THREE.Group>(null)
  const s = useRef({ x: center[0], z: center[1], yaw: 0, tx: center[0], tz: center[1] })

  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    const origin = parentWorld(g)
    const st = s.current
    const pickTarget = () => {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2
        const r = Math.sqrt(Math.random()) * radius
        st.tx = center[0] + Math.cos(a) * r
        st.tz = center[1] + Math.sin(a) * r
        if (!avoidWater || heightAt(origin.x + st.tx, origin.z + st.tz) > WATER_LEVEL + 0.3) return
      }
    }
    if (Math.hypot(st.tx - st.x, st.tz - st.z) < 0.5) pickTarget()
    const want = Math.atan2(st.tx - st.x, st.tz - st.z)
    let diff = want - st.yaw
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    st.yaw += THREE.MathUtils.clamp(diff, -turnRate * dt, turnRate * dt)
    const step = speed * dt * Math.max(0, Math.cos(diff))
    st.x += Math.sin(st.yaw) * step
    st.z += Math.cos(st.yaw) * step
    g.position.set(st.x, heightAt(origin.x + st.x, origin.z + st.z) - origin.y, st.z)
    g.rotation.set(0, st.yaw, 0)
  })

  return <group ref={ref}>{children}</group>
}

/** Bob up and down in place. */
export function Float({ children, amplitude = 0.5, frequency = 0.4 }: { children: ReactNode; amplitude?: number; frequency?: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => ref.current && (ref.current.position.y = amplitude * (1 + Math.sin(clock.elapsedTime * Math.PI * 2 * frequency))))
  return <group ref={ref}>{children}</group>
}

/** Rotate in place (radians per second). */
export function Spin({ children, speed = 1, axis = 'y' }: { children: ReactNode; speed?: number; axis?: 'x' | 'y' | 'z' }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, dt) => ref.current && (ref.current.rotation[axis] += speed * dt))
  return <group ref={ref}>{children}</group>
}

/** Gentle wind sway pivoting at the base (plants, flags, lamps). */
export function Sway({ children, amplitude = 0.04, frequency = 0.3 }: { children: ReactNode; amplitude?: number; frequency?: number }) {
  const ref = useRef<THREE.Group>(null)
  const seed = useMemo(() => Math.random() * 100, [])
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.elapsedTime * Math.PI * 2 * frequency + seed
    ref.current.rotation.set(amplitude * Math.sin(t), 0, amplitude * 0.7 * Math.sin(t * 1.3 + 1))
  })
  return <group ref={ref}>{children}</group>
}
