import { useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { heightAt, WATER_LEVEL, WORLD_SIZE } from './heightfield'

const SEGMENTS = 256
const GRASS = new THREE.Color('#4f7a3a')
const DRY = new THREE.Color('#8a8a4e')
const SAND = new THREE.Color('#c9b98a')
const ROCK = new THREE.Color('#6b6660')
const SNOW = new THREE.Color('#f2f4f7')

const ss = THREE.MathUtils.smoothstep

function colorFor(h: number, slope: number, out: THREE.Color) {
  out.copy(GRASS).lerp(DRY, ss(h, 4, 14))
  out.lerp(SAND, 1 - ss(h, WATER_LEVEL + 0.1, WATER_LEVEL + 0.8))
  out.lerp(ROCK, Math.max(ss(slope, 0.35, 0.6), ss(h, 18, 26)))
  return out.lerp(SNOW, ss(h, 34, 42))
}

export function Terrain({ onPick, waterColor = '#2b6f9e' }: { onPick?: (p: THREE.Vector3) => void; waterColor?: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)))
    g.computeVertexNormals()
    const normals = g.attributes.normal as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      colorFor(pos.getY(i), 1 - normals.getY(i), c).toArray(colors, i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }, [])

  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onPick?.(e.point.clone())
  }

  return (
    <group>
      <mesh geometry={geometry} receiveShadow onDoubleClick={handleDoubleClick}>
        <meshStandardMaterial vertexColors roughness={0.95} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={WATER_LEVEL} receiveShadow>
        <planeGeometry args={[WORLD_SIZE, WORLD_SIZE]} />
        <meshStandardMaterial color={waterColor} transparent opacity={0.75} roughness={0.1} metalness={0.2} />
      </mesh>
    </group>
  )
}
