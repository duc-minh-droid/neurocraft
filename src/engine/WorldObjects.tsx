import { Component, Suspense, type ReactNode } from 'react'
import type { Behavior, BoneEffect, WorldObject } from '../../shared/world'
import { WATER_LEVEL } from '../world/heightfield'
import { hasAsset, useAssets } from './assets'
import { Entity } from './Entity'
import { Place, Scatter } from './Place'
import { FlapBones, SpinNodes, WiggleBones } from './behaviors/bones'
import { Drive, Float, Fly, Spin, Sway, Swim, Wander } from './behaviors/motion'

const PATH_BEHAVIORS = new Set(['fly', 'drive', 'swim'])

function withBehavior(b: Behavior | undefined, phase: number, child: ReactNode): ReactNode {
  switch (b?.type) {
    case 'fly':
      return <Fly radius={b.radius} altitude={b.altitude} speed={b.speed} path={b.path} phase={phase}>{child}</Fly>
    case 'drive':
      return <Drive radius={b.radius} speed={b.speed} path={b.path} phase={phase}>{child}</Drive>
    case 'swim':
      return <Swim radius={b.radius} depth={b.depth} speed={b.speed} path={b.path} phase={phase}>{child}</Swim>
    case 'wander':
      return <Wander radius={b.radius} speed={b.speed}>{child}</Wander>
    case 'float':
      return <Float>{child}</Float>
    case 'spin':
      return <Spin speed={b.speed}>{child}</Spin>
    case 'sway':
      return <Sway>{child}</Sway>
    default:
      return child
  }
}

function boneEffects(bones: BoneEffect[] | undefined) {
  return bones?.map((fx, i) => {
    const match = new RegExp(fx.match, 'i')
    if (fx.type === 'flap') return <FlapBones key={i} match={match} amplitude={fx.amplitude} frequency={fx.frequency} axis={fx.axis} />
    if (fx.type === 'wiggle') return <WiggleBones key={i} match={match} amplitude={fx.amplitude} frequency={fx.frequency} axis={fx.axis} />
    return <SpinNodes key={i} match={match} speed={fx.speed} axis={fx.axis} />
  })
}

function ObjectView({ o }: { o: WorldObject }) {
  const count = Math.max(1, o.count ?? 1)
  const entity = (id: string, scale = 1, rotation = 0) => (
    <Entity
      asset={o.asset}
      id={id}
      height={o.height}
      scale={(o.scale ?? 1) * scale}
      rotation={(o.rotation ?? 0) + rotation}
      tint={o.tint}
      clip={o.clip}
      speed={o.animSpeed}
    >
      {boneEffects(o.bones)}
    </Entity>
  )

  if (count > 1 && !PATH_BEHAVIORS.has(o.behavior?.type ?? 'none')) {
    const s = o.scatter ?? { radius: Math.max(6, Math.sqrt(count) * 4) }
    return (
      <Place at={o.at} offset={o.elevation}>
        <Scatter count={count} radius={s.radius} spacing={s.spacing} seed={s.seed} scaleRange={[s.scaleMin ?? 0.85, s.scaleMax ?? 1.15]} minHeight={WATER_LEVEL + 0.3}>
          {(it) => withBehavior(o.behavior, 0, entity(`${o.id}-${it.index + 1}`, it.scale, it.rotation))}
        </Scatter>
      </Place>
    )
  }
  return (
    <Place at={o.at} offset={o.elevation}>
      {Array.from({ length: count }, (_, i) => (
        <group key={i}>{withBehavior(o.behavior, i / count, entity(count > 1 ? `${o.id}-${i + 1}` : o.id))}</group>
      ))}
    </Place>
  )
}

class ObjectBoundary extends Component<{ id: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error(`[world object ${this.props.id}]`, error)
  }
  render() {
    return this.state.error ? null : this.props.children
  }
}

export function WorldObjects({ objects }: { objects: WorldObject[] }) {
  useAssets()
  return (
    <>
      {objects.map((o) => (
        <ObjectBoundary key={`${o.id}:${o.asset}:${hasAsset(o.asset)}`} id={o.id}>
          <Suspense fallback={null}>
            <ObjectView o={o} />
          </Suspense>
        </ObjectBoundary>
      ))}
    </>
  )
}
