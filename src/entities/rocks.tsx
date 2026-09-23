import { Entity, Place, Scatter, WATER_LEVEL } from '../engine'

/** rocks across the whole world (prop, Sketchfab "Stylized lowpoly rock" by Bull studios, CC-BY) */
export default function Rocks() {
  return (
    <Place at={[0, 0]}>
      <Scatter count={160} radius={185} spacing={5} seed={11} scaleRange={[0.5, 3]} minHeight={WATER_LEVEL + 0.2}>
        {(it) => <Entity asset="rock" id={`rock-${it.index}`} rotation={it.rotation} scale={it.scale} />}
      </Scatter>
    </Place>
  )
}
