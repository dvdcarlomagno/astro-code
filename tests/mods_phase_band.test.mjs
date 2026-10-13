// Phase 43 t3 — the phase-band view model (pure helpers, no `$`, no fs).
// Symbols arrive through `await import(...)` inside each test (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const band = () => import('../mods/astro-mods/hooks/lib/band.js');

const STATUS = {
  root: '/p', project: 'p', milestone: 12,
  phase: { number: 38, slug: '38-x', name: 'X', status: 'pending' },
  next: '/astro-execute 38',
  siblings: ['/astro-discuss 44', '/astro-accept 40', '/astro-plan 45'],
  phases: [
    { number: 38, name: 'X', slug: '38-x', status: 'pending', planned: true, discussed: true },
    { number: 40, name: 'Y', slug: '40-y', status: 'verified', planned: true, discussed: true },
    { number: 41, name: 'Z', slug: '41-z', status: 'complete', planned: true, discussed: true },
  ],
  activity: null,
};

test('readJsonResult: parsed object, or null for every failure, never throws', async () => {
  const { readJsonResult } = await band();
  assert.deepEqual(readJsonResult({ exitCode: 0, stdout: '{"a":1}' }), { a: 1 });
  for (const ran of [
    { exitCode: 1, stdout: '{"a":1}' },
    { exitCode: 0, stdout: 'nope' },
    { exitCode: 0, stdout: '{"a":' },
    { exitCode: 0, stdout: '{"a":1}', isStdoutTruncated: true },
    { exitCode: 0, stdout: '5' },
    { exitCode: 0, stdout: 'null' },
    { exitCode: 0, stdout: '"s"' },
    { exitCode: 0 },
    null,
    undefined,
  ]) assert.equal(readJsonResult(ran), null);
});

test('rootCandidates: cwd/.astrocode then each parent up to /', async () => {
  const { rootCandidates } = await band();
  assert.deepEqual(rootCandidates('/a/b/c'), ['/a/b/c/.astrocode', '/a/b/.astrocode', '/a/.astrocode', '/.astrocode']);
  assert.deepEqual(rootCandidates('/'), ['/.astrocode']);
  assert.deepEqual(rootCandidates('/a/b/'), ['/a/b/.astrocode', '/a/.astrocode', '/.astrocode']);
});

test('signature: changes with any mtime, ignores order', async () => {
  const { signature } = await band();
  const a = [{ path: '/x', mtimeMs: 1 }, { path: '/y', mtimeMs: null }];
  assert.equal(signature(a), signature([...a].reverse()));
  assert.notEqual(signature(a), signature([{ path: '/x', mtimeMs: 2 }, { path: '/y', mtimeMs: null }]));
  assert.notEqual(signature(a), signature([{ path: '/x', mtimeMs: 1 }, { path: '/y', mtimeMs: 3 }]));
});

test('stalePaths: state files plus non-complete phase dirs, all inside .astrocode', async () => {
  const { stalePaths } = await band();
  for (const root of ['/p', '/p/.astrocode']) {
    const paths = stalePaths(root, STATUS);
    assert.ok(paths.every(p => p.startsWith('/p/.astrocode/')), root);
    for (const f of ['state', 'roadmap', 'debt', 'backlog', 'fixes']) assert.ok(paths.includes(`/p/.astrocode/${f}.json`), f);
    assert.ok(paths.includes('/p/.astrocode/phases/38-x'));
    assert.ok(paths.includes('/p/.astrocode/phases/40-y'));
    assert.ok(!paths.some(p => p.endsWith('/phases/41-z')));
  }
  assert.equal(stalePaths('/p', { ...STATUS, phases: undefined }).length, 5);
});

test('bandView: idle is one line, next first, at most 3 buttons, deduped', async () => {
  const { bandView } = await band();
  const v = bandView(STATUS, null, {});
  assert.deepEqual(v.lines, ['M12 · P38 pending']);
  assert.deepEqual(v.buttons.map(b => b.command), ['/astro-execute 38', '/astro-discuss 44', '/astro-accept 40']);
  assert.equal(v.buttons[0].label, 'Execute 38');
  assert.equal(new Set(v.buttons.map(b => b.key)).size, v.buttons.length);
  const d = bandView({ ...STATUS, siblings: ['/astro-execute 38', '/astro-plan 3'] }, null, {});
  assert.deepEqual(d.buttons.map(b => b.command), ['/astro-execute 38', '/astro-plan 3']);
});

test('bandView: drops commands that are not loop verbs with a numeric id', async () => {
  const { bandView } = await band();
  const v = bandView({ ...STATUS, next: '/astro-status', siblings: ['/astro-plan 38-slug', '/astro-debt-pay 3', 'x', '/astro-verify 7'] }, null, {});
  assert.deepEqual(v.buttons.map(b => b.command), ['/astro-verify 7']);
});

test('bandView: activity joins the idle line; no current phase still draws one line', async () => {
  const { bandView } = await band();
  const v = bandView({ ...STATUS, activity: '⚙ executing' }, null, {});
  assert.equal(v.lines.length, 1);
  assert.match(v.lines[0], /^M12 · P38 pending .*⚙ executing$/);
  assert.equal(bandView({ ...STATUS, phase: null }, null, {}).lines.length, 1);
});

test('bandView: live lists each agent; null agents says so plainly', async () => {
  const { bandView } = await band();
  const v = bandView(STATUS, { live: true, agents: [{ name: 'astro-executor', state: 'running' }, { name: 'astro-verifier', state: 'failed' }], source: 'agent.list' }, {});
  assert.deepEqual(v.lines.slice(1), ['astro-executor — running', 'astro-verifier — failed']);
  const w = bandView({ ...STATUS, activity: '⚙ executing' }, { live: true, agents: null, source: 'activity' }, {});
  assert.equal(w.lines.length, 3);
  assert.match(w.lines[1], /workflow agents are not individually visible/);
  assert.match(w.lines[2], /executing/);
  assert.match(w.lines[2], /activity/);
  assert.equal(bandView(STATUS, { live: false, agents: null, source: 'activity' }, {}).lines.length, 1);
});

test('bandView: unavailable is one dim line, reason capped, no buttons', async () => {
  const { bandView } = await band();
  const v = bandView(STATUS, null, { unavailable: 'x'.repeat(200) });
  assert.deepEqual(v.buttons, []);
  assert.equal(v.lines.length, 1);
  assert.match(v.lines[0], /^astro-code status unavailable \(x{60}\)$/);
  assert.deepEqual(bandView(null, null, { unavailable: 'ac exited 1' }).lines, ['astro-code status unavailable (ac exited 1)']);
});

test('bandView: null status and not unavailable draws nothing', async () => {
  const { bandView } = await band();
  assert.deepEqual(bandView(null, null, {}), { lines: [], buttons: [] });
  assert.deepEqual(bandView(undefined, null), { lines: [], buttons: [] });
});

test('liveFrom: only executor/verifier, status mapped, unknown reads running', async () => {
  const { liveFrom } = await band();
  const rows = [
    { type: 'astro-executor', status: 'running', name: 'e1' },
    { type: 'astro-verifier', status: 'completed', name: 'v1' },
    { type: 'astro-executor', status: 'failed', name: 'e2' },
    { type: 'astro-executor', status: 'weird', name: 'e3' },
    { type: 'Explore', status: 'running', name: 'x' },
  ];
  assert.deepEqual(liveFrom(rows, null, true), {
    live: true,
    agents: [
      { name: 'e1', state: 'running' }, { name: 'v1', state: 'done' },
      { name: 'e2', state: 'failed' }, { name: 'e3', state: 'running' },
    ],
    source: 'agent.list',
  });
});

test('liveFrom: all done and no activity is not live; activity alone makes it live', async () => {
  const { liveFrom } = await band();
  const done = [{ type: 'astro-executor', status: 'completed', name: 'e' }];
  assert.equal(liveFrom(done, null, true).live, false);
  assert.equal(liveFrom(done, '⚙ executing', true).live, true);
  assert.equal(liveFrom([], null, true).live, false);
  assert.equal(liveFrom(undefined, null, true).live, false);
});

test('liveFrom: workflow agents not listed gives activity source, null agents, never fabricated', async () => {
  const { liveFrom } = await band();
  assert.deepEqual(liveFrom([], '⚙ executing', false), { live: true, agents: null, source: 'activity' });
  const kept = liveFrom([{ type: 'astro-executor', status: 'running', name: 'e' }], null, false);
  assert.deepEqual(kept, { live: true, agents: [{ name: 'e', state: 'running' }], source: 'activity' });
});
