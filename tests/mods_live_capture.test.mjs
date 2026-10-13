// Phase 44 t3 -- live-capture (astro-mods): offers principle capture from human-typed prompts.
// RED first (ADR-018): the feature module arrives only through `await import(...)` inside the
// test bodies, so a missing module fails each test on its own and this file still loads. Only
// modules that already exist are imported statically.
//
// The harness is a fake `$` (process.run, model.complete, session.id, ui.log, ui.toast) driving the
// feature's exported hooks directly. `process.run` is either stubbed or REAL: argv[0] === 'ac' runs
// bin/ac.mjs with HOME=<scratch>, so proposals land in a scratch personal store and are read back
// through the CLI. Switches come from setSwitches, as `ac` would have said them at session.start.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { git } from '../lib/git.mjs'
import { initPlanning } from '../lib/planning.mjs'
import { setSwitches, resetSwitches } from '../mods/astro-mods/hooks/lib/switches.js'
import { badges, claimBadges, resetBadges } from '../mods/astro-mods/hooks/lib/badges.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'bin', 'ac.mjs')
const SPEC = readFileSync(join(ROOT, 'templates', 'principle-capture.md'), 'utf8')
const FEATURE = join(ROOT, 'mods', 'astro-mods', 'hooks', 'features', 'live-capture.js')
const lc = () => import('../mods/astro-mods/hooks/features/live-capture.js')

const NOTICE_RE = /^\d+ proposed — \/astro-principles-review$/
const LIFECYCLE = /^(accept|amend|reject|retire|reopen|merge)$/
const ALL_ARGV = [] // every argv of the whole file, for the lifecycle-verb guard

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const next = (x) => x
const switchesRan = (on) => ({ exitCode: 0, stdout: JSON.stringify({ switches: { 'live-capture': on } }), stderr: '' })
const typed = (text, kind = 'composer') => ({ text, wait: false, origin: { kind } })
const turnDone = (extra = {}) => ({ answer: 'a', reason: 'answer', ...extra })
const rule = (lifted, kind = 'antipattern', why = 'it hid a real bug') =>
  JSON.stringify({ rule: true, lifted, kind, why })
const NOT_RULE = JSON.stringify({ rule: false })
const answered = (text) => ({ isAnswered: true, text })

// a scratch world: a fresh HOME (the personal store), a cwd (project or not), a fake `$`
function world({ project = true, name = 'liveproj' } = {}) {
  const T = mkdtempSync(join(tmpdir(), 'ac-live-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'ac-live-cwd-'))
  if (project) {
    git(['init', '--quiet'], { cwd })
    git(['config', 'user.email', 'dev@example.com'], { cwd })
    git(['config', 'user.name', 'dev'], { cwd })
    initPlanning(cwd, { name })
  }
  const env = { ...process.env, HOME: T }
  delete env.CLAUDE_CONFIG_DIR
  const realAc = (argv) => {
    const r = spawnSync(process.execPath, [BIN, ...argv.slice(1)], { cwd, env, encoding: 'utf8' })
    return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  const w = { T, cwd, argv: [], models: [], logs: [], toasts: [], sessionId: 'sess-1', name }
  // scenario knobs: reply(req, i) answers the i-th model call; run(argv, init, real) may replace `ac`
  w.reply = () => answered(NOT_RULE)
  w.run = null
  w.$ = {
    process: {
      run: async (argv, init) => {
        w.argv.push(argv)
        ALL_ARGV.push(argv)
        return w.run ? w.run(argv, init, realAc) : realAc(argv)
      },
    },
    model: {
      complete: async (req) => {
        const i = w.models.length
        w.models.push(req)
        return w.reply(req, i)
      },
    },
    session: { id: async () => w.sessionId },
    ui: { log: (t) => { w.logs.push(t) }, toast: (t) => { w.toasts.push(t) } },
  }
  w.ac = (...args) => realAc(['ac', ...args])
  w.list = (...flags) => JSON.parse(w.ac('principles', 'list', ...(flags.length ? flags : ['--all']), '--json').stdout)
  w.principlesArgv = () => w.argv.filter((a) => a.includes('principles'))
  w.adds = () => w.argv.filter((a) => a.includes('add'))
  w.replies = (...texts) => { w.reply = (_req, i) => answered(texts[Math.min(i, texts.length - 1)]) }
  return w
}

// load the module, switch on, start a session
async function boot(w, { on = true } = {}) {
  const m = await lc()
  setSwitches(switchesRan(on))
  resetBadges()
  await m.liveSessionStart(w.$, { cwd: w.cwd, surface: null, isInteractive: true }, next)
  return m
}

const submit = async (m, w, e) => {
  const out = await m.livePromptSubmit(w.$, e, next)
  await m.liveSettled()
  return out
}

const seed = (w, statement, why = 'seeded why') =>
  w.ac('principles', 'add', statement, '--kind', 'antipattern', '--why', why, '--propose', '--from-ref', 'seed 1', '--excerpt', 'seed')

// ── C1 ─────────────────────────────────────────────────────────────────────────

test('C1: a composer rule in a project becomes exactly one proposed entry with project, live ref and excerpt', async () => {
  const w = world()
  const m = await boot(w)
  const text = 'in the checkout service never mock Postgres in tests, it hid the 2024 migration bug'
  w.replies(rule('Never mock the database in integration tests', 'antipattern', 'mocks hid a migration bug'))
  const e = typed(text)
  const out = await submit(m, w, e)
  assert.equal(out, e, 'the prompt is returned as it came')
  const got = w.list('--proposed')
  assert.equal(got.length, 1)
  const p = got[0]
  assert.equal(p.status, 'proposed')
  assert.equal(p.statement, 'Never mock the database in integration tests')
  assert.equal(p.kind, 'antipattern')
  assert.equal(p.why, 'mocks hid a migration bug')
  assert.equal(p.source.project, w.name)
  assert.equal(p.source.ref, 'live sess-1')
  assert.equal(p.source.excerpt, text)
})

test('C1: off-project, an entry is still proposed with no project and no .astrocode/ is created', async () => {
  const w = world({ project: false })
  const m = await boot(w)
  w.replies(rule('Never mock the database in integration tests'))
  await submit(m, w, typed('never mock the db'))
  const got = w.list('--proposed')
  assert.equal(got.length, 1)
  assert.ok(!got[0].source.project, `no project recorded: ${got[0].source.project}`)
  assert.equal(got[0].source.ref, 'live sess-1')
  assert.ok(!existsSync(join(w.cwd, '.astrocode')), 'no project state written')
})

// ── C2 ─────────────────────────────────────────────────────────────────────────

test('C2: meaning is the model alone: plain words proposed when the model says rule; rule words dropped when it says no', async () => {
  const a = world()
  const ma = await boot(a)
  a.replies(rule('Keep build steps fast on a laptop', 'preference', 'slow builds break flow'))
  await submit(ma, a, typed('the build on my laptop feels slow today, whatever'))
  assert.equal(a.list('--proposed').length, 1, 'no keyword gate in front of the model')

  const b = world()
  const mb = await boot(b)
  b.replies(NOT_RULE)
  for (const t of ['always run the linter, never skip it, from now on', "d'ora in poi usa sempre i tab"]) {
    await submit(mb, b, typed(t))
  }
  assert.equal(b.principlesArgv().length, 0, 'words never override the model')
  assert.equal(b.list('--proposed').length, 0)
  assert.ok(b.models.length >= 2, 'the model judged each qualifying prompt')

  for (const req of [...a.models, ...b.models]) assert.equal(req.model, 'haiku', 'every judge call is on Haiku')
})

// ── C3 ─────────────────────────────────────────────────────────────────────────

test('C3: only composer-typed text is judged: other origins, commands and their bodies cost nothing', async () => {
  const w = world()
  const m = await boot(w)
  w.replies(rule('Never mock the database in integration tests'))
  for (const kind of ['sdk', 'task-notification', 'peer', 'scheduled-trigger', 'plugin']) {
    await submit(m, w, typed('always use tabs', kind))
  }
  // a typed slash command, then its expanded body (composer origin both times)
  await m.liveCommandRun(w.$, { command: 'astro-plan', args: '4', origin: { kind: 'composer' } }, next)
  await submit(m, w, typed('Plan phase 4. Always write tests first and never skip the gate.'))
  // a shape of a command, typed as text
  await submit(m, w, typed('/astro-plan 4'))
  await submit(m, w, typed('   '))
  assert.equal(w.models.length, 0, 'zero model calls')
  assert.equal(w.principlesArgv().length, 0, 'zero ac principles argv')
  assert.deepEqual(w.list(), [], 'store unchanged')
})

// ── C4 ─────────────────────────────────────────────────────────────────────────

test('C4: the prompt comes back as it came, fast, whatever the model does', async () => {
  for (const [label, reply] of [
    ['normal', () => answered(rule('Never mock the database in integration tests'))],
    ['never resolves', () => new Promise(() => {})],
    ['takes 10s', () => new Promise((r) => { const t = setTimeout(() => r(answered(NOT_RULE)), 10000); t.unref() })],
  ]) {
    const w = world()
    const m = await boot(w)
    w.reply = reply
    const e = typed('never mock the database')
    const t0 = Date.now()
    const out = await m.livePromptSubmit(w.$, e, next)
    assert.equal(out, e, `${label}: the exact event`)
    assert.ok(Date.now() - t0 < 200, `${label}: returned in ${Date.now() - t0} ms`)
  }
})

test('C4: when the pipeline drops the prompt, nothing is judged', async () => {
  const w = world()
  const m = await boot(w)
  w.replies(rule('Never mock the database in integration tests'))
  const out = await m.livePromptSubmit(w.$, typed('never mock the database'), () => ({ drop: 'x' }))
  await m.liveSettled()
  assert.deepEqual(out, { drop: 'x' })
  assert.equal(w.models.length, 0)
})

// ── C5 ─────────────────────────────────────────────────────────────────────────

test('C5: no why, no lifted or a bad kind proposes nothing', async () => {
  const w = world()
  const m = await boot(w)
  const bad = [
    rule('Never mock the database in integration tests', 'antipattern', '   '),
    rule('', 'antipattern', 'a why'),
    rule('Never mock the database in integration tests', 'rule', 'a why'),
  ]
  for (const b of bad) {
    w.replies(b)
    await submit(m, w, typed('some typed words'))
  }
  assert.equal(w.models.length, bad.length)
  assert.equal(w.adds().length, 0, 'no add argv')
  assert.deepEqual(w.list(), [])
})

test('C2/C11: a typed prompt, statement or why starting with -- is still proposed, verbatim', async () => {
  const w = world()
  const m = await boot(w)
  const text = '--no-verify commits are never ok here, always run the hooks'
  w.replies(rule('--no-verify is never ok: always run the commit hooks', 'antipattern', '--no-verify skipped the lint that would have caught it'))
  await submit(m, w, typed(text))
  const got = w.list('--proposed')
  assert.equal(got.length, 1, `proposed: ${JSON.stringify(w.argv)}`)
  assert.equal(got[0].statement, '--no-verify is never ok: always run the commit hooks')
  assert.equal(got[0].why, '--no-verify skipped the lint that would have caught it')
  assert.equal(got[0].source.excerpt, text)
})

const walk = (dir) =>
  readdirSync(dir, { recursive: true }).map((r) => join(dir, r)).filter((f) => statSync(f).isFile())

test('C5: secrets typed into the prompt never reach the store', async () => {
  const w = world()
  const m = await boot(w)
  const secrets = [
    'sk-ant-api03-' + 'a1B2c3D4e5'.repeat(4),
    'AKIA' + 'ABCDEFGH12345678',
    'ghp_' + 'A1b2C3d4E5'.repeat(3) + 'A1b2C3',
    'hunter2xyz',
  ]
  const text = `never hardcode keys: ${secrets[0]} ${secrets[1]} ${secrets[2]} password=${secrets[3]}`
  w.replies(rule('Keep credentials out of source files', 'principle', 'leaked keys are costly'))
  await submit(m, w, typed(text))
  assert.equal(w.list('--proposed').length, 1, 'a proposal landed')
  const files = walk(join(w.T, '.astro', 'principles'))
  assert.ok(files.length > 0)
  for (const s of secrets) {
    for (const f of files) assert.ok(!readFileSync(f, 'utf8').includes(s), `${s.slice(0, 8)}… leaked into ${f}`)
  }
})

// ── C6 ─────────────────────────────────────────────────────────────────────────

const S = 'Never mock the database in integration tests'
const idOf = (w) => w.list().find((p) => p.statement === S).id
const countOf = (w, id) => w.list().find((p) => p.id === id).sightingCount

test('C6: an exact repeat is a sighting, never a second entry', async () => {
  const w = world()
  const m = await boot(w)
  seed(w, S)
  const id = idOf(w)
  w.replies(rule(S))
  await submit(m, w, typed('never mock the database'))
  assert.equal(w.list().length, 1)
  assert.equal(countOf(w, id), 1)
})

test('C6: an overlap the model calls the same is sighted; one it calls different is proposed', async () => {
  const same = world()
  const ms = await boot(same)
  seed(same, S)
  const id = idOf(same)
  same.replies(rule('Never mock the database in unit tests'), JSON.stringify({ same: id }))
  await submit(ms, same, typed('stop mocking the database in unit tests'))
  assert.equal(same.list().length, 1, 'no second entry')
  assert.equal(countOf(same, id), 1)
  assert.ok(same.argv.some((a) => a.includes('sight') && a.includes(id)), 'a sight argv')
  assert.equal(same.models.length, 2)
  for (const req of same.models) assert.equal(req.model, 'haiku')

  const diff = world()
  const md = await boot(diff)
  seed(diff, S)
  diff.replies(rule('Never mock the database in unit tests'), JSON.stringify({ same: null }))
  await submit(md, diff, typed('stop mocking the database in unit tests'))
  assert.equal(diff.list().length, 2, 'a new proposed entry')
})

test('C6: a "same" answer naming an id that was not a candidate proposes instead', async () => {
  const w = world()
  const m = await boot(w)
  seed(w, S)
  w.replies(rule('Never mock the database in unit tests'), JSON.stringify({ same: 'not-a-candidate' }))
  await submit(m, w, typed('stop mocking the database in unit tests'))
  assert.equal(w.list().length, 2)
})

test('C6: an accepted entry stays accepted when repeated', async () => {
  const w = world()
  const m = await boot(w)
  seed(w, S)
  const id = idOf(w)
  assert.equal(w.ac('principles', 'accept', id).exitCode, 0)
  w.replies(rule(S))
  await submit(m, w, typed('never mock the database'))
  const p = w.list().find((x) => x.id === id)
  assert.equal(p.status, 'accepted')
  assert.equal(w.list().length, 1)
  assert.equal(p.sightingCount, 1)
})

// ── C7 ─────────────────────────────────────────────────────────────────────────

const FIVE = [
  'Pin dependency versions in lockfiles',
  'Write the failing test before the fix',
  'Keep functions under a screenful',
  'Log errors with their cause attached',
  'Prefer composition over inheritance',
]

test('C7: at most 3 proposals per session, the rest silent, a repeat still sighted, a new session proposes again', async () => {
  const w = world()
  const m = await boot(w)
  for (const s of FIVE) {
    w.replies(rule(s))
    await submit(m, w, typed(`rule: ${s}`))
  }
  assert.equal(w.list('--proposed').length, 3)
  assert.equal(w.adds().length, 3, 'the 4th and 5th made no add')
  assert.deepEqual(w.logs, [], 'no notice at the cap')
  assert.deepEqual(w.toasts, [])

  w.replies(rule(FIVE[0]))
  await submit(m, w, typed('again'))
  assert.equal(w.list().find((p) => p.statement === FIVE[0]).sightingCount, 1, 'an exact repeat is still sighted')
  assert.equal(w.list().length, 3)

  await m.liveSessionStart(w.$, { cwd: w.cwd, surface: null, isInteractive: true }, next)
  w.sessionId = 'sess-2'
  w.replies(rule(FIVE[3]))
  await submit(m, w, typed(`rule: ${FIVE[3]}`))
  assert.equal(w.list().length, 4, 'a new session proposes again')
})

test('C7: sightings do not use up the 3 slots', async () => {
  const w = world()
  const m = await boot(w)
  seed(w, S)
  w.replies(rule(S))
  await submit(m, w, typed('never mock the database'))
  for (const s of FIVE.slice(0, 3)) {
    w.replies(rule(s))
    await submit(m, w, typed(`rule: ${s}`))
  }
  assert.equal(w.list().length, 4, 'one seeded and sighted, three proposed')
})

// ── C8 ─────────────────────────────────────────────────────────────────────────

async function twoProposals(w, m) {
  for (const s of FIVE.slice(0, 2)) {
    w.replies(rule(s))
    await submit(m, w, typed(`rule: ${s}`))
  }
}

test('C8: one quiet line at the first turn end after the count rises, then nothing, never a toast', async () => {
  const w = world()
  const m = await boot(w)
  await m.liveTurnComplete(w.$, turnDone(), next)
  assert.deepEqual(w.logs, [], 'nothing at zero')
  await twoProposals(w, m)
  const done = turnDone()
  assert.equal(await m.liveTurnComplete(w.$, done, next), done, 'the answer is never rewritten')
  assert.equal(w.logs.length, 1)
  assert.match(w.logs[0], NOTICE_RE)
  assert.equal(w.logs[0], '2 proposed — /astro-principles-review')
  await m.liveTurnComplete(w.$, turnDone(), next)
  assert.equal(w.logs.length, 1, 'the next turn with no new proposal says nothing new')
  assert.deepEqual(w.toasts, [])
})

test('C8: a subagent turn logs nothing; a sighting does not raise the count', async () => {
  const a = world()
  const ma = await boot(a)
  await twoProposals(a, ma)
  await ma.liveTurnComplete(a.$, turnDone({ agentId: 'sub-1' }), next)
  assert.deepEqual(a.logs, [])

  const b = world()
  const mb = await boot(b)
  seed(b, S)
  b.replies(rule(S))
  await submit(mb, b, typed('never mock the database'))
  await mb.liveTurnComplete(b.$, turnDone(), next)
  assert.deepEqual(b.logs, [])
  assert.deepEqual(badges(), [])
})

test('C8: when the band drew the count it is the band that shows it, not a second line', async () => {
  const w = world()
  const m = await boot(w)
  await twoProposals(w, m)
  claimBadges()
  await m.liveTurnComplete(w.$, turnDone(), next)
  assert.deepEqual(w.logs, [])
  assert.deepEqual(badges(), ['2 proposed — /astro-principles-review'])
  assert.deepEqual(w.toasts, [])
})

test('C8: a band claim from an earlier session does not hide the line once the band no longer draws', async () => {
  const w = world()
  const m = await boot(w)
  claimBadges() // the band drew in the previous session, then was switched off
  await m.liveSessionStart(w.$, { cwd: w.cwd, surface: null, isInteractive: true }, next)
  w.replies(rule('Never mock the database in integration tests'))
  await submit(m, w, typed('never mock the database'))
  await m.liveTurnComplete(w.$, turnDone(), next)
  assert.deepEqual(w.logs, ['1 proposed — /astro-principles-review'])
})

// ── C9 ─────────────────────────────────────────────────────────────────────────

const enoent = () => { throw Object.assign(new Error('spawn ac ENOENT'), { code: 'ENOENT' }) }
const FAILURES = {
  'the model throws': (w) => { w.reply = () => { throw new Error('model blocked') } },
  'the model answers non-JSON': (w) => { w.replies('sorry, I cannot tell') },
  'ac is missing': (w) => { w.replies(rule(S)); w.run = enoent },
  'add exits 1': (w) => { w.replies(rule(S)); w.run = (argv, _i, real) => (argv.includes('add') ? { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } : real(argv)) },
  'ac times out': (w) => { w.replies(rule(S)); w.run = async () => { await sleep(30); throw new Error('timed out') } },
}

for (const [label, arm] of Object.entries(FAILURES)) {
  test(`C9: fail open when ${label}`, async () => {
    const w = world()
    const m = await boot(w)
    arm(w)
    const t0 = Date.now()
    const e = typed('never mock the database')
    const out = await m.livePromptSubmit(w.$, e, next)
    assert.equal(out, e)
    assert.ok(Date.now() - t0 < 200, 'fast')
    await m.liveSettled()
    assert.deepEqual(w.list(), [], 'no partial store write')
    assert.deepEqual(w.toasts, [])
    assert.equal(w.logs.filter((l) => l.startsWith('⚠ principle capture failed:')).length, 1, `one notice: ${w.logs}`)
  })
}

test('C9: three failing prompts give one notice, and a new session recovers', async () => {
  const w = world()
  const m = await boot(w)
  FAILURES['the model throws'](w)
  for (let i = 0; i < 3; i++) await submit(m, w, typed(`never mock the database ${i}`))
  assert.equal(w.logs.filter((l) => l.startsWith('⚠ principle capture failed:')).length, 1)
  await m.liveSessionStart(w.$, { cwd: w.cwd, surface: null, isInteractive: true }, next)
  w.sessionId = 'sess-2'
  w.replies(rule(S))
  await submit(m, w, typed('never mock the database'))
  assert.equal(w.list('--proposed').length, 1)
})

// ── C10 ────────────────────────────────────────────────────────────────────────

test('C10: switched off, every hook passes the event and costs nothing', async () => {
  const w = world()
  const m = await boot(w, { on: false })
  w.replies(rule(S))
  const cmd = { command: 'astro-status', args: '', origin: { kind: 'composer' } }
  const prompt = typed('never mock the database')
  const done = turnDone()
  assert.equal(await m.liveCommandRun(w.$, cmd, next), cmd)
  assert.equal(await m.livePromptSubmit(w.$, prompt, next), prompt)
  await m.liveSettled()
  assert.equal(await m.liveTurnComplete(w.$, done, next), done)
  assert.equal(w.models.length, 0)
  assert.equal(w.argv.length, 0)
  assert.deepEqual(w.logs, [])
  assert.deepEqual(w.toasts, [])
})

// ── C11 parity with the single spec ────────────────────────────────────────────

test('C11: kinds, cap, ref shape and notice match templates/principle-capture.md', async () => {
  const m = await lc()
  const kinds = SPEC.slice(SPEC.indexOf('## 4.')).match(/One of exactly `([^`]+)`/)[1].split('|').map((s) => s.trim())
  assert.deepEqual([...m.LIVE_KINDS], kinds)
  assert.equal(m.LIVE_CAP, Number(SPEC.match(/at most \*\*(\d+)\*\* proposals per session/)[1]))
  assert.ok(SPEC.includes('"live <session-id>"'))
  assert.equal(`${m.LIVE_REF_PREFIX}<session-id>`, 'live <session-id>')
  const notice = SPEC.match(/`(N proposed — \/astro-principles-review)`/)[1]
  assert.equal(m.noticeText(2), notice.replace('N', '2'))
})

test('C11: the feature carries no word list: no regexp literal, no array of trigger words', () => {
  const code = readFileSync(FEATURE, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
  assert.ok(!/\bnew RegExp\b/.test(code), 'no RegExp constructor')
  assert.ok(!/[=(,:!&|?]\s*\/[^/*\s][^/\n]*\/[a-z]*\s*[.;,)]/.test(code), 'no regexp literal')
  assert.ok(!/['"`](always|never|must|from now on|d'ora in poi|sempre|mai)['"`]/i.test(code), 'no trigger words')
})

test('ADR-071 b: no command or agent mentions live-capture', () => {
  for (const dir of ['commands', 'agents']) {
    for (const f of walk(join(ROOT, dir))) assert.ok(!readFileSync(f, 'utf8').includes('live-capture'), `${f} mentions live-capture`)
  }
})

test('the plugin never calls a lifecycle verb (ADR-058)', () => {
  const offenders = ALL_ARGV.filter((a) => a.some((x) => LIFECYCLE.test(x)))
  // only the plugin's own calls are recorded: the harness accepts S through its own ac, not $.process.run
  assert.deepEqual(offenders, [])
})

after(() => resetSwitches())

// ── remediation c0: gate is the composer origin alone; a new session never inherits a capture ──

test('C2/C11: composer prompts starting with < or over 4000 chars are still judged', async () => {
  const w = world()
  const m = await boot(w)
  await submit(m, w, typed('<b>always</b> use semantic tags, never divs'))
  await submit(m, w, typed(`From now on never mock the db. ${'context '.repeat(600)}`))
  assert.equal(w.models.length, 2)
})

test('C1/C8: a capture in flight across session.start keeps its own session ref and shows no badge in the new one', async () => {
  const w = world()
  const m = await boot(w)
  w.reply = async () => { await sleep(80); return answered(rule('Never mock the database in integration tests')) }
  const job = m.livePromptSubmit(w.$, typed('never mock the db'), next)
  await job
  await sleep(10)
  await m.liveSessionStart(w.$, { cwd: w.cwd, surface: null, isInteractive: true }, next)
  w.sessionId = 'sess-NEW'
  await m.liveSettled().catch(() => {})
  await sleep(150)
  assert.equal(badges().length, 0, 'no badge for the old session in the new one')
  for (const p of w.list('--proposed')) assert.equal(p.source.ref, 'live sess-1')
})
