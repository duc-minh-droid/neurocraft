import { Entity, Place, Scatter, Sway, WATER_LEVEL } from '../engine'

/** pine forest (plant, Sketchfab "Pine tree" by Andriy Shekh, CC-BY) */
export default function PineForest() {
  return (
    <Place at={[-30, -20]}>
      <Scatter count={40} radius={28} spacing={4} seed={7} minHeight={WATER_LEVEL + 0.4}>
        {(it) => (
          <Sway>
            <Entity asset="pine" id={`pine-${it.index}`} rotation={it.rotation} scale={it.scale} />
          </Sway>
        )}
      </Scatter>
    </Place>
  )
}
