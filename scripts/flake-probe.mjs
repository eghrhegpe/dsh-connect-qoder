/** One-off: run the suite N times and report failures, to measure flakiness. */
import { execFileSync } from 'node:child_process'

const runs = Number(process.argv[2] ?? 5)
for (let i = 1; i <= runs; i++) {
  let out = ''
  try {
    out = execFileSync('npm', ['test'], { encoding: 'utf8', shell: true })
  } catch (error) {
    out = String(error.stdout ?? '')
  }
  const fail = /^. fail (\d+)/m.exec(out)?.[1] ?? '?'
  const bad = /✖ (.+)/.exec(out)?.[1] ?? ''
  console.log(`run ${i}: fail=${fail}${bad ? `  first-failure: ${bad}` : ''}`)
}
