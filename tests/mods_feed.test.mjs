// Phase 42 -- `ac mods feed brief-section` and `sessionParts`: the one place that says exactly what
// the SessionStart / PreCompact settings hooks print, so the brief-section mod can drop those
// outputs by exact content and never by guess (PLAN D3/D4). RED first (ADR-018): the new symbol
// is reached only by `await import(...)` inside a test body, the new verb only by spawning `ac`.
//
// Every test runs in a sandbox: HOME and ASTRO_PRINCIPLES_DIR are temp dirs, so nothing here can
// touch a developer's real ~/.astro. The store is seeded past 25,000 characters so the hooks
// really split the brief into several parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase, setPhaseStatus } from '../lib/roadmap.mjs';
import { addPrinciple } from '../lib/principles.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');
const UPDATE_HOOK = join(FRAMEWORK, 'hooks', 'astro-update.mjs');
const PRINCIPLES_HOOK = join(FRAMEWORK, 'hooks', 'astro-principles.mjs');
const PRECOMPACT_HOOK = join(FRAMEWORK, 'hooks', 'astro-precompact.mjs');

async function sandbox({ rules = 70, config } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ac-feed-home-'));
  const store = join(home, '.astro', 'principles');
  mkdirSync(store, { recursive: true });
  if (config) writeFileSync(join(home, '.astro', 'config.json'), JSON.stringify(config));
  const env = { ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store };
  const proj = mkdtempSync(join(tmpdir(), 'ac-feed-proj-'));
  git(['init', '--quiet'], { cwd: proj });
  git(['config', 'user.email', 'dev@example.com'], { cwd: proj });
  git(['config', 'user.name', 'dev'], { cwd: proj });
  initPlanning(proj, { name: 'feedproj' });
  await addPhase(proj, { number: 1, name: 'Do a thing' });
  const prev = process.env.ASTRO_PRINCIPLES_DIR;
  process.env.ASTRO_PRINCIPLES_DIR = store;
  try {
    for (let i = 0; i < rules; i++) {
      await addPrinciple(store, {
        statement: `rule ${i}: ${'always keep this behaviour stable and boring '.repeat(10)}`,
        kind: 'pattern', strength: 'rule', why: `why ${i}`, stack: [], files: [], work: [],
      });
    }
  } finally {
    if (prev === undefined) delete process.env.ASTRO_PRINCIPLES_DIR; else process.env.ASTRO_PRINCIPLES_DIR = prev;
  }
  return { home, store, proj, env };
}

const ac = (sb, args, cwd = sb.proj) => spawnSync(process.execPath, [AC, ...args], { cwd, env: sb.env, encoding: 'utf8' });
const hook = (sb, script, argv, input) => spawnSync(process.execPath, [script, ...argv], {
  input: JSON.stringify(input), env: sb.env, encoding: 'utf8',
});
const ctxOf = (r) => (JSON.parse(r.stdout || '{}').hookSpecificOutput || {}).additionalContext || '';

// What the hooks print, spawned exactly as Claude spawns them.
function hookParts(sb, n = 4) {
  const input = { cwd: sb.proj, source: 'startup' };
  const out = [ctxOf(hook(sb, UPDATE_HOOK, [], input))];
  for (let k = 2; k <= n; k++) out.push(ctxOf(hook(sb, PRINCIPLES_HOOK, [`${k}/${n}`], input)));
  return out.map((s) => s.trim()).filter(Boolean);
}
const hookPosition = (sb) => JSON.parse(hook(sb, PRECOMPACT_HOOK, [], { cwd: sb.proj }).stdout).systemMessage;

function listing(root) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      if (n === '.git') continue;
      const p = join(d, n);
      const st = statSync(p);
      out.push(`${p} ${st.isDirectory() ? 'd' : st.size}`);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out;
}

test('sessionParts equals, element for element, what the hooks print as additionalContext', async () => {
  const sb = await sandbox();
  const { sessionParts } = await import('../lib/retrieval.mjs');
  const want = hookParts(sb);
  assert.ok(want.length >= 3, `the seeded brief must split into at least 3 parts (got ${want.length})`);
  const got = await sessionParts({ dir: sb.store, cwd: sb.proj, n: 4 });
  assert.deepStrictEqual(got, want);
});

test('a brief small enough for one part gives exactly [BRIEF]', async () => {
  const sb = await sandbox({ rules: 2 });
  const { sessionParts } = await import('../lib/retrieval.mjs');
  const got = await sessionParts({ dir: sb.store, cwd: sb.proj, n: 4 });
  assert.strictEqual(got.length, 1);
  assert.deepStrictEqual(got, hookParts(sb));
});

test('sessionParts logs no usage (the hooks still do, as today)', async () => {
  const sb = await sandbox({ rules: 3 });
  const usage = join(sb.store, '.local', 'usage.jsonl');
  const before = existsSync(usage) ? statSync(usage).size : null;
  const { sessionParts } = await import('../lib/retrieval.mjs');
  await sessionParts({ dir: sb.store, cwd: sb.proj, n: 4 });
  assert.strictEqual(existsSync(usage) ? statSync(usage).size : null, before);
});

test('ac mods feed brief-section: serve, the hooks\' parts, and the PreCompact position', async () => {
  const sb = await sandbox();
  const r = ac(sb, ['mods', 'feed', 'brief-section']);
  assert.strictEqual(r.status, 0, r.stderr);
  const feed = JSON.parse(r.stdout);
  assert.strictEqual(feed.serve, true);
  assert.deepStrictEqual(feed.parts, hookParts(sb));
  assert.strictEqual(feed.position, hookPosition(sb));
  assert.ok(!feed.position.includes('\n'), 'the position is one line');
  assert.match(feed.position, /Next:/);
});

test('the position follows a lifecycle change', async () => {
  const sb = await sandbox({ rules: 1 });
  const before = JSON.parse(ac(sb, ['mods', 'feed', 'brief-section', '--position']).stdout).position;
  await setPhaseStatus(sb.proj, findPhase(sb.proj, '1').slug, 'verified');
  const after = JSON.parse(ac(sb, ['mods', 'feed', 'brief-section', '--position']).stdout).position;
  assert.notStrictEqual(after, before);
  assert.strictEqual(after, hookPosition(sb));
});

test('--position prints { position } only and never opens the principle store', async () => {
  const sb = await sandbox({ rules: 1 });
  chmodSync(sb.store, 0o000);
  try {
    const r = ac(sb, ['mods', 'feed', 'brief-section', '--position']);
    assert.strictEqual(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout);
    assert.deepStrictEqual(Object.keys(got), ['position']);
    assert.strictEqual(got.position, hookPosition(sb));
  } finally {
    chmodSync(sb.store, 0o755);
  }
});

test('serve is false outside an astro-code project, with no parts and no position', async () => {
  const sb = await sandbox({ rules: 1 });
  const bare = mkdtempSync(join(tmpdir(), 'ac-feed-bare-'));
  const r = ac(sb, ['mods', 'feed', 'brief-section'], bare);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), { serve: false, parts: [], position: '' });
});

test('serve is false when the user turned the session brief off (#116)', async () => {
  const sb = await sandbox({ rules: 1, config: { principles: { sessionBrief: false } } });
  const r = ac(sb, ['mods', 'feed', 'brief-section']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).serve, false);
});

test('an unknown flag is refused; an unknown feature dies naming the list', async () => {
  const sb = await sandbox({ rules: 1 });
  const bad = ac(sb, ['mods', 'feed', 'brief-section', '--bogus']);
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stderr, /unknown flag/i);
  assert.match(bad.stderr, /--bogus/);
  const nope = ac(sb, ['mods', 'feed', 'nope']);
  assert.notStrictEqual(nope.status, 0);
  assert.match(nope.stderr, /brief-section/);
  assert.match(nope.stderr, /canon-guard/, 'the feature list is named');
});

test('running the feed writes no file under HOME or the project', async () => {
  const sb = await sandbox({ rules: 3 });
  const before = [...listing(sb.home), ...listing(sb.proj)];
  assert.strictEqual(ac(sb, ['mods', 'feed', 'brief-section']).status, 0);
  assert.strictEqual(ac(sb, ['mods', 'feed', 'brief-section', '--position']).status, 0);
  assert.deepStrictEqual([...listing(sb.home), ...listing(sb.proj)], before);
});
