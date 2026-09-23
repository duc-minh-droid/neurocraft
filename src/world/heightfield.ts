/** Deterministic terrain height function shared by the terrain mesh and every behavior that walks on the ground. */

export const WORLD_SIZE = 400
export const WATER_LEVEL = -1.2

function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function noise(x: number, z: number) {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const xf = x - xi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = zf * zf * (3 - 2 * zf)
  const a = hash(xi, zi)
  const b = hash(xi + 1, zi)
  const c = hash(xi, zi + 1)
  const d = hash(xi + 1, zi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm(x: number, z: number) {
  let sum = 0
  let amp = 1
  let freq = 1
  for (let i = 0; i < 5; i++) {
    sum += amp * (noise(x * freq, z * freq) * 2 - 1)
    amp *= 0.5
    freq *= 2
  }
  return sum
}

export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z)
  const flat = Math.min(1, Math.max(0, (r - 25) / 60))
  const hills = fbm(x / 60, z / 60) * 9 + 3.5
  const mountains = Math.max(0, r - 120) * 0.35 * (0.6 + 0.4 * noise(x / 40, z / 40))
  const lake = -7 * Math.exp(-((x + 45) ** 2 + (z - 35) ** 2) / 500)
  return hills * flat + mountains + lake
}
