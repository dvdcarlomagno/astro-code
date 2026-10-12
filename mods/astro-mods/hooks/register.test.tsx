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

test('witness: a quoted verb or ref is still a gate: never witnessed in an autonomous turn (phase 41 C2/C3)', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-autonomous', '')
  await prompt($, '/astro-autonomous')
  await $.tool.call({ tool: 'Bash', command: 'node --no-warnings bin/ac.mjs phase "accept" 41 --witnessed composer' })
  await $.tool.call({ tool: 'Bash', command: 'node --no-warnings bin/ac.mjs phase accept "41" --witnessed composer' })
  await $.tool.call({ tool: 'Bash', command: 'node --no-warnings bin/ac.mjs fix "accept" sample-bug --witnessed composer' })
  for (const cmd of rig.bash()) {
    expect(cmd.includes('--witnessed')).toEqual(false)
    expect(cmd.includes('--agent claude')).toEqual(true)
  }
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

test('witness: an Edit putting the human marker on line 2 is left alone (phase 41 C6 d)', async ($, on) => {
  const rig = witnessRig(true, on)
  on('fs.read', () => ({ value: '# Title\nbody\n' }))
  await $.session.start(START)
  await typed($, 'astro-accept', '41', SDK)
  await $.tool.call({ tool: 'Edit', file_path: CTX, old_string: 'body', new_string: '<!-- astro-discuss: captured -->\nbody' })
  expect(rig.ran.map(e => [e.old_string, e.new_string])).toEqual([['body', '<!-- astro-discuss: captured -->\nbody']])
})

test('witness: the same marker after a typed /astro-discuss 1 is left as the human wrote it', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-discuss', '1')
  await prompt($, '/astro-discuss 1')
  await $.tool.call({ tool: 'Write', file_path: CTX, content: HUMAN })
  expect(rig.writes()).toEqual([HUMAN])
})

// brief-section (phase 42): the principles brief as ONE astro-mods:brief section, and no second copy.
// PROBE.md (phase 42) names the events: prompt.compose adds the section (F14), classic.SessionStart
// carries each hook's additionalContext unwrapped and byte-equal (F2, F3), and the PreCompact output
// rides a session.append row on door 'command' (F9-F11). A hook beneath the plugin answers what the
// engine would; process.run answers per argv, so the plugin never reaches a real `ac`.
const BRIEF = 'HARD RULES\n- RULE one\n- RULE two\n\nIN SCOPE\n- RULE three'
const PARTS = ['SESSION BRIEF part 1\n- RULE one', 'SESSION BRIEF part 2\n- RULE two']
const POSITION = 'proj · M1 · Phase 42 executing · Next: /astro-verify 42'
const FOREIGN_CTX = 'a foreign hook says: - RULE one'
type Mode = 'ok' | 'enoent' | 'exit1' | 'empty'
const briefRig = (on: (...a: any[]) => void, { switchOn = true, mode = 'ok' as Mode } = {}) => {
  const asked: string[] = []
  const toasts: string[] = []
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    const k = e.argv.join(' ')
    asked.push(k)
    if (k === 'ac mods status --json --switches-only') return { value: ran(JSON.stringify({ switches: { 'brief-section': switchOn }, warnings: [] })) }
    if (k === 'ac mods feed brief-section') return { value: ran(JSON.stringify({ serve: true, parts: PARTS, position: POSITION })) }
    if (k === 'ac mods feed brief-section --position') return { value: ran(JSON.stringify({ position: POSITION })) }
    if (k === 'ac principles brief --stage session --by session') {
      if (mode === 'enoent') throw new Error('spawn ac ENOENT')
      if (mode === 'exit1') return { value: ran('', 1) }
      if (mode === 'empty') return { value: ran('') }
      return { value: ran(`${BRIEF}\n`) }
    }
    throw new Error(`unscripted argv: ${k}`)
  })
  on('ui.toast', (_$: unknown, e: unknown) => { toasts.push(JSON.stringify(e)); return { value: undefined } })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('classic.SessionStart', (_$: unknown, e: { source: string }) => ({ additionalContext: [FOREIGN_CTX, ...PARTS] }))
  return { asked, toasts }
}
const briefSections = (r: { sections: Array<{ id: string }> }) => r.sections.filter(s => s.id === 'astro-mods:brief')
// the kit hands hooks the composed input only when the call names one (a bare compose() reaches them as undefined)
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] }
const SS = { source: 'startup', cwd: '/work/proj' }

test('brief-section on: one astro-mods:brief section, BRIEF then the position, the same text every compose', async ($, on) => {
  const rig = briefRig(on)
  on('prompt.compose', () => ({ sections: [{ id: 'lean_body', text: 'core', scope: 'shared' }] }))
  await $.session.start(START)
  const first = await $.prompt.compose(COMPOSE)
  const mine = briefSections(first)
  expect(mine.length).toEqual(1)
  expect(first.sections.at(-1)).toEqual(mine[0])
  expect((mine[0] as any).scope).toEqual('session')
  expect((mine[0] as any).text).toEqual(`${BRIEF}\n\n${POSITION}`)
  for (let i = 0; i < 4; i++) expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toEqual((mine[0] as any).text)
  expect(rig.asked.filter(k => k.startsWith('ac principles brief')).length).toEqual(1)
})

test('brief-section on: the hooks\' parts are dropped, a foreign entry quoting a BRIEF line is kept', async ($, on) => {
  briefRig(on)
  await $.session.start(START)
  const out = await ($ as any).classic.SessionStart(SS)
  expect(out.additionalContext).toEqual([FOREIGN_CTX])
})

// The PreCompact row (session.append, door 'command') cannot be driven here: the test kit has no
// bottom for session.append (a hook that answers without next is skipped, and next(e) has nothing
// beneath), so that path is covered by tests/mods_plugin.test.mjs and by PROBE.md's live runs.

for (const mode of ['enoent', 'exit1', 'empty'] as Mode[]) {
  test(`brief-section fails open when the brief ${mode}: no section, hooks pass through, one notice`, async ($, on) => {
    const rig = briefRig(on, { mode })
    on('prompt.compose', () => ({ sections: [{ id: 'lean_body', text: 'core', scope: 'shared' }] }))
    await $.session.start(START)
    for (let i = 0; i < 3; i++) expect(briefSections(await $.prompt.compose(COMPOSE)).length).toEqual(0)
    const out = await ($ as any).classic.SessionStart(SS)
    expect(out.additionalContext).toEqual([FOREIGN_CTX, ...PARTS])
    expect(rig.toasts.length).toEqual(1)
  })
}

test('brief-section off: no section, no brief run, hook output untouched', async ($, on) => {
  const rig = briefRig(on, { switchOn: false })
  on('prompt.compose', () => ({ sections: [] }))
  await $.session.start(START)
  expect(briefSections(await $.prompt.compose(COMPOSE)).length).toEqual(0)
  expect((await ($ as any).classic.SessionStart(SS)).additionalContext).toEqual([FOREIGN_CTX, ...PARTS])
  expect(rig.asked.some(k => k.startsWith('ac principles brief'))).toEqual(false)
  expect(rig.toasts).toEqual([])
})

// A store that changes mid-session: `rev` moves both what the hooks print and what `ac` answers.
const storeRig = (on: (...a: any[]) => void) => {
  const store = { rev: 1 }
  const asked: string[] = []
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    const k = e.argv.join(' ')
    asked.push(k)
    if (k === 'ac mods status --json --switches-only') return { value: ran(JSON.stringify({ switches: { 'brief-section': true }, warnings: [] })) }
    if (k === 'ac mods feed brief-section') return { value: ran(JSON.stringify({ serve: true, parts: [`PART rev${store.rev}`], position: POSITION })) }
    if (k === 'ac mods feed brief-section --position') return { value: ran(JSON.stringify({ position: POSITION })) }
    if (k === 'ac principles brief --stage session --by session') return { value: ran(`BRIEF rev${store.rev}\n`) }
    throw new Error(`unscripted argv: ${k}`)
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({ additionalContext: [`PART rev${store.rev}`] }))
  on('prompt.compose', () => ({ sections: [] }))
  return { store, briefRuns: () => asked.filter(k => k.startsWith('ac principles brief')).length }
}

// the store changes mid-session: a second session.start and a compaction recompute the brief
test('brief-section: a second session.start and a compact re-fetch, so the new rules are served and the new hook parts dropped', async ($, on) => {
  const { store, briefRuns } = storeRig(on)
  await $.session.start(START)
  expect((await ($ as any).classic.SessionStart(SS)).additionalContext).toEqual([])
  expect(briefRuns()).toEqual(1)
  store.rev = 2
  expect((await ($ as any).classic.SessionStart({ ...SS, source: 'compact' })).additionalContext).toEqual([])
  expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toContain('BRIEF rev2')
  store.rev = 3
  await $.session.start(START)
  expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toContain('BRIEF rev3')
})

// PROBE F20: under -p classic.SessionStart completes BEFORE session.start, interactively after, and
// their start order was not observed. Every order is ONE startup: one brief run between the two,
// a stable section across turns, then a compaction after a store change still re-fetches, and a
// reload (a second session.start) runs the brief exactly once more.
const ORDERS: Array<[string, (s: any) => Promise<unknown>]> = [
  ['classic.SessionStart before session.start', async (s) => { const out = await s.classic.SessionStart(SS); await s.session.start(START); return out }],
  ['session.start before classic.SessionStart', async (s) => { await s.session.start(START); return s.classic.SessionStart(SS) }],
  ['both at once, classic first', async (s) => (await Promise.all([s.classic.SessionStart(SS), s.session.start(START)]))[0]],
  ['both at once, session.start first', async (s) => (await Promise.all([s.session.start(START), s.classic.SessionStart(SS)]))[1]],
]
for (const [order, startup] of ORDERS) {
  test(`brief-section, ${order}: one brief run at startup, and a compact after a store change re-fetches`, async ($, on) => {
    const { store, briefRuns } = storeRig(on)
    expect(((await startup($)) as any).additionalContext).toEqual([])
    expect(briefRuns()).toEqual(1)
    const texts = new Set<string>()
    for (let i = 0; i < 5; i++) texts.add((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text)
    expect([...texts]).toEqual([`BRIEF rev1\n\n${POSITION}`])
    expect(briefRuns()).toEqual(1)
    store.rev = 2
    expect((await ($ as any).classic.SessionStart({ ...SS, source: 'compact' })).additionalContext).toEqual([])
    expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toEqual(`BRIEF rev2\n\n${POSITION}`)
    expect(briefRuns()).toEqual(2)
    store.rev = 3
    await $.session.start(START)
    expect(briefRuns()).toEqual(3)
    expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toEqual(`BRIEF rev3\n\n${POSITION}`)
  })
}
