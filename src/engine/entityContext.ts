import { createContext, use } from 'react'
import type * as THREE from 'three'
import type { AssetMeta } from '../../shared/meta'

export interface EntityContextValue {
  scene: THREE.Object3D
  meta: AssetMeta
  mixer: THREE.AnimationMixer
}

export const EntityContext = createContext<EntityContextValue | null>(null)

export function useEntity() {
  const ctx = use(EntityContext)
  if (!ctx) throw new Error('Bone behaviors (FlapBones, WiggleBones, SpinNodes) must be children of <Entity>')
  return ctx
}
