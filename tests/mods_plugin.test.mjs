// Phase 36 — the astro-mods plugin skeleton (ADR-071): it enforces NOTHING and fails open.
// RED first (ADR-018): the plugin's modules arrive only through `await import(...)` inside the
// test bodies, so a missing module fails each test on its own.
//
// The engine is the shared simulator in fixtures/mods_engine.mjs (phase 39 moved it there so the
// blindfold suite drives the same hooks). Event shapes come from PROBE.md: `session.start` is
// `{ cwd, surface, isInteractive }`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { boot, answer, switches, NAMES, SESSION_START, BENEATH } from './fixtures/mods_engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'mods', 'astro-mods');
const HOOKS = join(PLUGIN, 'hooks');
const PROBE_MDS = [
  join(ROOT, '.astrocode', 'phases', '36-astro-mods-foundation-adr-api-probe', 'PROBE.md'),
  join(ROOT, '.astrocode', 'phases', '39-blindfold-mod-plan-blind-verifier-and', 'PROBE.md'),
  join(ROOT, '.astrocode', 'phases', '41-witness-mod-detect-human-vs-agent', 'PROBE.md'),
];
const ARGV = ['ac', 'mods', 'status', '--json', '--switches-only'];

// ── switches all off ────────────────────────────────────────────────────────

test('with every switch off, every registered handler passes the event through untouched', async () => {
  const eng = await boot(answer(switches()));
  const names = eng.hooks.map((h) => h.name);
  assert.ok(names.includes('session.start') && names.includes('tool.check'), `registered: ${names}`);
  assert.ok(['command.run', 'prompt.submit', 'tool.call'].every((n) => names.includes(n)), `witness registers command.run, prompt.submit and tool.call (phase 41): ${names}`);
  assert.ok(names.every((n) => ['session.start', 'tool.check', 'agent.spawn', 'command.run', 'prompt.submit', 'tool.call'].includes(n)), `an unexpected hook: ${names}`);
  assert.ok(eng.hooks.every((h) => typeof h.catchHandler === 'function'), 'every hook has a fail-open .catch');
  const EVENTS = {
    'session.start': { ...SESSION_START },
    'tool.check': { tool: 'Read', input: { file_path: '/work/proj/.astrocode/phases/39-x/PLAN.md' }, tool_use_id: 'toolu_1', agentId: 'a1' },
    'agent.spawn': { subagentType: 'astro-verifier', prompt: 'p', tool_use_id: 'toolu_2' },
    'command.run': { command: 'astro-accept', args: '41', origin: { kind: 'composer' } },
    'prompt.submit': { text: '/astro-accept 41', origin: { kind: 'composer' } },
    'tool.call': { tool: 'Bash', command: 'ac phase accept 41', tool_use_id: 'toolu_3' },
  };
  for (const rec of eng.hooks) {
    const sentinel = { sentinel: rec.name };
    assert.equal(await eng.invoke(rec.name, EVENTS[rec.name], { beneath: sentinel }), sentinel, `${rec.name} resolves to next(e)'s value`);
  }
  assert.equal(await eng.invoke('tool.check', EVENTS['tool.check']), BENEATH);
  assert.deepEqual(eng.toasts, []);
});

test('session.start reads the switches through ac, with argv exactly and a timeout under the hook budget', async () => {
  const eng = await boot(answer(switches()));
  await eng.invoke('session.start', { ...SESSION_START });
  assert.equal(eng.runs.length, 1);
  assert.deepEqual(eng.runs[0].argv, ARGV);
  assert.ok(eng.runs[0].init.timeoutMs > 0 && eng.runs[0].init.timeoutMs <= 8000, 'stays under the session.start budget');
});

test('a switch that is on is read, and session.start still passes through', async () => {
  const eng = await boot(answer(switches({ blindfold: true, witness: true })));
  const e = { ...SESSION_START };
  assert.equal(await eng.invoke('session.start', e), e);
  assert.deepEqual(eng.toasts, []);
  const { isOn } = await import('../mods/astro-mods/hooks/lib/switches.js');
  assert.equal(isOn('blindfold'), true);
  assert.equal(isOn('witness'), true);
  assert.equal(isOn('spawn-policy'), false);
});

test('the plugin keeps no state of its own: what ac says on the next session.start is what it sees', async () => {
  const { isOn } = await import('../mods/astro-mods/hooks/lib/switches.js');
  const one = await boot(answer(switches({ blindfold: true })));
  await one.invoke('session.start', { ...SESSION_START });
  assert.equal(isOn('blindfold'), true);
  const two = await boot(answer(switches({ blindfold: false })));
  await two.invoke('session.start', { ...SESSION_START });
  assert.equal(isOn('blindfold'), false);
});

// ── ac missing, broken, or slow: pass through, tell the user ONCE ───────────

const FAILURES = {
  'ac is missing (the command cannot start)': async () => { throw new Error('spawn ac ENOENT'); },
  'ac exits 1': async () => ({ exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false }),
  'ac prints something that is not JSON': async () => ({ exitCode: 0, stdout: 'not json', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }),
  'ac never answers (process.run rejects at its timeout)': () => new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 20)),
  'ac prints JSON of the wrong shape': answer({ nope: true }),
};
for (const [label, impl] of Object.entries(FAILURES)) {
  test(`when ${label}: pass-through within a bound, no escaping rejection, exactly one toast across invocations, every mod off`, async () => {
    const eng = await boot(impl);
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      const e = { ...SESSION_START };
      assert.equal(await eng.invoke('session.start', e), e, `invocation ${i + 1} passes the event through`);
    }
    assert.ok(Date.now() - t0 < 2000, 'bounded time');
    assert.equal(eng.toasts.length, 1, `exactly one notice, got ${JSON.stringify(eng.toasts)}`);
    assert.match(eng.toasts[0], /astro-mods/);
    assert.match(eng.toasts[0], /letting the action through/);
    const { isOn } = await import('../mods/astro-mods/hooks/lib/switches.js');
    assert.ok(NAMES.every((n) => isOn(n) === false), 'a failed session.start leaves every switch off');
  });
}

test('a toast that throws (no UI under -p) never escapes', async () => {
  const eng = await boot(FAILURES['ac exits 1'], { toastThrows: true });
  const e = { ...SESSION_START };
  assert.equal(await eng.invoke('session.start', e), e);
  assert.equal(eng.toasts.length, 1);
});

// ── the plugin reads no event field PROBE.md has not observed ───────────────

function sources(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.js$/.test(f) ? [p] : [];
  });
}

test('no module reads an event field the PROBE.md files do not record as observed', () => {
  const probe = PROBE_MDS.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const file of sources(HOOKS)) {
    const text = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, field] of text.matchAll(/\be\.(\w+)/g)) {
      assert.ok(probe.includes(`\`${field}\``), `${file} reads e.${field}, which PROBE.md does not list`);
    }
    assert.ok(!/\be\[/.test(text), `${file} reads an event field by computed key`);
  }
});

// ── Claude Code's own checks, when a qualifying claude is on PATH ───────────

function claudeAtFloor() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return 'no claude on PATH';
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(r.stdout);
  if (!m) return 'unreadable claude version';
  const [a, b, c] = m.slice(1).map(Number);
  return a > 2 || (a === 2 && (b > 1 || (b === 1 && c >= 292))) ? false : `claude ${m[0]} < 2.1.292`;
}
const SKIP = claudeAtFloor();
const live = (args) => {
  const T = mkdtempSync(join(tmpdir(), 'ac-modsplug-'));
  return spawnSync('claude', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: T, CLAUDE_CONFIG_DIR: join(T, 'cfg') } });
};

for (const target of ['mods', 'mods/astro-mods', 'scripts/mods-probe']) {
  test(`claude plugin validate --strict ${target} passes`, { skip: SKIP }, () => {
    const r = live(['plugin', 'validate', '--strict', join(ROOT, target)]);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });
}

test('claude plugin test mods/astro-mods passes', { skip: SKIP }, () => {
  const r = live(['plugin', 'test', PLUGIN]);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

// ── witness (phase 41, ADR-074): who started the turn, and the gate calls it makes ──────────────
// `next` on tool.call is the identity here, so what `invoke` returns is exactly what the engine
// below would have received. features/witness.js is reached only through register.js and
// `await import`, so a missing module fails each test on its own (ADR-018).

const P41 = PROBE_MDS[2];
const HUMAN = '<!-- astro-discuss: captured -->';
const run = (command, args, kind = 'composer') => ({ name: 'command.run', e: { command, args, origin: { kind } } });
const submit = (text, kind = 'composer') => ({ name: 'prompt.submit', e: { text, origin: { kind } } });
const bash = (command, extra = {}) => ({ tool: 'Bash', command, description: 'd', tool_use_id: 'toolu_b', ...extra });
const CTX = '/p/.astrocode/phases/41-x/CONTEXT.md';
const write = (content, file_path = CTX) => ({ tool: 'Write', file_path, content, tool_use_id: 'toolu_w' });
const edit = (new_string, file_path = CTX) => ({ tool: 'Edit', file_path, old_string: 'x', new_string, replace_all: false, tool_use_id: 'toolu_e' });

const typedAccept = (n) => [run('astro-accept', String(n)), submit(`/astro-accept ${n}`)];
const typedFixAccept = (f) => [run('astro-fix-accept', f), submit(`/astro-fix-accept ${f}`)];
const typedDiscuss = (n) => [run('astro-discuss', String(n)), submit(`/astro-discuss ${n}`)];

async function armed(over = { witness: true }) {
  const eng = await boot(answer(switches(over)));
  await eng.invoke('session.start', { ...SESSION_START });
  return eng;
}
/** Fire each prompt-side event, then the tool.call; return what reached the engine below. */
async function turnThen(eng, events, call) {
  for (const ev of events) await eng.invoke(ev.name, ev.e);
  return eng.invoke('tool.call', call);
}

const W = ' --witnessed composer';
const A = ' --agent claude';
// [label, prompt events, tool.call, expected command (Bash) or [field, expected] (Write/Edit), toast on]
// expected `null` means byte-identical.
const AGENT_RE = /agent/;
const BASH = [
  ['C1 slash form, numeric ref', typedAccept(41), bash('ac phase accept 41'), `ac phase accept 41${W}`, null],
  ['C1 slash form, slug ref', typedAccept(41), bash('ac phase accept 41-witness-x'), `ac phase accept 41-witness-x${W}`, null],
  ['C1 bang form', [submit('! ac phase accept 41')], bash('ac phase accept 41'), `ac phase accept 41${W}`, null],
  ['C2a composer astro-autonomous', [run('astro-autonomous', ''), submit('/astro-autonomous')], bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  ['C2b sdk astro-accept', [run('astro-accept', '41', 'sdk'), submit('/astro-accept 41', 'sdk')], bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  ['C2c typed then task-notification', [...typedAccept(41), submit('<task-notification>done</task-notification>', 'task-notification')], bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  ['C2d typed for another phase', typedAccept(40), bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  ['C2e plugin origin', [run('astro-accept', '41', 'plugin'), submit('/astro-accept 41', 'plugin')], bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  ['C2 subagent call after a typed accept', typedAccept(41), bash('ac phase accept 41', { agentId: 'a1' }), `ac phase accept 41${A}`, AGENT_RE],
  ['C2 model-supplied --witnessed in an sdk turn', [run('astro-accept', '41', 'sdk'), submit('/astro-accept 41', 'sdk')], bash('ac phase accept 41 --witnessed composer'), `ac phase accept 41${A}`, AGENT_RE],
  ['C3 reject after typed accept', typedAccept(41), bash('ac phase reject 41 --reason x'), `ac phase reject 41${W} --reason x`, null],
  ['C3 reject after typed accept of another phase', typedAccept(40), bash('ac phase reject 41 --reason x'), `ac phase reject 41${A} --reason x`, AGENT_RE],
  ['C3 fix accept after typed fix-accept', typedFixAccept('foo'), bash('ac fix accept 2026-10-11-foo'), `ac fix accept 2026-10-11-foo${W}`, null],
  ['C3 fix accept after bang', [submit('! ac fix accept 2026-10-11-foo')], bash('ac fix accept 2026-10-11-foo'), `ac fix accept 2026-10-11-foo${W}`, null],
  ['C3 fix accept after another fix id', typedFixAccept('bar'), bash('ac fix accept 2026-10-11-foo'), `ac fix accept 2026-10-11-foo${A}`, AGENT_RE],
  ['C3 fix accept after typed phase accept', typedAccept(41), bash('ac fix accept 2026-10-11-foo'), `ac fix accept 2026-10-11-foo${A}`, AGENT_RE],
];
const IDENTICAL = [
  ['C4 declared --agent, sdk turn', [run('astro-accept', '41', 'sdk'), submit('/astro-accept 41', 'sdk')], bash('ac phase accept 41 --agent bot')],
  ['C4 declared --agent after typed accept', typedAccept(41), bash('ac phase accept 41 --agent bot')],
  ['C5 ambiguous bash -c', typedAccept(41), bash("bash -c 'ac phase accept 41'")],
  ['C5 no gate in the command', typedAccept(41), bash('ls -la')],
];
const FILES = [
  ['C6a Write after typed discuss', typedDiscuss(41), write(`${HUMAN}\nbody\n`), null],
  ['C6a Edit after typed discuss', typedDiscuss(41), edit(`${HUMAN}\nbody`), null],
  ['C6b Write after discuss of another phase', typedDiscuss(40), write(`${HUMAN}\nbody\n`), 'content'],
  ['C6b Edit after discuss of another phase', typedDiscuss(40), edit(`${HUMAN}\nbody`), 'new_string'],
  ['C6b Write after composer astro-autonomous', [run('astro-autonomous', ''), submit('/astro-autonomous')], write(`${HUMAN}\nbody\n`), 'content'],
  ['C6b Write in an sdk turn', [run('astro-discuss', '41', 'sdk'), submit('/astro-discuss 41', 'sdk')], write(`${HUMAN}\nbody\n`), 'content'],
];

for (const [label, events, call, want, toast] of BASH) {
  test(`witness on: ${label}`, async () => {
    const eng = await armed();
    const out = await turnThen(eng, events, call);
    assert.equal(out.command, want);
    assert.ok(!(/--agent/.test(out.command) && /--witnessed/.test(out.command)), 'never both');
    assert.equal(out.deny, undefined, 'never a deny');
    assert.equal(eng.toasts.length, toast ? 1 : 0, `toasts: ${JSON.stringify(eng.toasts)}`);
    if (toast) assert.match(eng.toasts[0], toast);
  });
}

for (const [label, events, call] of IDENTICAL) {
  test(`witness on: ${label} is byte-identical`, async () => {
    const eng = await armed();
    const out = await turnThen(eng, events, call);
    assert.deepEqual(out, call);
    assert.equal(out.command, call.command);
  });
}

test('C4 witness off: every C1-C3 and C6 scenario is byte-identical and silent', async () => {
  for (const [label, events, call] of [...BASH, ...FILES].map(([l, ev, c]) => [l, ev, c])) {
    const eng = await armed({ witness: false });
    const out = await turnThen(eng, events, call);
    assert.equal(out, call, `${label}: the very event, untouched`);
    assert.deepEqual(eng.toasts, [], label);
  }
});

test('C5 no prompt event after session.start: gate calls and a marker Write are byte-identical, one toast across them', async () => {
  const eng = await armed();
  for (const call of [bash('ac phase accept 41'), bash('ac fix accept foo'), write(`${HUMAN}\nbody\n`)]) {
    assert.deepEqual(await eng.invoke('tool.call', call), call);
  }
  assert.equal(eng.toasts.length, 1, JSON.stringify(eng.toasts));
  assert.match(eng.toasts[0], /could not tell/);
});

test('C5 a reload (session.start) loses the turn: the next gate call is byte-identical', async () => {
  const eng = await armed();
  for (const ev of typedAccept(41)) await eng.invoke(ev.name, ev.e);
  await eng.invoke('session.start', { ...SESSION_START });
  const call = bash('ac phase accept 41');
  assert.deepEqual(await eng.invoke('tool.call', call), call);
});

test('C5 malformed events never reject and pass through', async () => {
  const eng = await armed();
  for (const ev of typedAccept(41)) await eng.invoke(ev.name, ev.e);
  const bad = bash(42);
  assert.equal(await eng.invoke('tool.call', bad), bad);
  const noOrigin = { text: '/astro-accept 41' };
  assert.equal(await eng.invoke('prompt.submit', noOrigin), noOrigin);
  const call = bash('ac phase accept 41');
  assert.equal((await eng.invoke('tool.call', call)).command, 'ac phase accept 41', 'a missing origin makes the turn unknown');
});

test('C5 an empty-arg composer astro-accept leaves the call as declared and says it could not tell', async () => {
  const eng = await armed();
  const call = bash('ac phase accept 41');
  const out = await turnThen(eng, [run('astro-accept', ''), submit('/astro-accept')], call);
  assert.deepEqual(out, call);
  assert.equal(eng.toasts.length, 1);
  assert.match(eng.toasts[0], /could not tell/);
});

for (const [label, events, call, field] of FILES) {
  test(`witness on: ${label}`, async () => {
    const eng = await armed();
    const { AGENT_MARKER } = await import('../mods/astro-mods/hooks/lib/gates.js');
    const out = await turnThen(eng, events, call);
    if (field === null) {
      assert.deepEqual(out, call);
      assert.deepEqual(eng.toasts, []);
      return;
    }
    assert.equal(out[field], call[field].replace(HUMAN, AGENT_MARKER), 'line 1 only');
    assert.equal(out.file_path, call.file_path);
    assert.equal(eng.toasts.length, 1);
  });
}

test('C6c/d an agent-form marker, another file, or an Edit marker on line 3 is unchanged in every turn', async () => {
  const { AGENT_MARKER } = await import('../mods/astro-mods/hooks/lib/gates.js');
  const calls = [
    write(`${AGENT_MARKER}\nbody\n`),
    edit(`${AGENT_MARKER}\nbody`),
    write(`${HUMAN}\nbody\n`, '/p/notes/CONTEXT.md'),
    edit(`# t\n\n${HUMAN}`),
  ];
  for (const call of calls) {
    for (const events of [[run('astro-autonomous', ''), submit('/astro-autonomous')], [run('astro-discuss', '41', 'sdk'), submit('/astro-discuss 41', 'sdk')]]) {
      const eng = await armed();
      assert.deepEqual(await turnThen(eng, events, call), call);
    }
  }
});

test('C8 the UAT verdict in PROBE.md and the code agree', async () => {
  const v = /^Verdict \(decision 2\): (observable|not-observable)$/m.exec(readFileSync(P41, 'utf8'));
  assert.ok(v, 'PROBE.md carries exactly one machine-read verdict line');
  if (v[1] === 'not-observable') {
    const eng = await armed();
    const out = await turnThen(eng, typedAccept(41), bash('ac phase accept 41'));
    assert.equal(out.command, `ac phase accept 41${W}`, 'the typed command alone is the signal; no AskUserQuestion event is needed');
    const ask = { tool: 'AskUserQuestion', questions: [], tool_use_id: 'toolu_q' };
    assert.equal(await eng.invoke('tool.call', ask), ask, 'witness registers nothing for AskUserQuestion');
  } else {
    assert.fail('PROBE.md says observable: add the P7 accept/reject/absent cases from its recorded field paths');
  }
});
