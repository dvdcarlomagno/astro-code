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

function box({ version = '2.1.292', noClaude = false } = {}) {
  const T = mkdtempSync(join(tmpdir(), 'ac-modslife-'));
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
function clone(T) {
  const remote = join(T, 'remote.git');
  const c = join(T, 'clone');
  const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  git(['init', '--bare', '-b', 'main', remote], T);
  git(['clone', remote, c], T);
  for (const [k, v] of [['user.email', 'a@b.c'], ['user.name', 'Test']]) git(['config', k, v], c);
  writeFileSync(join(c, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  cpSync(join(FRAMEWORK, 'mods'), join(c, 'mods'), { recursive: true });
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
