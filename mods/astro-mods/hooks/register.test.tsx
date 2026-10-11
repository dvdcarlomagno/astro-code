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

// spawn-policy (phase 40) is UNBUILT: PROBE.md (phase 40) records that no spawn-time field
// reveals worktree isolation or a concurrent executor, so nothing refuses. This characterisation
// test pins that with the switch ON: every spawn passes through exactly as the engine beneath
// answered, and `model` is never refused, filled or changed (ADR-073: no haiku refusal;
// CONTEXT decision 2: spawn-policy never touches model; local-model sessions spawn with none on
// purpose). A signal-branch replan revises case (i).
test('with spawn-policy on, every spawn passes through untouched and its model is never changed', async ($, on) => {
  const seen: Array<{ subagentType?: string, model?: string }> = []
  let n = 0
  on('process.run', () => ({ value: ran(JSON.stringify({ switches: { 'spawn-policy': true }, warnings: [] })) }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.spawn', (_$, e) => {
    seen.push({ subagentType: e.subagentType, model: e.model })
    return { model: e.model ?? 'inherit', agentId: `a${++n}` }
  })
  await $.session.start(START)
  // (i) two overlapping wave executors with no cwd, the Workflow shape phase-36 PROBE records;
  // (ii) an Agent-tool executor; (iii) a verifier
  const shapes = [
    { ...SPAWN, subagentType: 'astro-executor', workflow: { runId: 'wf_x', agentIndex: 2 } },
    { ...SPAWN, subagentType: 'astro-executor', workflow: { runId: 'wf_x', agentIndex: 3 } },
    { ...SPAWN, subagentType: 'astro-executor' },
    { ...SPAWN, subagentType: 'astro-verifier' },
  ]
  for (const shape of shapes) {
    for (const model of ['haiku', 'sonnet', 'opus', undefined]) {
      const before = seen.length
      const ev = { ...shape, model }
      const result = await $.agent.spawn(ev as typeof SPAWN)
      expect(result).toEqual({ model: model ?? 'inherit', agentId: `a${n}` })
      expect(seen.length).toEqual(before + 1)
      expect(seen[before].model).toEqual(model)
    }
  }
})
