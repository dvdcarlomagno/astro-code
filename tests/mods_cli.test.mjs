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
function box({ version = '2.1.292', config, noClaude = false, claudeHome = true } = {}) {
  const T = mkdtempSync(join(tmpdir(), 'ac-modscli-'));
  if (claudeHome) mkdirSync(join(T, '.claude')); // since phase 39 no plugin command runs against a missing dir; claudeHome:false is a bare machine
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
  assert.doesNotMatch(e.stdout, /not built yet/, 'canon-guard is built (phase 37)');
  let on = b.status().features.filter((f) => f.on).map((f) => f.name);
  assert.deepEqual(on, ['canon-guard']);
  assert.deepEqual(readCfg(b).agent_tools, { '*': ['mcp__x__y'] });
  assert.equal(readCfg(b).other, 1);
  assert.equal(readCfg(b).mods['canon-guard'], true);
  const g = b.ac(['mods', 'enable', 'git-guard']);
  assert.doesNotMatch(g.stdout, /not built yet/, 'git-guard is built (phase 38)');
  b.ac(['mods', 'enable', 'witness']);
  assert.match(b.ac(['mods', 'status', 'witness']).stdout, /not built yet/, 'an unbuilt feature still says so');
  b.ac(['mods', 'disable', 'witness']);
  b.ac(['mods', 'enable', 'spawn-policy']);
  const sp = b.ac(['mods', 'status', 'spawn-policy']);
  assert.match(sp.stdout, /not built yet/);
  assert.doesNotMatch(sp.stdout, /haiku|pin/i);
  const desc = b.status().features.find((f) => f.name === 'spawn-policy').description;
  assert.match(desc, /isolation/);
  assert.doesNotMatch(desc, /haiku|pin/i);
  b.ac(['mods', 'disable', 'spawn-policy']);
  b.ac(['mods', 'enable', 'blindfold']);
  assert.doesNotMatch(b.ac(['mods', 'status', 'blindfold']).stdout, /not built yet/, 'blindfold is built (phase 39)');
  b.ac(['mods', 'disable', 'blindfold']);
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

// ── Phase 37: canon-guard is a settings-hook registration ───────────────────
// RED until t10: enable/disable/status wire, remove and report the entry per config dir.

const GUARD = 'astro-canon-guard.mjs';
const FIVE = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];
const jread = (f) => JSON.parse(readFileSync(f, 'utf8'));
const guardEntries = (settings) => Object.values(settings.hooks || {}).flat()
  .filter((e) => (e.hooks || []).some((h) => String(h.command).includes(GUARD)));

// Claude base dir + a jean-claude profile `work`, each holding a user PreToolUse hook and an
// unrelated key; `ac install` has run (it ships the hook script), then the files are copied.
function twoProfiles(b, extra = {}) {
  const work = join(b.T, '.claude-work');
  mkdirSync(join(b.T, '.claude', '.jean-claude'), { recursive: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(join(b.T, '.claude', '.jean-claude', 'profiles.json'), JSON.stringify({ profiles: { work: { configDir: work } } }));
  const dirs = [join(b.T, '.claude'), work];
  for (const d of dirs) {
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ keep: d, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] }] } }));
  }
  assert.equal(b.ac(['install'], extra).status, 0);
  return { dirs, saved: dirs.map((d) => jread(join(d, 'settings.json'))) };
}
// A temp project holding a protected file; feed `command` the Claude PreToolUse event.
function feedWrite(b, command, file = '.astrocode/state.json') {
  const P = mkdtempSync(join(tmpdir(), 'ac-modsproj-'));
  mkdirSync(join(P, '.astrocode'), { recursive: true });
  writeFileSync(join(P, '.astrocode', 'state.json'), '{}');
  const payload = { hook_event_name: 'PreToolUse', cwd: P, tool_name: 'Write', tool_input: { file_path: join(P, file), content: 'x' } };
  return spawnSync('/bin/sh', ['-c', command], { input: JSON.stringify(payload), encoding: 'utf8', env: { HOME: b.T, PATH: b.PATH } });
}
function denied(r) {
  if (r.status === 2) return true;
  try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision === 'deny'; } catch { return false; }
}

test('enable canon-guard registers exactly one five-tool entry per Claude profile, twice over, and the entry denies', () => {
  const b = box();
  const { dirs } = twoProfiles(b);
  for (let i = 0; i < 2; i++) {
    const r = b.ac(['mods', 'enable', 'canon-guard']);
    assert.equal(r.status, 0, out(r));
  }
  for (const d of dirs) {
    const s = jread(join(d, 'settings.json'));
    const g = guardEntries(s);
    assert.equal(g.length, 1, `${d}: one guard entry`);
    assert.deepEqual(FIVE.filter((t) => !g[0].matcher.split('|').includes(t)), [], 'matcher covers all five tools');
    assert.ok(s.hooks.PreToolUse.some((e) => e.hooks.some((h) => h.command === 'echo user-hook')), 'user hook kept');
    const cmd = g[0].hooks.find((h) => h.command.includes(GUARD)).command;
    assert.ok(denied(feedWrite(b, cmd)), `${d}: a Write to .astrocode/state.json is denied`);
    assert.ok(!denied(feedWrite(b, cmd, 'src/a.js')), 'an unprotected Write is allowed');
  }
});

test('status canon-guard reports on and enforced per profile, and missing after a hand-deleted entry', () => {
  const b = box();
  const { dirs } = twoProfiles(b);
  b.ac(['mods', 'enable', 'canon-guard']);
  const feature = () => b.status().features.find((f) => f.name === 'canon-guard');
  const rows = () => feature().enforcement.filter((x) => x.host === 'claude');
  assert.equal(feature().on, true);
  assert.deepEqual(rows().map((x) => [x.dir, x.state]), dirs.map((d) => [d, 'enforced']));
  const human = b.ac(['mods', 'status', 'canon-guard']);
  assert.equal(human.status, 0, out(human));
  assert.doesNotMatch(human.stdout, /not built yet/);
  assert.ok((human.stdout.match(/enforced/g) || []).length >= 2, human.stdout);
  // hand-delete the entry from the work profile
  const file = join(dirs[1], 'settings.json');
  const s = jread(file);
  s.hooks.PreToolUse = s.hooks.PreToolUse.filter((e) => guardEntries({ hooks: { x: [e] } }).length === 0);
  writeFileSync(file, JSON.stringify(s));
  assert.deepEqual(rows().map((x) => x.state), ['enforced', 'missing']);
  assert.match(b.ac(['mods', 'status', 'canon-guard']).stdout, /missing/);
});

test('with Cursor present, status states the Cursor position explicitly', () => {
  const b = box();
  twoProfiles(b);
  const CURSOR_CONFIG_DIR = join(b.T, 'cursor');
  mkdirSync(CURSOR_CONFIG_DIR);
  b.ac(['mods', 'enable', 'canon-guard'], { CURSOR_CONFIG_DIR });
  const f = b.status({ CURSOR_CONFIG_DIR }).features.find((x) => x.name === 'canon-guard');
  const c = f.enforcement.filter((x) => x.host === 'cursor');
  assert.equal(c.length, 1);
  assert.match(c[0].state, /^(enforced|via-claude-import|not-enforced)$/);
  assert.match(b.ac(['mods', 'status', 'canon-guard'], { CURSOR_CONFIG_DIR }).stdout, /cursor/i);
});

test('disable canon-guard leaves every settings.json JSON-equal to its pre-enable copy', () => {
  const b = box();
  const { dirs, saved } = twoProfiles(b);
  assert.equal(b.ac(['mods', 'enable', 'canon-guard']).status, 0);
  const d = b.ac(['mods', 'disable', 'canon-guard']);
  assert.equal(d.status, 0, out(d));
  dirs.forEach((dir, i) => assert.deepEqual(jread(join(dir, 'settings.json')), saved[i], dir));
});

// ── Phase 37 C12: Cursor wiring ─────────────────────────────────────────────

function cursorBox() {
  const b = box({ claudeHome: false }); // Cursor only: no Claude home until a test creates one
  const CURSOR_CONFIG_DIR = join(b.T, 'cursor');
  mkdirSync(CURSOR_CONFIG_DIR);
  const hooks = join(CURSOR_CONFIG_DIR, 'hooks.json');
  writeFileSync(hooks, JSON.stringify({ version: 1, hooks: { sessionStart: [
    { command: 'echo mine' },
    { command: 'node /old/place/.astro/code/hooks/astro-update.mjs' },
  ] } }));
  const read = () => (existsSync(hooks) ? jread(hooks) : { hooks: {} });
  const all = () => Object.values(read().hooks || {}).flat().map((h) => h.command);
  return { b, env: { CURSOR_CONFIG_DIR }, read, all };
}

test('Cursor only: install then enable gives one native guard, one astro-update, and echo mine intact; disable removes only the guard', () => {
  const { b, env, read, all } = cursorBox();
  assert.equal(b.ac(['install'], env).status, 0);
  const r = b.ac(['mods', 'enable', 'canon-guard'], env);
  assert.equal(r.status, 0, out(r));
  const h = read().hooks;
  assert.equal(all().filter((c) => c.includes(GUARD)).length, 1);
  assert.equal(h.preToolUse.filter((e) => e.command.includes(GUARD)).length, 1);
  assert.equal(all().filter((c) => c.includes('astro-update.mjs')).length, 1, 'stale-path entry re-pointed, not duplicated');
  assert.ok(all().includes('echo mine'));
  // the native entry blocks, answering in Cursor's own shape
  const cmd = h.preToolUse.find((e) => e.command.includes(GUARD)).command;
  const P = mkdtempSync(join(tmpdir(), 'ac-modsproj-'));
  mkdirSync(join(P, '.astrocode'), { recursive: true });
  const ev = { hook_event_name: 'preToolUse', cwd: P, tool_name: 'Write', tool_input: { file_path: join(P, '.astrocode', 'state.json'), content: 'x' } };
  const f = spawnSync('/bin/sh', ['-c', cmd], { input: JSON.stringify(ev), encoding: 'utf8', env: { HOME: b.T, PATH: b.PATH } });
  assert.equal(JSON.parse(f.stdout).permission, 'deny', f.stdout + f.stderr);
  // disable removes only the guard
  assert.equal(b.ac(['mods', 'disable', 'canon-guard'], env).status, 0);
  assert.equal(all().filter((c) => c.includes(GUARD)).length, 0);
  assert.equal(all().filter((c) => c.includes('astro-update.mjs')).length, 1);
  assert.ok(all().includes('echo mine'));
});

test('Cursor only: when Claude appears, install removes every astro entry (stale path and guard included), leaving echo mine', () => {
  const { b, env, all } = cursorBox();
  b.ac(['install'], env);
  b.ac(['mods', 'enable', 'canon-guard'], env);
  mkdirSync(join(b.T, '.claude'));
  assert.equal(b.ac(['install'], env).status, 0);
  assert.deepEqual(all().filter((c) => /astro-/.test(c)), []);
  assert.ok(all().includes('echo mine'));
});

test('both hosts present: Claude carries the guard and Cursor has no native entry', () => {
  const { b, env, all } = cursorBox();
  mkdirSync(join(b.T, '.claude'));
  assert.equal(b.ac(['install'], env).status, 0);
  assert.equal(b.ac(['mods', 'enable', 'canon-guard'], env).status, 0);
  assert.equal(guardEntries(jread(join(b.T, '.claude', 'settings.json'))).length, 1);
  assert.equal(all().filter((c) => c.includes(GUARD)).length, 0, "no native guard: Cursor imports Claude's");
});

// ── Phase 38: git-guard is a second settings-hook registration ──────────────

const GGUARD = 'astro-git-guard.mjs';
const gitEntries = (settings) => Object.values(settings.hooks || {}).flat()
  .filter((e) => (e.hooks || []).some((h) => String(h.command).includes(GGUARD)));
const cmdOf = (settings, script) => Object.values(settings.hooks || {}).flat()
  .flatMap((e) => e.hooks || []).find((h) => String(h.command).includes(script)).command;
// Feed `command` (a Bash tool call) to a registered guard command, as Claude Code would.
function feedBash(b, hookCmd, bashCommand) {
  const payload = { hook_event_name: 'PreToolUse', cwd: b.T, tool_name: 'Bash', tool_input: { command: bashCommand } };
  return spawnSync('/bin/sh', ['-c', hookCmd], { input: JSON.stringify(payload), encoding: 'utf8', env: { HOME: b.T, PATH: b.PATH } });
}
const decisionOf = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision; } catch { return undefined; } };

test('enable git-guard registers exactly one Bash entry per profile; it asks on git stash -u and stays silent on a scoped stash; guards coexist', () => {
  const b = box();
  const { dirs, saved } = twoProfiles(b);
  for (let i = 0; i < 2; i++) assert.equal(b.ac(['mods', 'enable', 'git-guard']).status, 0);
  for (const d of dirs) {
    const s = jread(join(d, 'settings.json'));
    const g = gitEntries(s);
    assert.equal(g.length, 1, `${d}: one git-guard entry`);
    assert.ok(g[0].matcher.split('|').includes('Bash'));
    assert.ok(s.hooks.PreToolUse.some((e) => e.hooks.some((h) => h.command === 'echo user-hook')), 'user hook kept');
    assert.equal(decisionOf(feedBash(b, cmdOf(s, GGUARD), 'git stash -u')), 'ask');
    assert.equal(feedBash(b, cmdOf(s, GGUARD), 'git stash push -- src/a.js').stdout.trim(), '');
  }
  assert.equal(b.ac(['mods', 'enable', 'canon-guard']).status, 0);
  for (const d of dirs) {
    const s = jread(join(d, 'settings.json'));
    assert.equal(guardEntries(s).length, 1);
    assert.equal(gitEntries(s).length, 1);
    assert.equal(feedBash(b, cmdOf(s, GUARD), 'git stash -u').stdout.trim(), '', 'canon-guard has no say on git');
    assert.equal(feedBash(b, cmdOf(s, GGUARD), 'echo x > .astrocode/state.json').stdout.trim(), '', 'git-guard has no say on writes');
  }
  assert.equal(b.ac(['mods', 'disable', 'git-guard']).status, 0);
  for (const d of dirs) {
    const s = jread(join(d, 'settings.json'));
    assert.equal(gitEntries(s).length, 0);
    assert.equal(guardEntries(s).length, 1, 'canon-guard still registered');
  }
  assert.equal(b.ac(['mods', 'disable', 'canon-guard']).status, 0);
  dirs.forEach((dir, i) => assert.deepEqual(jread(join(dir, 'settings.json')), saved[i], dir));
});

test('status git-guard is available and off before enable, then on, enforced and "asks" per profile; a deleted entry reads missing', () => {
  const b = box();
  const { dirs } = twoProfiles(b);
  const before = b.ac(['mods', 'status', 'git-guard']);
  assert.equal(before.status, 0, out(before));
  assert.doesNotMatch(before.stdout, /not built yet/);
  const f0 = b.status().features.find((f) => f.name === 'git-guard');
  assert.equal(f0.on, false);
  assert.equal(f0.why, 'off');
  b.ac(['mods', 'enable', 'git-guard']);
  const feature = () => b.status().features.find((f) => f.name === 'git-guard');
  assert.equal(feature().on, true);
  assert.deepEqual(feature().enforcement.filter((x) => x.host === 'claude').map((x) => [x.dir, x.state]), dirs.map((d) => [d, 'enforced']));
  assert.match(b.ac(['mods', 'status', 'git-guard']).stdout, /asks/);
  const file = join(dirs[1], 'settings.json');
  const s = jread(file);
  s.hooks.PreToolUse = s.hooks.PreToolUse.filter((e) => gitEntries({ hooks: { x: [e] } }).length === 0);
  writeFileSync(file, JSON.stringify(s));
  assert.deepEqual(feature().enforcement.filter((x) => x.host === 'claude').map((x) => x.state), ['enforced', 'missing']);
  assert.match(b.ac(['mods', 'status', 'git-guard']).stdout, /missing/);
});

test('with Cursor present, git-guard status states the Cursor position and, if enforced, that it denies', () => {
  const b = box();
  twoProfiles(b);
  const CURSOR_CONFIG_DIR = join(b.T, 'cursor');
  mkdirSync(CURSOR_CONFIG_DIR);
  b.ac(['mods', 'enable', 'git-guard'], { CURSOR_CONFIG_DIR });
  const c = b.status({ CURSOR_CONFIG_DIR }).features.find((x) => x.name === 'git-guard').enforcement.filter((x) => x.host === 'cursor');
  assert.equal(c.length, 1);
  assert.match(c[0].state, /^(enforced|via-claude-import|not-enforced)$/);
  const human = b.ac(['mods', 'status', 'git-guard'], { CURSOR_CONFIG_DIR }).stdout;
  assert.match(human, /cursor/i);
  if (c[0].state !== 'not-enforced') assert.match(human, /denies/);
});

test('Cursor only: enable git-guard twice gives one preToolUse Shell entry that denies, echo mine intact; disable removes only it', () => {
  const { b, env, read, all } = cursorBox();
  assert.equal(b.ac(['install'], env).status, 0);
  for (let i = 0; i < 2; i++) assert.equal(b.ac(['mods', 'enable', 'git-guard'], env).status, 0);
  const mine = read().hooks.preToolUse.filter((e) => e.command.includes(GGUARD));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].matcher, 'Shell');
  assert.ok(all().includes('echo mine'));
  const ev = { hook_event_name: 'preToolUse', cwd: b.T, tool_name: 'Shell', tool_input: { command: 'git stash -u', cwd: b.T } };
  const f = spawnSync('/bin/sh', ['-c', mine[0].command], { input: JSON.stringify(ev), encoding: 'utf8', env: { HOME: b.T, PATH: b.PATH } });
  assert.equal(JSON.parse(f.stdout).permission, 'deny', f.stdout + f.stderr);
  assert.match(b.ac(['mods', 'status', 'git-guard'], env).stdout, /denies/);
  assert.equal(b.ac(['mods', 'disable', 'git-guard'], env).status, 0);
  assert.equal(all().filter((c) => c.includes(GGUARD)).length, 0);
  assert.ok(all().includes('echo mine'));
});

test('both hosts present: Claude carries git-guard and Cursor has no native entry', () => {
  const { b, env, all } = cursorBox();
  mkdirSync(join(b.T, '.claude'));
  assert.equal(b.ac(['install'], env).status, 0);
  assert.equal(b.ac(['mods', 'enable', 'git-guard'], env).status, 0);
  assert.equal(gitEntries(jread(join(b.T, '.claude', 'settings.json'))).length, 1);
  assert.equal(all().filter((c) => c.includes(GGUARD)).length, 0, "no native guard: Cursor imports Claude's");
});

// ── phase 39: `ac mods` never creates a Claude home (C10) ────────────────────

const noClaudeHome = (b) => assert.ok(!existsSync(join(b.T, '.claude')) && !existsSync(join(b.T, '.claude.json')), 'ac mods created a Claude home');
const pluginLines = (b) => b.log().split('\n').filter((l) => /\tplugin\b|\bplugin /.test(l));

test('on a bare machine every ac mods command exits 0, runs no claude plugin call and leaves no Claude home behind', () => {
  const b = box({ claudeHome: false });
  for (const args of [['mods', 'status'], ['mods', 'status', '--json'], ['mods', 'status', 'blindfold'], ['mods', 'enable', 'canon-guard'], ['mods', 'disable', 'canon-guard']]) {
    const r = b.ac(args);
    assert.equal(r.status, 0, `${args.join(' ')}: ${out(r)}`);
    assert.deepEqual(pluginLines(b), [], `${args.join(' ')} ran a plugin command`);
    noClaudeHome(b);
  }
  const s = b.status();
  assert.equal(s.claude.found, true);
  assert.equal(s.claude.version, '2.1.292');
});

test('enabling a mod on a bare machine records the switch, says to start Claude Code once, and creates nothing', () => {
  const b = box({ claudeHome: false });
  seedMarketplace(b.T);
  const r = b.ac(['mods', 'enable', 'witness']);
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /start Claude Code once/);
  assert.deepEqual(pluginLines(b), []);
  assert.equal(b.status().features.find((f) => f.name === 'witness').on, true);
  noClaudeHome(b);
});

// ── the same, against a real claude on PATH ─────────────────────────────────

function realClaude() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return { skip: 'no claude on PATH' };
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(r.stdout);
  if (!m) return { skip: 'unreadable claude version' };
  const [a, b, c] = m.slice(1).map(Number);
  if (!(a > 2 || (a === 2 && (b > 1 || (b === 1 && c >= 292))))) return { skip: `claude ${m[0]} < 2.1.292` };
  const which = spawnSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).stdout.trim();
  return { skip: false, dir: dirname(which) };
}
const REAL = realClaude();

function liveHome() {
  const T = mkdtempSync(join(tmpdir(), 'ac-modslive-'));
  const PATH = [dirname(process.execPath), REAL.dir, '/usr/bin', '/bin'].join(':');
  const ac = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: T, env: { HOME: T, PATH }, encoding: 'utf8' });
  return { T, ac };
}

test('real claude: ac mods status and --json leave HOME/.claude and HOME/.claude.json absent', { skip: REAL.skip }, () => {
  const h = liveHome();
  for (const args of [['mods', 'status'], ['mods', 'status', '--json']]) {
    const r = h.ac(args);
    assert.equal(r.status, 0, out(r));
    assert.ok(!existsSync(join(h.T, '.claude')) && !existsSync(join(h.T, '.claude.json')), `${args.join(' ')} created a Claude home`);
  }
});

test('real claude: a Cursor-only ac install is unchanged by an earlier ac mods status', { skip: REAL.skip }, () => {
  const wiring = (withStatus) => {
    const h = liveHome();
    mkdirSync(join(h.T, '.cursor'));
    if (withStatus) assert.equal(h.ac(['mods', 'status']).status, 0);
    const r = h.ac(['install']);
    assert.equal(r.status, 0, out(r));
    const hooks = join(h.T, '.cursor', 'hooks.json');
    return {
      claudeHome: existsSync(join(h.T, '.claude')),
      cursor: existsSync(hooks) ? readFileSync(hooks, 'utf8').split(h.T).join('<HOME>') : null,
    };
  };
  assert.deepEqual(wiring(true), wiring(false));
});

// ── phase 39: enabling a mod before `ac install` ─────────────────────────────

test('enable blindfold and enable witness before ac install: one install-first line, no raw marketplace error, switch recorded', () => {
  const b = box();
  for (const feature of ['blindfold', 'witness']) {
    const r = b.ac(['mods', 'enable', feature]);
    assert.equal(r.status, 0, out(r));
    assert.equal(out(r).split('\n').filter((l) => /run `ac install` first/.test(l)).length, 1, out(r));
    assert.doesNotMatch(out(r), /marketplace add/);
    assert.deepEqual(pluginLines(b), []);
  }
  const on = b.status().features.filter((f) => f.on).map((f) => f.name);
  assert.deepEqual(on, ['blindfold', 'witness']);
});

test('after ac install the same enable installs the plugin and prints no install-first line', () => {
  const b = box();
  assert.equal(b.ac(['mods', 'enable', 'blindfold']).status, 0);
  assert.equal(b.ac(['install']).status, 0);
  const r = b.ac(['mods', 'enable', 'blindfold']);
  assert.equal(r.status, 0, out(r));
  assert.doesNotMatch(out(r), /install` first/);
  assert.equal(b.status().plugin.installed, true);
});
