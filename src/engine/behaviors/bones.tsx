import { useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useEntity } from '../entityContext'

type Axis = 'x' | 'y' | 'z'
const AXES: Record<Axis, THREE.Vector3> = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }
const LEFT = /left|(^|[^a-z])l([^a-z]|$)/i
const RIGHT = /right|(^|[^a-z])r([^a-z]|$)/i

interface Target {
  object: THREE.Object3D
  rest: THREE.Quaternion
  side: number
}

/**
 * Procedural rotation on top of the animation mixer. Each frame: reset matched objects to rest pose (priority -2),
 * let the mixer write clip poses (priority -1), then apply `offset` (priority 0) so procedural motion layers additively.
 */
function useProcedural(match: RegExp, axis: Axis, offset: (i: number, t: number, target: Target, count: number) => number) {
  const { scene } = useEntity()
  const { source, flags } = match
  const targets = useMemo(() => {
    const re = new RegExp(source, flags.replace('g', ''))
    const list: Target[] = []
    scene.traverse((o) => {
      if (!re.test(o.name)) return
      list.push({ object: o, rest: o.quaternion.clone(), side: RIGHT.test(o.name) && !LEFT.test(o.name) ? -1 : 1 })
    })
    if (!list.length) console.warn(`[behaviors] no bones/nodes match ${re}`)
    return list
  }, [scene, source, flags])

  const q = useMemo(() => new THREE.Quaternion(), [])
  useFrame(() => targets.forEach((t) => t.object.quaternion.copy(t.rest)), -2)
  useFrame(({ clock }) => {
    targets.forEach((t, i) => t.object.quaternion.multiply(q.setFromAxisAngle(AXES[axis], offset(i, clock.elapsedTime, t, targets.length))))
  })
  return null
}

export interface FlapProps {
  /** Regex against bone names from meta.json, e.g. /wing/i */
  match: RegExp
  /** Radians. */
  amplitude?: number
  /** Beats per second. */
  frequency?: number
  axis?: Axis
  /** Mirror direction for right-side bones (names containing R/right). */
  mirror?: boolean
}

/** Flapping: wings, fins, ears, flags. */
export function FlapBones({ match, amplitude = 0.6, frequency = 1.5, axis = 'z', mirror = true }: FlapProps) {
  return useProcedural(match, axis, (_, t, target) => amplitude * Math.sin(t * Math.PI * 2 * frequency) * (mirror ? target.side : 1))
}

export interface WiggleProps {
  match: RegExp
  amplitude?: number
  frequency?: number
  /** Phase delay per bone along the chain (radians); creates a travelling wave. */
  phase?: number
  axis?: Axis
}

/** Travelling wave along a bone chain: tails, snakes, fish, tentacles. */
export function WiggleBones({ match, amplitude = 0.25, frequency = 1, phase = 0.6, axis = 'y' }: WiggleProps) {
  return useProcedural(match, axis, (i, t) => amplitude * Math.sin(t * Math.PI * 2 * frequency - i * phase))
}

export interface SpinNodesProps {
  match: RegExp
  /** Radians per second. */
  speed?: number
  axis?: Axis
}

/** Continuous rotation of named nodes: wheels, rotors, propellers, fans. */
export function SpinNodes({ match, speed = 6, axis = 'x' }: SpinNodesProps) {
  return useProcedural(match, axis, (_, t) => t * speed)
}
