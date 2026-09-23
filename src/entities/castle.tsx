import { Entity, Place } from '../engine'

/** stone castle (building) */
export default function Castle() {
  return (
    <Place at={[-49, -49]}>
      <Entity asset="castle" />
    </Place>
  )
}
