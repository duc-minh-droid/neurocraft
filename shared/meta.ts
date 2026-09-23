export const KINDS = ['character', 'creature', 'vehicle', 'prop', 'building', 'plant'] as const
export type Kind = (typeof KINDS)[number]

export const RIG_TYPES = ['biped', 'quadruped', 'hexapod', 'octopod', 'avian', 'serpentine', 'aquatic'] as const
export type RigType = (typeof RIG_TYPES)[number]

export type Vec3 = [number, number, number]

export interface AssetSource {
  type: 'tripo' | 'sketchfab' | 'file'
  taskIds?: { model?: string; rig?: string; texture?: string }
  uid?: string
  name?: string
  author?: string
  authorUrl?: string
  license?: string
  licenseUrl?: string
  url?: string
}

export interface AssetMeta {
  id: string
  prompt: string
  kind: Kind
  source: AssetSource
  rigType: RigType | null
  /** Tripo retarget presets baked into the model (e.g. "preset:walk"). */
  presets: string[]
  file: string
  bones: string[]
  nodes: string[]
  clips: string[]
  materials: string[]
  bbox: { min: Vec3; max: Vec3 }
  /** Native model height in its own units (bbox Y extent). */
  height: number
  /** Suggested world height in meters; Entity scales the model to this. */
  defaultHeight: number
  triangles: number
  credits: number
  createdAt: string
}
