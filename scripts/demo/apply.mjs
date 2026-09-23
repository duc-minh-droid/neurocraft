// Demo helpers run by record-demo steps: node scripts/demo/apply.mjs dragon|sunset|reset
import fs from 'node:fs'
const [cmd] = process.argv.slice(2)
const world = 'src/world/World.tsx'
if (cmd === 'dragon') fs.copyFileSync('scripts/demo/dragon.tsx.txt', 'src/entities/red-dragon.tsx')
if (cmd === 'sunset' || cmd === 'day') {
  const s = fs.readFileSync(world, 'utf8').replace(/const TIME: keyof typeof TIMES = '\w+'/, `const TIME: keyof typeof TIMES = '${cmd}'`)
  fs.writeFileSync(world, s)
}
