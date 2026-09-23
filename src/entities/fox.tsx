import { Entity, Fly, Place, Wander, WiggleBones } from '../engine'

/** fox (creature, clips: Survey, Walk, Run) */
export default function Fox() {
  return (
    <>
      <Place at={[6, 4]}>
        <Wander radius={8} speed={1.2}>
          <Entity asset="fox" height={1.2} clip="Walk" />
        </Wander>
      </Place>
      <Place at={[0, 0]}>
        <Fly radius={14} altitude={6} speed={7}>
          <Entity asset="fox" id="flying-fox" height={2} clip="Run" tint="#c1121f">
            <WiggleBones match={/Tail/} amplitude={0.3} frequency={2} />
          </Entity>
        </Fly>
      </Place>
    </>
  )
}
