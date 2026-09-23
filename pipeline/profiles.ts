import type { Kind, RigType } from '../shared/meta.ts'

export interface Profile {
  /** 'check' = run Tripo rig-check and rig if riggable; 'none' = static asset. */
  rig: 'check' | 'none'
  defaultHeight: number
  promptSuffix: string
}

export const PROFILES: Record<Kind, Profile> = {
  character: { rig: 'check', defaultHeight: 1.8, promptSuffix: 'full body, T-pose, arms apart, game-ready character' },
  creature: { rig: 'check', defaultHeight: 2.5, promptSuffix: 'full body, neutral standing pose, limbs apart, game-ready creature' },
  vehicle: { rig: 'none', defaultHeight: 2, promptSuffix: 'game-ready vehicle, clean separate parts' },
  prop: { rig: 'none', defaultHeight: 1, promptSuffix: 'game-ready prop' },
  building: { rig: 'none', defaultHeight: 8, promptSuffix: 'game-ready building, exterior' },
  plant: { rig: 'none', defaultHeight: 4, promptSuffix: 'game-ready plant' },
}

/** Default Tripo retarget presets per rig type (rig model v2.5 supports these for all rig types). */
export const DEFAULT_ANIMATIONS: Record<RigType, string[]> = {
  biped: ['preset:idle', 'preset:walk', 'preset:run'],
  quadruped: ['preset:quadruped:walk'],
  hexapod: ['preset:hexapod:walk'],
  octopod: ['preset:octopod:walk'],
  serpentine: ['preset:serpentine:march'],
  aquatic: ['preset:aquatic:march'],
  avian: [],
}

/** "preset:quadruped:walk" -> "walk", "preset:biped:dance_01" -> "dance_01" */
export const clipName = (preset: string) => preset.split(':').pop()!

/** Accepts "walk", "quadruped:walk" or "preset:walk". */
export const toPreset = (name: string) => (name.startsWith('preset:') ? name : `preset:${name}`)
