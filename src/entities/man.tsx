import { Drive, Entity, Place } from '../engine'

/** man ×4 running in a circle (character, clips: Walk, Run, Idle, Idle2) */
export default function Man() {
  return (
    <Place at={[0, 0]}>
      {[0, 1, 2, 3].map((i) => (
        <Drive key={i} radius={12} speed={7} phase={i / 4}>
          <Entity asset="man" id={`man-${i + 1}`} scale={5} clip="Run" />
        </Drive>
      ))}
    </Place>
  )
}
