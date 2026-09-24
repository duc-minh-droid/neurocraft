import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Sky } from '@react-three/drei'
import { Terrain } from './Terrain'
import { cameraDirector, entities, findEntity, report, setState } from '../engine/store'
import type { TimeOfDay } from '../../shared/world'

/** Lighting presets, selected by world.json `time`. */
const TIMES: Record<TimeOfDay, {
  sun: readonly [number, number, number]
  lightPos: readonly [number, number, number]
  sky: string
  fog: string
  skyTop: string
  ground: string
  ambient: number
  light: string
  intensity: number
  turbidity: number
  rayleigh: number
  water: string
}> = {
  day: { sun: [80, 120, 40], lightPos: [80, 120, 40], sky: '#9cc7e8', fog: '#b8d4ea', skyTop: '#dbeeff', ground: '#4a5a3a', ambient: 0.8, light: '#ffffff', intensity: 2.2, turbidity: 4, rayleigh: 1.2, water: '#2b6f9e' },
  sunset: { sun: [-160, 14, -90], lightPos: [-160, 40, -90], sky: '#f2a36b', fog: '#e9a27a', skyTop: '#ffc9a1', ground: '#3b3144', ambient: 0.75, light: '#ffb070', intensity: 2.4, turbidity: 8, rayleigh: 3, water: '#3d5f8a' },
  night: { sun: [-60, -30, -100], lightPos: [60, 90, 100], sky: '#0b1426', fog: '#0e1a30', skyTop: '#2a3b66', ground: '#0c0f18', ambient: 0.35, light: '#9fb6ff', intensity: 0.6, turbidity: 1, rayleigh: 0.2, water: '#16284a' },
}

/** Every 2s, report live entity world transforms so the CLI agent can reason about "next to the house". */
function SceneReporter() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null
  useEffect(() => {
    const p = new THREE.Vector3()
    const id = setInterval(() => {
      const list = [...entities].map(([key, { asset, object, size }]) => {
        object.getWorldPosition(p)
        return { id: key, asset, position: p.toArray().map(r), size: size.map(r) }
      })
      const cam = { position: camera.position.toArray().map(r), target: (controls?.target ?? new THREE.Vector3()).toArray().map(r) }
      report('scene', { entities: list, camera: cam })
    }, 1500)
    return () => clearInterval(id)
  }, [camera, controls])
  return null
}

const r = (n: number) => Math.round(n * 100) / 100

/** `?follow=<entityId>` keeps the orbit target on an entity and trails the camera behind it. */
function FollowCamera() {
  const id = useMemo(() => new URLSearchParams(location.search).get('follow'), [])
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  const last = useMemo(() => new THREE.Vector3(), [])
  const p = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    const e = id && entities.get(id)
    if (!e || !controls) return
    e.object.getWorldPosition(p)
    if (last.lengthSq() === 0) {
      const d = Math.max(...e.size) * 1.8
      camera.position.copy(p).add(new THREE.Vector3(d, d * 0.6, d))
    } else camera.position.add(p.clone().sub(last))
    last.copy(p)
    controls.target.copy(p)
    controls.update()
  })
  return null
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * Glides the camera to an entity when asked (activity `focus`, window.__nc.focus) and handles auto-orbit.
 * Waits up to 20s for the entity to appear, since a newly spawned entity loads a moment after the request.
 */
function CameraDirector() {
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; autoRotate: boolean; autoRotateSpeed: number; update: () => void }
    | null
  const glide = useMemo(() => ({ handled: 0, t: -1, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(), toTarget: new THREE.Vector3() }), [])
  const p = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera }, dt) => {
    if (!controls) return
    controls.autoRotate = cameraDirector.autoRotate && glide.t < 0
    controls.autoRotateSpeed = 0.5
    const { focusId, requestedAt } = cameraDirector
    // Small delay: the world update that moves/creates the object can arrive just after the focus request.
    if (focusId && requestedAt !== glide.handled && performance.now() - requestedAt > 500) {
      const e = findEntity(focusId)
      if (e) {
        glide.handled = requestedAt
        e.object.getWorldPosition(p)
        const [w, h, d] = e.size
        const radius = Math.max(w, h, d)
        glide.toTarget.copy(p).add(new THREE.Vector3(0, h * 0.35, 0))
        const bearing = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize()
        const dist = radius * 1.6 + 10
        glide.toPos.copy(glide.toTarget).addScaledVector(bearing, dist).add(new THREE.Vector3(0, dist * 0.45, 0))
        glide.fromPos.copy(camera.position)
        glide.fromTarget.copy(controls.target)
        glide.t = 0
      } else if (performance.now() - requestedAt > 20_000) glide.handled = requestedAt
    }
    if (glide.t >= 0) {
      glide.t = Math.min(1, glide.t + dt / 2.4)
      const k = easeInOut(glide.t)
      camera.position.lerpVectors(glide.fromPos, glide.toPos, k)
      controls.target.lerpVectors(glide.fromTarget, glide.toTarget, k)
      controls.update()
      if (glide.t >= 1) glide.t = -1
    }
  })
  return null
}

export function World({ time }: { time: TimeOfDay }) {
  const LOOK = TIMES[time] ?? TIMES.day
  const SUN = useMemo(() => new THREE.Vector3(...LOOK.sun), [LOOK])
  /** Where the shadow-casting light sits (the moon at night, since the sun is below the horizon). */
  const LIGHT_POS = useMemo(() => new THREE.Vector3(...LOOK.lightPos), [LOOK])
  const pick = (p: THREE.Vector3) => {
    const cursor: [number, number, number] = [r(p.x), r(p.y), r(p.z)]
    setState({ cursor })
    report('cursor', { x: cursor[0], y: cursor[1], z: cursor[2] })
  }
  return (
    <>
      <color attach="background" args={[LOOK.sky]} />
      <fog attach="fog" args={[LOOK.fog, 120, 380]} />
      <Sky sunPosition={SUN} turbidity={LOOK.turbidity} rayleigh={LOOK.rayleigh} />
      <hemisphereLight args={[LOOK.skyTop, LOOK.ground, LOOK.ambient]} />
      <directionalLight
        position={LIGHT_POS}
        color={LOOK.light}
        intensity={LOOK.intensity}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-far={400}
        shadow-bias={-0.0005}
      />
      <Terrain onPick={pick} waterColor={LOOK.water} />
      <SceneReporter />
      <FollowCamera />
      <CameraDirector />
      <OrbitControls makeDefault target={[0, 2, 0]} maxPolarAngle={Math.PI / 2.05} maxDistance={300} />
    </>
  )
}
