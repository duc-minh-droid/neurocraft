import { Drive, Entity, Place, SpinNodes } from '../engine'

/** small blue car (vehicle, Sketchfab "Low Poly Small car" by scailman) */
export default function SmallCar() {
  return (
    <Place at={[5, 15]}>
      <Drive radius={12} speed={6}>
        <Entity asset="small-car" height={1.6}>
          <SpinNodes match={/^[FR][LR]_Wheel$/} speed={8} axis="x" />
        </Entity>
      </Drive>
    </Place>
  )
}
