// The plugin's one engine test, run by `claude plugin test` (PLAN F4: it collects only
// *.test.ts / *.test.tsx; a .tsx is not collected by a bare `node --test`, which would crash
// on this import). It drives the real engine: the plugin must load, read its switches through
// `process.run`, and pass `session.start` through whether `ac` answers or not.
import { test, expect } from 'claude-code/testing'

const START = { cwd: '/work/proj', surface: null, isInteractive: false }
// a hook sitting beneath the plugin stands for the engine: it answers `{ value }` or `{ deny }`
const ran = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

test('session.start reads the switches through ac and passes through', async ($, on) => {
  const asked: string[][] = []
  on('process.run', (_$, e) => {
    asked.push([...e.argv])
    return { value: ran(JSON.stringify({ switches: { blindfold: false }, warnings: [] })) }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const result = await $.session.start(START)
  expect(result).toEqual({ cwd: '/work/proj' })
  expect(asked).toEqual([['ac', 'mods', 'status', '--json', '--switches-only']])
})

test('session.start still passes through when ac fails', async ($, on) => {
  on('process.run', () => ({ value: ran('', 1) }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const result = await $.session.start(START)
  expect(result).toEqual({ cwd: '/work/proj' })
})

// blindfold (phase 39): an identified astro-verifier is denied the plan, everyone else is untouched.
// The join is the agent.spawn result (PROBE.md): a hook beneath the plugin answers `{ model, agentId }`
// the way the engine does, and the plugin pairs it with `subagentType`.
const SPAWN = { tool_use_id: 'toolu_1', prompt: 'p', description: 'd', subagentType: 'astro-verifier', provider: { plugin: 'user', tier: 'user' }, parentModel: 'm', permissionMode: 'default', background: false, fork: false }
const PLAN_READ = { tool: 'Read', input: { file_path: '/w/.astrocode/phases/01-x/PLAN.md' }, tool_use_id: 'toolu_2' }

test('blindfold denies an identified astro-verifier reading PLAN.md and leaves the main loop alone', async ($, on) => {
  on('process.run', () => ({ value: ran(JSON.stringify({ switches: { blindfold: true }, warnings: [] })) }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'opus', agentId: 'a1234567890abcdef' }))
  on('tool.check', () => ({ decision: 'allow' }))
  await $.session.start(START)
  await $.agent.spawn(SPAWN)
  const blocked = await $.tool.check({ ...PLAN_READ, agentId: 'a1234567890abcdef' })
  expect(blocked.decision).toEqual('deny')
  const main = await $.tool.check(PLAN_READ)
  expect(main).toEqual({ decision: 'allow' })
})
