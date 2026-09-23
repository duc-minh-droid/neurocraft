import { Entity, Fly, Place } from '../engine'

/** red dragon circling the castle (creature, clips: Object_0) */
export default function RedDragon() {
  return (
    <Place at={[-49, -49]}>
      <Fly radius={34} altitude={30} speed={10} bank={1.3}>
        <Entity asset="red-dragon" height={11} />
      </Fly>
    </Place>
  )
}
