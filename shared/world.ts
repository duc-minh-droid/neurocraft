/** The world as data: rendered by the page, edited by the agent through tools, persisted to world.json. */

export const TIMES_OF_DAY = ['day', 'sunset', 'night'] as const
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

export const BEHAVIORS = ['none', 'fly', 'drive', 'swim', 'wander', 'float', 'spin', 'sway'] as const
export type BehaviorType = (typeof BEHAVIORS)[number]

export interface Behavior {
  type: BehaviorType
  /** Path/roam radius in meters (fly, drive, swim, wander). */
  radius?: number
  /** Height above ground in meters (fly). */
  altitude?: number
  /** Depth below the water surface in meters (swim). */
  depth?: number
  /** Meters per second (paths, wander) or radians per second (spin). */
  speed?: number
  path?: 'circle' | 'figure8'
  /** Circle/roam center [x, z]; defaults to the object's position. */
  center?: [number, number]
}

export type BoneEffectType = 'flap' | 'wiggle' | 'spinNodes'

/** Procedural motion on named bones or nodes (wings, tails, wheels). `match` is a case-insensitive regex source. */
export interface BoneEffect {
  type: BoneEffectType
  match: string
  amplitude?: number
  frequency?: number
  speed?: number
  axis?: 'x' | 'y' | 'z'
}

export interface Scatter {
  /** Spread radius in meters around the object's position. */
  radius: number
  spacing?: number
  seed?: number
  scaleMin?: number
  scaleMax?: number
}

export interface WorldObject {
  id: string
  /** Asset id in assets/<id>/ */
  asset: string
  /** Short human description ("stone castle"), used in the agent's scene summary. */
  label?: string
  /** Ground position [x, z]; y comes from the terrain. */
  at: [number, number]
  /** Extra meters above the ground. */
  elevation?: number
  /** World height in meters (defaults to the asset's defaultHeight). */
  height?: number
  scale?: number
  /** Yaw in degrees. */
  rotation?: number
  tint?: string
  /** Animation clip name; null = none; omitted = idle/first. */
  clip?: string | null
  /** Animation playback speed. */
  animSpeed?: number
  /** Number of copies (>1: scattered, or evenly spaced along a path behavior). */
  count?: number
  scatter?: Scatter
  behavior?: Behavior
  bones?: BoneEffect[]
}

export interface WorldState {
  version: 1
  time: TimeOfDay
  objects: WorldObject[]
}

export const WORLD_EVENT = 'nc:world'
