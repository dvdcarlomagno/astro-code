// Phase 36 — how the astro-mods marketplace rides `ac install` / `ac update` / `ac uninstall`
// (PLAN P4, ADR-071). RED first: the real `ac` runs in a clean env (HOME = a temp dir, PATH =
// stub claude + stub npm + /usr/bin:/bin) against the stateful `claude` stub, so nothing here
// can reach a real profile. Only the stub fixture is imported (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { writeClaudeStub } from './fixtures/claude_stub.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(FRAMEWORK, 'bin', 'ac.mjs');
const PLUGIN = 'astro-mods@astro-code';

function box({ version = '2.1.292', noClaude = false, claudeHome = true } = {}) {
  const T = mkdtempSync(join(tmpdir(), 'ac-modslife-'));
  if (claudeHome) mkdirSync(join(T, '.claude')); // since phase 39 no plugin command runs against a missing dir; claudeHome:false is a bare machine
  const bin = join(T, 'bin');
  const stateFile = join(T, 'claude-state.json');
  const logFile = join(T, 'claude.log');
  writeFileSync(logFile, '');
  writeClaudeStub(bin, { version, stateFile, logFile });
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const emptyBin = join(T, 'nobin');
  mkdirSync(emptyBin);
  writeFileSync(join(emptyBin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const PATH = [noClaude ? emptyBin : bin, '/usr/bin', '/bin'].join(':');
  const ac = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: T, env: { HOME: T, PATH }, encoding: 'utf8' });
  const log = () => readFileSync(logFile, 'utf8');
  const lines = () => log().split('\n').filter(Boolean);
  const state = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {});
  return { T, ac, log, lines, state, stateFile, PATH };
}
const out = (r) => `${r.stdout}${r.stderr}`;
const mods = (T) => join(T, '.astro', 'code', 'mods');

// a synthetic upstream + clone the way hooks-update.test.mjs builds one, carrying the real mods/
function clone(T, { hooks = false } = {}) {
  const remote = join(T, 'remote.git');
  const c = join(T, 'clone');
  const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  mkdirSync(join(T, '.claude'), { recursive: true }); // update wires an existing config dir, as hooks-update.test.mjs does
  git(['init', '--bare', '-b', 'main', remote], T);
  git(['clone', remote, c], T);
  for (const [k, v] of [['user.email', 'a@b.c'], ['user.name', 'Test']]) git(['config', k, v], c);
  writeFileSync(join(c, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  cpSync(join(FRAMEWORK, 'mods'), join(c, 'mods'), { recursive: true });
  if (hooks) cpSync(join(FRAMEWORK, 'hooks'), join(c, 'hooks'), { recursive: true }); // update installs the clone's hooks
  git(['add', '.'], c); git(['commit', '-m', 'v0.1.0'], c); git(['push', '-u', 'origin', 'main'], c);
  return c;
}

// ── install ─────────────────────────────────────────────────────────────────

test('install ships the marketplace into the astro home, offers mods in one line, and calls no plugin command', () => {
  const b = box();
  const r = b.ac(['install']);
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout.split('\n').filter((l) => /ac mods enable/.test(l)).length, 1, r.stdout);
  assert.ok(existsSync(join(mods(b.T), '.claude-plugin', 'marketplace.json')));
  assert.ok(existsSync(join(mods(b.T), 'astro-mods', '.claude-plugin', 'plugin.json')));
  assert.ok(!/plugin/.test(b.log()), 'install never installs the plugin');
  assert.equal(existsSync(join(b.T, '.astro', 'config.json')), false, 'no switch is turned on');
});

test('install makes no mods offer on an old claude or with none on PATH, and still succeeds', () => {
  for (const opts of [{ version: '2.1.287' }, { noClaude: true }]) {
    const b = box(opts);
    const r = b.ac(['install']);
    assert.equal(r.status, 0, out(r));
    assert.ok(!/ac mods enable/.test(r.stdout), JSON.stringify(opts));
    assert.ok(!/plugin/.test(b.log()));
  }
});

test('re-install replaces the shipped mods tree, so a file deleted upstream is gone', () => {
  const b = box();
  b.ac(['install']);
  writeFileSync(join(mods(b.T), 'stale.txt'), 'old');
  const r = b.ac(['install']);
  assert.equal(r.status, 0, out(r));
  assert.equal(existsSync(join(mods(b.T), 'stale.txt')), false);
  assert.ok(existsSync(join(mods(b.T), '.claude-plugin', 'marketplace.json')));
});

// ── update ──────────────────────────────────────────────────────────────────

test('update does not install an absent plugin', () => {
  const b = box();
  const c = clone(b.T);
  const r = b.ac(['update', c]);
  assert.equal(r.status, 0, out(r));
  assert.ok(!/plugin (update|install)/.test(b.log()), b.log());
  assert.ok(existsSync(join(mods(b.T), '.claude-plugin', 'marketplace.json')), 'the shipped copy is refreshed');
});

test('update refreshes an installed plugin', () => {
  const b = box();
  const c = clone(b.T);
  b.ac(['install']);
  assert.equal(b.ac(['mods', 'enable', 'blindfold']).status, 0);
  const r = b.ac(['update', c]);
  assert.equal(r.status, 0, out(r));
  assert.match(b.log(), new RegExp(`plugin update ${PLUGIN} -y --json`));
  assert.match(r.stdout, /astro-mods refreshed/);
});

// ── uninstall ───────────────────────────────────────────────────────────────

test('uninstall removes the plugin before the marketplace in every dir it owns, and leaves a foreign marketplace alone', () => {
  const b = box();
  b.ac(['install']);
  // a second profile already holding someone else's astro-code marketplace
  mkdirSync(join(b.T, '.claude', '.jean-claude'), { recursive: true });
  mkdirSync(join(b.T, 'p2'), { recursive: true });
  writeFileSync(join(b.T, '.claude', '.jean-claude', 'profiles.json'), JSON.stringify({ profiles: { p2: { configDir: join(b.T, 'p2') } } }));
  writeFileSync(b.stateFile, JSON.stringify({ [join(b.T, 'p2')]: { marketplaces: [{ name: 'astro-code', path: '/somebody/elses' }], plugins: [] } }));
  b.ac(['mods', 'enable', 'blindfold']);
  assert.deepEqual(b.state().default.plugins, [PLUGIN]);

  const r = b.ac(['uninstall']);
  assert.equal(r.status, 0, out(r));
  const base = b.lines().filter((l) => l.startsWith('-\t'));
  const iU = base.findIndex((l) => l.includes(`plugin uninstall ${PLUGIN}`));
  const iM = base.findIndex((l) => l.includes('plugin marketplace remove astro-code'));
  assert.ok(iU >= 0 && iM > iU, base.join('\n'));
  assert.deepEqual(b.state().default.plugins, []);
  assert.deepEqual(b.state().default.marketplaces, []);
  assert.deepEqual(b.state()[join(b.T, 'p2')].marketplaces, [{ name: 'astro-code', path: '/somebody/elses' }]);
  assert.equal(existsSync(join(b.T, '.astro', 'code')), false);
});

test('uninstall with no claude on PATH succeeds silently and deletes the home', () => {
  const b = box({ noClaude: true });
  b.ac(['install']);
  const r = b.ac(['uninstall']);
  assert.equal(r.status, 0, out(r));
  assert.ok(!/✖|plugin/.test(out(r)));
  assert.equal(existsSync(join(b.T, '.astro', 'code')), false);
});

// ── Phase 37 C2: install / update / uninstall re-sync the canon-guard registration ──
// RED until t10: the switch is the registration, so every install reconciles it.

const GUARD = 'astro-canon-guard.mjs';
const jread = (f) => JSON.parse(readFileSync(f, 'utf8'));
const guardEntries = (s) => Object.values(s.hooks || {}).flat().filter((e) => (e.hooks || []).some((h) => String(h.command).includes(GUARD)));
const settingsOf = (d) => join(d, 'settings.json');

// base .claude plus the named jean-claude profiles; install, then enable canon-guard.
function guarded(profiles = {}) {
  const b = box();
  mkdirSync(join(b.T, '.claude', '.jean-claude'), { recursive: true });
  const reg = {};
  for (const [n, d] of Object.entries(profiles)) { mkdirSync(d(b.T), { recursive: true }); reg[n] = { configDir: d(b.T) }; }
  const writeReg = (extra = {}) => writeFileSync(join(b.T, '.claude', '.jean-claude', 'profiles.json'), JSON.stringify({ profiles: { ...reg, ...extra } }));
  writeReg();
  assert.equal(b.ac(['install']).status, 0);
  assert.equal(b.ac(['mods', 'enable', 'canon-guard']).status, 0);
  return { b, writeReg };
}
// exactly one guard entry in `dir`, and feeding its command a Write to a protected file is denied
function works(b, dir) {
  const g = guardEntries(jread(settingsOf(dir)));
  assert.equal(g.length, 1, `${dir}: exactly one guard entry`);
  const cmd = g[0].hooks.find((h) => h.command.includes(GUARD)).command;
  const P = mkdtempSync(join(tmpdir(), 'ac-modsproj-'));
  mkdirSync(join(P, '.astrocode'), { recursive: true });
  const ev = { hook_event_name: 'PreToolUse', cwd: P, tool_name: 'Write', tool_input: { file_path: join(P, '.astrocode', 'state.json'), content: 'x' } };
  const r = spawnSync('/bin/sh', ['-c', cmd], { input: JSON.stringify(ev), encoding: 'utf8', env: { HOME: b.T, PATH: b.PATH } });
  assert.ok(r.status === 2 || /"permissionDecision":\s*"deny"/.test(r.stdout), `${dir}: the entry denies — ${r.stdout}${r.stderr}`);
}

test('a profile added after enable gets exactly one working guard entry on the next install', () => {
  const { b, writeReg } = guarded();
  const third = join(b.T, 'third');
  mkdirSync(third);
  writeReg({ third: { configDir: third } });
  const r = b.ac(['install']);
  assert.equal(r.status, 0, out(r));
  works(b, third);
  works(b, join(b.T, '.claude'));
});

test('a hand-deleted guard entry is restored by install, with no duplicates anywhere', () => {
  const { b } = guarded({ work: (T) => join(T, '.claude-work') });
  const work = join(b.T, '.claude-work');
  const s = jread(settingsOf(work));
  for (const k of Object.keys(s.hooks)) s.hooks[k] = s.hooks[k].filter((e) => guardEntries({ hooks: { x: [e] } }).length === 0);
  writeFileSync(settingsOf(work), JSON.stringify(s));
  assert.equal(guardEntries(jread(settingsOf(work))).length, 0);
  assert.equal(b.ac(['install']).status, 0);
  works(b, work);
  works(b, join(b.T, '.claude'));
  assert.equal(b.ac(['install']).status, 0);
  works(b, work);
});

test('with the switch off a planted guard entry is removed by install', () => {
  const { b } = guarded({ work: (T) => join(T, '.claude-work') });
  const work = join(b.T, '.claude-work');
  const entry = guardEntries(jread(settingsOf(work)))[0];
  assert.ok(entry, 'enable registered an entry to copy');
  assert.equal(b.ac(['mods', 'disable', 'canon-guard']).status, 0);
  assert.equal(guardEntries(jread(settingsOf(work))).length, 0);
  const s = jread(settingsOf(work));
  s.hooks = { ...(s.hooks || {}), PreToolUse: [...((s.hooks || {}).PreToolUse || []), entry] };
  writeFileSync(settingsOf(work), JSON.stringify(s));
  assert.equal(guardEntries(jread(settingsOf(work))).length, 1, 'planted');
  assert.equal(b.ac(['install']).status, 0);
  for (const d of [work, join(b.T, '.claude')]) assert.equal(guardEntries(jread(settingsOf(d))).length, 0, d);
});

test('update re-syncs too: a later-added profile gets one working guard entry', () => {
  const { b, writeReg } = guarded();
  const c = clone(b.T, { hooks: true });
  const third = join(b.T, 'third');
  mkdirSync(third);
  writeReg({ third: { configDir: third } });
  const r = b.ac(['update', c]);
  assert.equal(r.status, 0, out(r));
  works(b, third);
  works(b, join(b.T, '.claude'));
});

test('uninstall leaves no guard entry in any profile', () => {
  const { b } = guarded({ work: (T) => join(T, '.claude-work') });
  works(b, join(b.T, '.claude'));
  const r = b.ac(['uninstall']);
  assert.equal(r.status, 0, out(r));
  for (const d of [join(b.T, '.claude'), join(b.T, '.claude-work')]) {
    const f = settingsOf(d);
    if (existsSync(f)) assert.equal(guardEntries(jread(f)).length, 0, d);
  }
});

// ── Phase 38: the same re-sync for git-guard ────────────────────────────────

const GGUARD = 'astro-git-guard.mjs';
const gitEntries = (s) => Object.values(s.hooks || {}).flat().filter((e) => (e.hooks || []).some((h) => String(h.command).includes(GGUARD)));

function gitGuarded(profiles = {}) {
  const b = box();
  mkdirSync(join(b.T, '.claude', '.jean-claude'), { recursive: true });
  const reg = {};
  for (const [n, d] of Object.entries(profiles)) { mkdirSync(d(b.T), { recursive: true }); reg[n] = { configDir: d(b.T) }; }
  const writeReg = (extra = {}) => writeFileSync(join(b.T, '.claude', '.jean-claude', 'profiles.json'), JSON.stringify({ profiles: { ...reg, ...extra } }));
  writeReg();
  assert.equal(b.ac(['install']).status, 0);
  assert.equal(b.ac(['mods', 'enable', 'git-guard']).status, 0);
  return { b, writeReg };
}
// exactly one git-guard entry in `dir`, and it asks on `git stash -u`
function gitWorks(b, dir) {
  const g = gitEntries(jread(settingsOf(dir)));
  assert.equal(g.length, 1, `${dir}: exactly one git-guard entry`);
  const cmd = g[0].hooks.find((h) => h.command.includes(GGUARD)).command;
  const ev = { hook_event_name: 'PreToolUse', cwd: b.T, tool_name: 'Bash', tool_input: { command: 'git stash -u' } };
  const r = spawnSync('/bin/sh', ['-c', cmd], { input: JSON.stringify(ev), encoding: 'utf8', env: { HOME: b.T, PATH: b.PATH } });
  assert.match(r.stdout, /"permissionDecision":\s*"ask"/, `${dir}: the entry asks — ${r.stdout}${r.stderr}`);
}

test('git-guard: a profile added after enable gets one working entry on the next install', () => {
  const { b, writeReg } = gitGuarded();
  const third = join(b.T, 'third');
  mkdirSync(third);
  writeReg({ third: { configDir: third } });
  assert.equal(b.ac(['install']).status, 0);
  gitWorks(b, third);
  gitWorks(b, join(b.T, '.claude'));
});

test('git-guard: a hand-deleted entry is restored by install, with no duplicates', () => {
  const { b } = gitGuarded({ work: (T) => join(T, '.claude-work') });
  const work = join(b.T, '.claude-work');
  const s = jread(settingsOf(work));
  for (const k of Object.keys(s.hooks)) s.hooks[k] = s.hooks[k].filter((e) => gitEntries({ hooks: { x: [e] } }).length === 0);
  writeFileSync(settingsOf(work), JSON.stringify(s));
  assert.equal(gitEntries(jread(settingsOf(work))).length, 0);
  assert.equal(b.ac(['install']).status, 0);
  gitWorks(b, work);
  assert.equal(b.ac(['install']).status, 0);
  gitWorks(b, work);
});

test('git-guard: with the switch off a planted entry is removed by install', () => {
  const { b } = gitGuarded({ work: (T) => join(T, '.claude-work') });
  const work = join(b.T, '.claude-work');
  const entry = gitEntries(jread(settingsOf(work)))[0];
  assert.ok(entry);
  assert.equal(b.ac(['mods', 'disable', 'git-guard']).status, 0);
  const s = jread(settingsOf(work));
  s.hooks = { ...(s.hooks || {}), PreToolUse: [...((s.hooks || {}).PreToolUse || []), entry] };
  writeFileSync(settingsOf(work), JSON.stringify(s));
  assert.equal(b.ac(['install']).status, 0);
  for (const d of [work, join(b.T, '.claude')]) assert.equal(gitEntries(jread(settingsOf(d))).length, 0, d);
});

test('git-guard: update re-syncs a later-added profile', () => {
  const { b, writeReg } = gitGuarded();
  const c = clone(b.T, { hooks: true });
  const third = join(b.T, 'third');
  mkdirSync(third);
  writeReg({ third: { configDir: third } });
  const r = b.ac(['update', c]);
  assert.equal(r.status, 0, out(r));
  gitWorks(b, third);
  gitWorks(b, join(b.T, '.claude'));
});

test('git-guard: uninstall leaves no entry in any profile', () => {
  const { b } = gitGuarded({ work: (T) => join(T, '.claude-work') });
  gitWorks(b, join(b.T, '.claude'));
  assert.equal(b.ac(['uninstall']).status, 0);
  for (const d of [join(b.T, '.claude'), join(b.T, '.claude-work')]) {
    if (existsSync(settingsOf(d))) assert.equal(gitEntries(jread(settingsOf(d))).length, 0, d);
  }
});
