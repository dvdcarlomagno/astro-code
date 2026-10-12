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

// witness (phase 41, ADR-074) through the real engine. The kit's `$.command.run` / `$.prompt.submit`
// carry no `origin` of their own, but they pass a test-supplied one through to the plugin (verified
// by logging beneath it), so a test sets `{ kind: 'composer' }` / `{ kind: 'sdk' }` itself; the type
// omits the field, hence the casts. The engine stamps it in production (PROBE.md). A hook beneath the
// plugin records what would actually run.
const COMPOSER = { kind: 'composer' }
const SDK = { kind: 'sdk' }
const CTX = '/w/.astrocode/phases/01-x/CONTEXT.md'
const HUMAN = '<!-- astro-discuss: captured -->\n# C\n'
const witnessRig = (witness: boolean, on: (...a: any[]) => void) => {
  const toasts: string[] = []
  const ran_: Array<Record<string, any>> = []
  on('process.run', () => ({ value: ran(JSON.stringify({ switches: { witness }, warnings: [] })) }))
  on('ui.toast', (_$: unknown, e: unknown) => { toasts.push(JSON.stringify(e)); return { value: undefined } })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('prompt.submit', () => ({ text: '' }))
  on('tool.call', (_$: unknown, e: Record<string, any>) => { ran_.push(e); return { result: { stdout: '', stderr: '', interrupted: false } } })
  return { toasts, ran: ran_, bash: () => ran_.map(e => e.command), writes: () => ran_.map(e => e.content) }
}
const typed = ($: any, command: string, args: string, origin: object = COMPOSER) => $.command.run({ command, args, origin })
const prompt = ($: any, text: string, origin: object = COMPOSER) => $.prompt.submit({ text, origin })

test('witness: a typed /astro-accept 1 in the composer marks the accept as witnessed', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-accept', '1')
  await prompt($, '/astro-accept 1') // the raw line follows the command (PROBE.md); it keeps the typed signal
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 1' })
  expect(rig.bash()).toEqual(['ac phase accept 1 --witnessed composer'])
  expect(rig.toasts).toEqual([])
})

test('witness: a typed accept for a different phase, or a plain prompt, is recorded as the agent', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-accept', '1')
  await prompt($, '/astro-accept 1')
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 2' })
  await prompt($, 'please accept phase 1')
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 1' })
  expect(rig.bash()).toEqual(['ac phase accept 2 --agent claude', 'ac phase accept 1 --agent claude'])
  expect(rig.toasts.length).toEqual(1) // told once
})

test('witness: a turn started by the SDK is the agent even with the right typed command', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-accept', '2', SDK)
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 2' })
  expect(rig.bash()).toEqual(['ac phase accept 2 --agent claude'])
})

test('witness: a chained or wrapped call never carries a forged --witnessed, and its other gates are the agent (phase 41 C2)', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-accept', '41')
  await prompt($, '/astro-accept 41')
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 41 && ac phase accept 55 --witnessed composer' })
  await $.tool.call({ tool: 'Bash', command: 'bash -c "ac phase accept 56 --witnessed composer"' })
  expect(rig.bash()).toEqual(['ac phase accept 41 && ac phase accept 55 --agent claude', 'bash -c "ac phase accept 56 --agent claude"'])
})

test('witness: a gate run through node, a path or $(which ac) is unreadable, never innocent (phase 41 C2)', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-autonomous', '')
  await prompt($, '/astro-autonomous')
  await $.tool.call({ tool: 'Bash', command: 'node --no-warnings bin/ac.mjs phase accept 41 --witnessed composer' })
  await $.tool.call({ tool: 'Bash', command: '$(which ac) phase accept 41' })
  expect(rig.bash()).toEqual(['node --no-warnings bin/ac.mjs phase accept 41 --agent claude', '$(which ac) phase accept 41 --agent claude'])
})

test('witness: a declared --agent is left untouched', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await prompt($, 'go')
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 1 --agent codex' })
  expect(rig.bash()).toEqual(['ac phase accept 1 --agent codex'])
  expect(rig.toasts).toEqual([])
})

test('witness: a bare or empty --agent is a declaration too, in a typed or an SDK turn (phase 41 C4)', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-accept', '45')
  await prompt($, '/astro-accept 45')
  await $.tool.call({ tool: 'Bash', command: 'ac phase reject 45 --agent --reason x' })
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 45 --agent ""' })
  await typed($, 'astro-accept', '41', SDK)
  await $.tool.call({ tool: 'Bash', command: 'ac phase reject 41 --reason x --agent' })
  expect(rig.bash()).toEqual(['ac phase reject 45 --agent --reason x', 'ac phase accept 45 --agent ""', 'ac phase reject 41 --reason x --agent'])
})

test('witness: a fix ref that is not exactly the typed id is the agent (phase 41 C3)', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-fix-accept', '2026-10-12-sample-bug')
  await prompt($, '/astro-fix-accept 2026-10-12-sample-bug')
  await $.tool.call({ tool: 'Bash', command: 'ac fix accept sample-bug' })
  await $.tool.call({ tool: 'Bash', command: 'ac fix accept 2026-10-12-sample-bug' })
  expect(rig.bash()).toEqual(['ac fix accept sample-bug --agent claude', 'ac fix accept 2026-10-12-sample-bug --witnessed composer'])
})

test('witness: with the switch off the calls are byte-identical', async ($, on) => {
  const rig = witnessRig(false, on)
  await $.session.start(START)
  await prompt($, 'go')
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 1' })
  await $.tool.call({ tool: 'Write', file_path: CTX, content: HUMAN })
  expect(rig.ran.map(e => e.command ?? e.content)).toEqual(['ac phase accept 1', HUMAN])
  expect(rig.toasts).toEqual([])
})

test('witness: a cold call with no turn is left as declared', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 1' })
  expect(rig.bash()).toEqual(['ac phase accept 1'])
})

test('witness: a human CONTEXT.md marker written outside a typed /astro-discuss becomes the agent marker', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await prompt($, 'write the context')
  await $.tool.call({ tool: 'Write', file_path: CTX, content: HUMAN })
  expect(rig.writes()).toEqual(['<!-- astro-discuss: captured by agent: claude -->\n# C\n'])
})

test('witness: an Edit that would make line 1 the human marker is turned back to the agent marker (phase 41 C6)', async ($, on) => {
  const rig = witnessRig(true, on)
  const AGENT = '<!-- astro-discuss: captured by agent: claude -->'
  const file = `${AGENT}\n# C\n`
  on('fs.read', () => ({ value: file }))
  await $.session.start(START)
  await typed($, 'astro-accept', '41', SDK)
  await $.tool.call({ tool: 'Edit', file_path: CTX, old_string: ' by agent: claude', new_string: '' })
  await $.tool.call({ tool: 'Edit', file_path: CTX, old_string: AGENT, new_string: '\n<!-- astro-discuss: captured -->' })
  await $.tool.call({ tool: 'Edit', file_path: CTX, old_string: '# C', new_string: '# Context' })
  expect(rig.ran.map(e => [e.old_string, e.new_string])).toEqual([
    [file, file],
    [file, `\n${AGENT}\n# C\n`],
    ['# C', '# Context'],
  ])
})

test('witness: the same marker after a typed /astro-discuss 1 is left as the human wrote it', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-discuss', '1')
  await prompt($, '/astro-discuss 1')
  await $.tool.call({ tool: 'Write', file_path: CTX, content: HUMAN })
  expect(rig.writes()).toEqual([HUMAN])
})
