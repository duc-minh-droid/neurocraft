import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { getAsset } from './assets'
import { EntityContext } from './entityContext'
import { entities, report, setState } from './store'

export interface EntityProps {
  asset: string
  /** Unique entity id (defaults to asset id); needed when the same asset is spawned more than once. */
  id?: string
  /** World height in meters. Defaults to the asset's defaultHeight. */
  height?: number
  /** Extra multiplier on top of height. */
  scale?: number
  /** Yaw in degrees; use it to fix the model's facing direction (behaviors assume +Z is forward). */
  rotation?: number
  /** Multiplies the material colors, e.g. "#c1121f". */
  tint?: string
  /** 0..1 blend from original color to tint. */
  tintStrength?: number
  /** Clip to play. undefined = "idle" or first clip, null = none. */
  clip?: string | null
  /** Animation playback speed. */
  speed?: number
  children?: ReactNode
}

const WHITE = new THREE.Color('#ffffff')

function eachMaterial(root: THREE.Object3D, fn: (m: THREE.MeshStandardMaterial) => void) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) fn(m as THREE.MeshStandardMaterial)
  })
}

export function Entity({ asset, id = asset, height, scale = 1, rotation = 0, tint, tintStrength = 1, clip, speed = 1, children }: EntityProps) {
  const { meta, url } = getAsset(asset)
  const gltf = useGLTF(url)
  const root = useRef<THREE.Group>(null)

  const scene = useMemo(() => {
    const s = cloneSkinned(gltf.scene)
    s.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = mesh.receiveShadow = true
      mesh.frustumCulled = !(o as THREE.SkinnedMesh).isSkinnedMesh
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone()
    })
    eachMaterial(s, (m) => m.color && (m.userData.baseColor = m.color.clone()))
    return s
  }, [gltf.scene])

  useEffect(() => {
    const c = WHITE.clone().lerp(new THREE.Color(tint ?? '#ffffff'), tint ? tintStrength : 0)
    eachMaterial(scene, (m) => m.userData.baseColor && m.color.copy(m.userData.baseColor).multiply(c))
  }, [scene, tint, tintStrength])

  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene])
  const clipName = clip === undefined ? (gltf.animations.find((a) => a.name.toLowerCase() === 'idle') ?? gltf.animations[0])?.name : clip
  const findClip = (name?: string | null) =>
    name ? (gltf.animations.find((a) => a.name === name) ?? gltf.animations.find((a) => a.name.toLowerCase().includes(name.toLowerCase()))) : undefined

  /** Measure bounds in the pose actually shown (clip frame 0): clips can move/scale nodes far from the rest pose. */
  const bounds = useMemo(() => {
    const c = findClip(clipName)
    if (c) {
      const temp = new THREE.AnimationMixer(scene)
      temp.clipAction(c).play()
      temp.update(0)
      temp.stopAllAction()
      temp.uncacheRoot(scene)
    }
    scene.updateMatrixWorld(true)
    scene.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.update())
    const box = new THREE.Box3().setFromObject(scene, true).applyMatrix4(scene.matrixWorld.clone().invert())
    return box.isEmpty() ? new THREE.Box3(new THREE.Vector3(...meta.bbox.min), new THREE.Vector3(...meta.bbox.max)) : box
  }, [scene, clipName])

  useEffect(() => {
    if (!clipName) return
    const c = findClip(clipName)
    if (!c) {
      console.warn(`[${id}] no clip "${clipName}". Available: ${gltf.animations.map((a) => a.name).join(', ') || 'none'}`)
      return
    }
    const action = mixer.clipAction(c).reset().fadeIn(0.3).play()
    action.timeScale = speed
    return () => void action.fadeOut(0.3)
  }, [clipName, mixer, gltf.animations, speed, id])
  useFrame((_, dt) => mixer.update(dt), -1)

  const { min, max } = bounds
  const s = ((height ?? meta.defaultHeight) / (max.y - min.y || 1)) * scale

  useEffect(() => {
    const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(s).toArray()
    entities.set(id, { asset, object: root.current!, size })
    return () => void entities.delete(id)
  }, [id, asset, bounds, s])
  const select = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    setState({ selection: id })
    report('selection', { id, asset })
  }

  return (
    <group ref={root} scale={s} rotation-y={THREE.MathUtils.degToRad(rotation)} onDoubleClick={select}>
      <primitive object={scene} position={[-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2]} />
      <EntityContext value={{ scene, meta, mixer }}>{children}</EntityContext>
    </group>
  )
}
