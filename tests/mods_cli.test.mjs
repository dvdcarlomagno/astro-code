// Phase 36 — `ac mods`: the user-facing switches for the optional astro-mods layer (ADR-071).
// Every test runs the real `ac` in a clean env (HOME = a temp dir, no inherited
// CLAUDE_CONFIG_DIR, PATH = a stub `claude` + /usr/bin:/bin) so it can never reach the
// developer's real profile or a real Claude binary. RED first: this file spawns the CLI only,
// importing nothing new but its own fixture (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { writeClaudeStub } from './fixtures/claude_stub.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const NAMES = ['canon-guard', 'git-guard', 'blindfold', 'spawn-policy', 'witness', 'brief-section', 'phase-band', 'live-capture'];
const HOOKS = ['canon-guard', 'git-guard'];
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

// A throwaway machine: HOME, a stub claude at `version`, and the files the stub keeps.
function box({ version = '2.1.292', config, noClaude = false } = {}) {
  const T = mkdtempSync(join(tmpdir(), 'ac-modscli-'));
  const bin = join(T, 'bin');
  const stateFile = join(T, 'claude-state.json');
  const logFile = join(T, 'claude.log');
  writeFileSync(logFile, '');
  writeClaudeStub(bin, { version, stateFile, logFile });
  const emptyBin = join(T, 'nobin');
  mkdirSync(emptyBin);
  const cfg = join(T, '.astro', 'config.json');
  if (config !== undefined) {
    mkdirSync(dirname(cfg), { recursive: true });
    writeFileSync(cfg, typeof config === 'string' ? config : JSON.stringify(config));
  }
  const PATH = [noClaude ? emptyBin : bin, '/usr/bin', '/bin'].join(':');
  const ac = (args, extra = {}) => spawnSync(process.execPath, [BIN, ...args], {
    cwd: T, env: { HOME: T, PATH, ...extra }, encoding: 'utf8',
  });
  const log = () => readFileSync(logFile, 'utf8');
  const state = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {});
  const status = (extra) => JSON.parse(ac(['mods', 'status', '--json'], extra).stdout);
  return { T, ac, log, state, status, cfg, PATH, stateFile };
}
// What `ac install` ships (phase 36 t9); seeded by hand here so this suite stands on its own.
function seedMarketplace(T) {
  const root = join(T, '.astro', 'code', 'mods');
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'astro-code', plugins: [{ name: 'astro-mods', source: './astro-mods' }] }));
  return root;
}
const out = (r) => `${r.stdout}${r.stderr}`;
const readCfg = (b) => JSON.parse(readFileSync(b.cfg, 'utf8'));

// ── C2: status ──────────────────────────────────────────────────────────────

test('mods status lists all eight features off, with kind and availability, outside any project and without writing', () => {
  const b = box();
  const human = b.ac(['mods', 'status']);
  assert.equal(human.status, 0, out(human));
  for (const n of NAMES) assert.match(human.stdout, new RegExp(n));
  const r = b.ac(['mods', 'status', '--json']);
  assert.equal(r.status, 0, out(r));
  const s = JSON.parse(r.stdout);
  assert.deepEqual(s.features.map((f) => f.name), NAMES);
  assert.ok(s.features.every((f) => f.on === false));
  assert.deepEqual(s.features.filter((f) => f.kind === 'hook').map((f) => f.name), HOOKS);
  assert.ok(s.features.every((f) => typeof f.canTakeEffect === 'boolean' && typeof f.why === 'string'));
  assert.equal(s.claude.found, true);
  assert.equal(s.claude.version, '2.1.292');
  assert.equal(s.claude.meetsFloor, true);
  assert.equal(s.plugin.installed, false);
  assert.equal(existsSync(b.cfg), false, 'a read never writes');
});

test('mods status <feature> covers only that feature; a config without a mods key is all off and untouched', () => {
  const b = box({ config: { agent_tools: {} } });
  const before = sha(b.cfg);
  const one = JSON.parse(b.ac(['mods', 'status', 'blindfold', '--json']).stdout);
  assert.deepEqual(one.features.map((f) => f.name), ['blindfold']);
  assert.ok(b.status().features.every((f) => f.on === false));
  assert.equal(sha(b.cfg), before);
});

test('--switches-only prints {switches, warnings} and never spawns claude', () => {
  const b = box({ config: { mods: { witness: true } } });
  const r = b.ac(['mods', 'status', '--json', '--switches-only']);
  assert.equal(r.status, 0, out(r));
  const s = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(s).sort(), ['switches', 'warnings']);
  assert.deepEqual(Object.keys(s.switches), NAMES);
  assert.equal(s.switches.witness, true);
  assert.equal(s.switches.blindfold, false);
  assert.equal(b.log(), '', 'the hot path never touches claude');
});

// ── C3: enable / disable ────────────────────────────────────────────────────

test('enable and disable flip exactly one switch and keep every sibling key; not-yet-built is said', () => {
  const b = box({ config: { agent_tools: { '*': ['mcp__x__y'] }, other: 1 } });
  const e = b.ac(['mods', 'enable', 'canon-guard']);
  assert.equal(e.status, 0, out(e));
  assert.match(e.stdout, /not built yet/);
  let on = b.status().features.filter((f) => f.on).map((f) => f.name);
  assert.deepEqual(on, ['canon-guard']);
  assert.deepEqual(readCfg(b).agent_tools, { '*': ['mcp__x__y'] });
  assert.equal(readCfg(b).other, 1);
  assert.equal(readCfg(b).mods['canon-guard'], true);
  b.ac(['mods', 'enable', 'git-guard']);
  const d = b.ac(['mods', 'disable', 'canon-guard']);
  assert.equal(d.status, 0, out(d));
  on = b.status().features.filter((f) => f.on).map((f) => f.name);
  assert.deepEqual(on, ['git-guard']);
});

test('an unparseable config is refused and left byte-identical', () => {
  const b = box({ config: '{oops' });
  const before = sha(b.cfg);
  const r = b.ac(['mods', 'enable', 'git-guard']);
  assert.notEqual(r.status, 0);
  assert.match(out(r), /✖/);
  assert.equal(sha(b.cfg), before);
});

// ── C4: unknown names ───────────────────────────────────────────────────────

test('a typo or unknown name is refused with the valid names and changes nothing', () => {
  const b = box({ config: { other: 1 } });
  const before = sha(b.cfg);
  for (const args of [['enable', 'blindfolds'], ['disable', 'nope'], ['status', 'nope']]) {
    const r = b.ac(['mods', ...args]);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(out(r), /✖/);
    assert.match(out(r), /blindfold/, 'lists the valid names');
  }
  assert.equal(sha(b.cfg), before);
  assert.ok(!/plugin/.test(b.log()));
  const fresh = box();
  fresh.ac(['mods', 'enable', 'blindfolds']);
  assert.equal(existsSync(fresh.cfg), false);
});

test('enable and disable without a feature die with usage', () => {
  const b = box();
  for (const sub of ['enable', 'disable']) {
    const r = b.ac(['mods', sub]);
    assert.notEqual(r.status, 0);
    assert.match(out(r), /usage/i);
  }
});

// ── C5: the version floor ───────────────────────────────────────────────────

test('on a claude below 2.1.292 a mod is recorded with exactly one floor warning and no plugin call', () => {
  const b = box({ version: '2.1.287' });
  const r = b.ac(['mods', 'enable', 'blindfold']);
  assert.equal(r.status, 0, out(r));
  assert.equal(out(r).split('\n').filter((l) => /2\.1\.292/.test(l)).length, 1, out(r));
  assert.ok(!/plugin/.test(b.log()));
  const f = b.status().features.find((x) => x.name === 'blindfold');
  assert.equal(f.on, true);
  assert.equal(f.canTakeEffect, false);
});

test('a hook-kind feature is not gated by the floor', () => {
  const b = box({ version: '2.1.287' });
  const r = b.ac(['mods', 'enable', 'canon-guard']);
  assert.equal(r.status, 0, out(r));
  assert.ok(!/2\.1\.292/.test(out(r)), 'no floor line for a hook');
  assert.ok(!/plugin/.test(b.log()));
});

test('with no claude on PATH a mod is recorded, called Claude Code-only, and nothing else changes', (t) => {
  const b = box({ noClaude: true });
  const probe = spawnSync('/bin/sh', ['-c', 'command -v claude'], { env: { PATH: b.PATH }, encoding: 'utf8' });
  if (probe.status === 0) return t.skip('a claude binary is on /usr/bin or /bin here');
  const r = b.ac(['mods', 'enable', 'witness']);
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /no Claude Code found/);
  assert.equal(readCfg(b).mods.witness, true);
  assert.equal(existsSync(join(b.T, '.astro', 'code')), false);
  const s = b.status();
  assert.equal(s.claude.found, false);
});

// ── C6: first enable installs, later ones do not, disable leaves it inert ───

test('the first mod enable installs astro-mods from the astro-code marketplace; later enables and disables do not touch it', () => {
  const b = box();
  const mods = seedMarketplace(b.T);
  const first = b.ac(['mods', 'enable', 'blindfold']);
  assert.equal(first.status, 0, out(first));
  assert.ok(b.log().includes(`plugin marketplace add ${mods}`), b.log());
  assert.match(b.log(), /plugin install astro-mods@astro-code/);
  assert.equal(b.status().plugin.installed, true);
  const installs = () => b.log().split('\n').filter((l) => /\tplugin install /.test(l)).length;
  const n = installs();
  b.ac(['mods', 'enable', 'witness']);
  assert.equal(installs(), n, 'no second install');
  b.ac(['mods', 'disable', 'blindfold']);
  const off = b.ac(['mods', 'disable', 'witness']);
  assert.match(off.stdout, /off/);
  assert.ok(!/uninstall|marketplace remove/.test(b.log()), 'disable leaves the plugin installed');
  assert.equal(b.status().plugin.installed, true);
  assert.deepEqual(b.state().default.plugins, ['astro-mods@astro-code']);
});

test('a hook-kind enable never installs the plugin', () => {
  const b = box();
  seedMarketplace(b.T);
  b.ac(['mods', 'enable', 'git-guard']);
  assert.ok(!/plugin/.test(b.log()));
});

// ── C7: a foreign astro-code marketplace ────────────────────────────────────

test('a foreign astro-code marketplace is reported with a fix, left untouched, and status agrees', () => {
  const b = box();
  seedMarketplace(b.T);
  writeFileSync(b.stateFile, JSON.stringify({ default: { marketplaces: [{ name: 'astro-code', path: '/somebody/elses' }], plugins: [] } }));
  const r = b.ac(['mods', 'enable', 'blindfold']);
  assert.equal(r.status, 1, out(r));
  assert.match(out(r), /fix: .*marketplace remove astro-code/);
  assert.deepEqual(b.state().default.marketplaces, [{ name: 'astro-code', path: '/somebody/elses' }]);
  const f = b.status().features.find((x) => x.name === 'blindfold');
  assert.equal(f.on, true);
  assert.equal(f.canTakeEffect, false);
});

// ── C10: every Claude config dir ────────────────────────────────────────────

function withProfile(b) {
  mkdirSync(join(b.T, '.claude', '.jean-claude'), { recursive: true });
  mkdirSync(join(b.T, 'p2'), { recursive: true });
  writeFileSync(join(b.T, '.claude', '.jean-claude', 'profiles.json'), JSON.stringify({ profiles: { p2: { configDir: join(b.T, 'p2') } } }));
}

test('the plugin reaches the base dir and every jean-claude profile', () => {
  const b = box();
  withProfile(b);
  seedMarketplace(b.T);
  const r = b.ac(['mods', 'enable', 'blindfold']);
  assert.equal(r.status, 0, out(r));
  const st = b.state();
  assert.deepEqual(st.default.plugins, ['astro-mods@astro-code']);
  assert.deepEqual(st[join(b.T, 'p2')].plugins, ['astro-mods@astro-code']);
  const s = b.status();
  assert.equal(s.plugin.dirs.length, 2);
  assert.ok(s.plugin.dirs.every((d) => d.installed));
});

test('a failed install leaves no dir with the marketplace but without the plugin', () => {
  const b = box();
  withProfile(b);
  seedMarketplace(b.T);
  const r = b.ac(['mods', 'enable', 'blindfold'], { CLAUDE_STUB_FAIL_INSTALL: '1' });
  assert.equal(r.status, 1, out(r));
  for (const s of Object.values(b.state())) {
    assert.equal(s.marketplaces.length > 0 && s.plugins.length === 0, false, 'half-installed dir');
  }
  assert.equal(b.status().features.find((f) => f.name === 'blindfold').on, true, 'the switch stays recorded');
});

// ── ADR-029: flag allowlists ────────────────────────────────────────────────

test('an unknown flag on enable fails and writes nothing', () => {
  const b = box();
  const r = b.ac(['mods', 'enable', 'blindfold', '--nope']);
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(b.cfg), false);
  assert.ok(!/plugin/.test(b.log()));
});
