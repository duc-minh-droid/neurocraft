import { Component, Suspense, type ComponentType, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { World } from './world/World'
import { Hud } from './engine/Hud'

const modules = import.meta.glob<{ default: ComponentType }>('./entities/*.tsx', { eager: true })

class EntityBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error(`[entity ${this.props.name}]`, error)
  }
  render() {
    return this.state.error ? null : this.props.children
  }
}

export default function App() {
  return (
    <>
      <Canvas shadows camera={{ position: [22, 14, 22], fov: 50, near: 0.1, far: 1500 }} dpr={[1, 2]}>
        <World />
        {Object.entries(modules).map(([file, mod]) => (
          <EntityBoundary key={file} name={file}>
            <Suspense fallback={null}>
              <mod.default />
            </Suspense>
          </EntityBoundary>
        ))}
      </Canvas>
      <Hud />
    </>
  )
}
