// Phase 36 — lib/mods.mjs: the switches for the optional astro-mods layer (ADR-071) and the
// `claude plugin` lifecycle behind them. RED first (ADR-018): every symbol arrives through
// `await import('../lib/mods.mjs')` inside the test bodies, so a missing module fails each
// test on its own instead of crashing the whole file at load.
//
// `claude` is replaced by a hand-written fake `run` that keeps a per-config-dir in-memory
// state and answers with the JSON shapes the real CLI printed on 2.1.292 (PLAN F2). No mock
// library: a plain function that records what it was asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NAMES = ['canon-guard', 'git-guard', 'blindfold', 'spawn-policy', 'witness', 'brief-section', 'phase-band', 'live-capture'];
const KINDS = ['hook', 'hook', 'mod', 'mod', 'mod', 'mod', 'mod', 'mod'];
const PLUGIN = 'astro-mods@astro-code';

const mods = () => import('../lib/mods.mjs');
const home = (config) => {
  const h = mkdtempSync(join(tmpdir(), 'ac-mods-'));
  if (config !== undefined) {
    mkdirSync(join(h, '.astro'), { recursive: true });
    writeFileSync(join(h, '.astro', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return h;
};
const cfgFile = (h) => join(h, '.astro', 'config.json');
const ok = (obj) => ({ status: 0, stdout: JSON.stringify(obj), stderr: '' });

// A fake `claude`. State per config dir (CLAUDE_CONFIG_DIR, or 'default' when unset).
function fakeClaude({ version = '2.1.292', missing = false, failInstallIn = [], seed = {} } = {}) {
  const state = {};
  const calls = [];
  const of = (key) => (state[key] ??= { marketplaces: [], plugins: [] });
  for (const [key, m] of Object.entries(seed)) of(key).marketplaces.push(m);
  function run(args, { env = {} } = {}) {
    const key = env.CLAUDE_CONFIG_DIR || 'default';
    calls.push({ args, key, env });
    if (missing) return { status: null, stdout: '', stderr: '', missing: true };
    const s = of(key);
    const line = args.join(' ');
    if (args[0] === '--version') return { status: 0, stdout: `${version} (Claude Code)\n`, stderr: '' };
    if (line === 'plugin marketplace list --json') {
      return ok(s.marketplaces.map((m) => ({ name: m.name, source: 'directory', path: m.path, installLocation: m.path })));
    }
    if (line === 'plugin list --json') return ok(s.plugins.map((id) => ({ id, version: '0.40.2', scope: 'user', enabled: true })));
    if (args[2] === 'add') {
      s.marketplaces = s.marketplaces.filter((m) => m.name !== 'astro-code');
      s.marketplaces.push({ name: 'astro-code', path: args[3] });
      return ok({ command: 'marketplace-add', outcome: 'ok', marketplace: 'astro-code' });
    }
    if (args[1] === 'install') {
      if (failInstallIn.includes(key) || !s.marketplaces.some((m) => m.name === 'astro-code')) {
        return { status: 1, stdout: JSON.stringify({ command: 'install', outcome: 'failed', failureCode: 'not_found' }), stderr: '✘ failed' };
      }
      s.plugins.push(args[2]);
      return ok({ command: 'install', outcome: 'ok', pluginId: args[2], scope: 'user' });
    }
    if (args[1] === 'update') return ok({ command: 'update', outcome: 'ok', updateOutcome: 'up_to_date' });
    if (args[1] === 'uninstall') {
      s.plugins = s.plugins.filter((p) => p !== args[2]);
      return ok({ command: 'uninstall', outcome: 'ok' });
    }
    if (args[2] === 'remove') {
      s.marketplaces = s.marketplaces.filter((m) => m.name !== args[3]);
      return ok({ command: 'marketplace-remove', outcome: 'ok' });
    }
    return { status: 1, stdout: '', stderr: `fake: unhandled ${line}` };
  }
  const plugin = () => calls.filter((c) => c.args[0] === 'plugin');
  return { run, calls, state, of, plugin, verbs: () => plugin().map((c) => c.args.slice(1, c.args[1] === 'marketplace' ? 3 : 2).join(' ')) };
}

// Two Claude config dirs: the base (default) one and a jean-claude style profile.
// Both exist on disk: since phase 39 no `claude plugin` command runs against a missing dir.
function twoDirs(h) {
  mkdirSync(join(h, '.claude'), { recursive: true });
  mkdirSync(join(h, 'p2'), { recursive: true });
  return new Map([[join(h, '.claude'), 'base'], [join(h, 'p2'), 'p2']]);
}

function baseOnly(h) {
  mkdirSync(join(h, '.claude'), { recursive: true });
  return new Map([[join(h, '.claude'), 'base']]);
}

// ── registry ────────────────────────────────────────────────────────────────

test('the registry lists the eight features in order with their kinds, canon-guard, git-guard, blindfold, witness and brief-section built, floor 2.1.292', async () => {
  const { FEATURES, MOD_FLOOR } = await mods();
  assert.equal(MOD_FLOOR, '2.1.292');
  assert.deepEqual(FEATURES.map((f) => f.name), NAMES);
  assert.deepEqual(FEATURES.map((f) => f.kind), KINDS);
  assert.deepEqual(FEATURES.map((f) => f.phase), [37, 38, 39, 40, 41, 42, 43, 44]);
  assert.deepEqual(FEATURES.filter((f) => f.built).map((f) => f.name), ['canon-guard', 'git-guard', 'blindfold', 'witness', 'brief-section']);
  assert.ok(FEATURES.every((f) => f.description.length > 10));
  assert.ok(Object.isFrozen(FEATURES));
});

test('spawn-policy is described as isolation-only and stays unbuilt (ADR-073: no haiku refusal, no pinning)', async () => {
  const { FEATURES } = await mods();
  const f = FEATURES.find((x) => x.name === 'spawn-policy');
  assert.match(f.description, /isolat/);
  assert.doesNotMatch(f.description, /haiku|pin/i);
  assert.equal(f.built, false);
});

// ── versions ────────────────────────────────────────────────────────────────

test('parseClaudeVersion takes the leading X.Y.Z and returns null for garbage', async () => {
  const { parseClaudeVersion } = await mods();
  assert.equal(parseClaudeVersion('2.1.292 (Claude Code)'), '2.1.292');
  assert.equal(parseClaudeVersion('nonsense'), null);
  assert.equal(parseClaudeVersion(''), null);
});

test('compareVersions is numeric per segment, not lexical', async () => {
  const { compareVersions } = await mods();
  assert.ok(compareVersions('2.1.1000', '2.1.9') > 0);
  assert.ok(compareVersions('2.1.287', '2.1.292') < 0);
  assert.equal(compareVersions('2.1.292', '2.1.292'), 0);
});

test('claudeVersion reports a missing binary without throwing', async () => {
  const { claudeVersion } = await mods();
  assert.deepEqual(claudeVersion({ run: () => ({ status: null, stdout: '', stderr: '', missing: true }) }), { found: false, version: null });
  assert.deepEqual(claudeVersion({ run: fakeClaude({ version: '2.1.287' }).run }), { found: true, version: '2.1.287' });
  assert.deepEqual(claudeVersion({ run: () => ({ status: 0, stdout: 'huh', stderr: '' }) }), { found: true, version: null });
});

test('claudeEnvFor drops CLAUDE_CONFIG_DIR for the default dir and sets it for any other', async () => {
  const { claudeEnvFor } = await mods();
  const h = home();
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = '/elsewhere';
  try {
    assert.equal(claudeEnvFor(join(h, '.claude'), { home: h }).CLAUDE_CONFIG_DIR, undefined);
    assert.equal(claudeEnvFor(join(h, 'p2'), { home: h }).CLAUDE_CONFIG_DIR, join(h, 'p2'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

// ── readMods ────────────────────────────────────────────────────────────────

test('readMods: no file means all off, and the read creates nothing', async () => {
  const { readMods } = await mods();
  const h = home();
  const r = readMods({ home: h });
  assert.deepEqual(Object.keys(r.switches), NAMES);
  assert.ok(Object.values(r.switches).every((v) => v === false));
  assert.deepEqual(r.warnings, []);
  assert.equal(existsSync(join(h, '.astro')), false);
});

test('readMods: a file without a mods key is all off', async () => {
  const { readMods } = await mods();
  const r = readMods({ home: home({ agent_tools: {} }) });
  assert.ok(Object.values(r.switches).every((v) => v === false));
});

test('readMods: invalid JSON warns once, is all off, and leaves the bytes alone', async () => {
  const { readMods } = await mods();
  const h = home('{oops');
  const r = readMods({ home: h });
  assert.equal(r.warnings.length, 1);
  assert.ok(Object.values(r.switches).every((v) => v === false));
  assert.equal(readFileSync(cfgFile(h), 'utf8'), '{oops');
});

test('readMods: a non-object mods key warns; a non-boolean value is off; unknown keys are ignored', async () => {
  const { readMods } = await mods();
  const bad = readMods({ home: home({ mods: 'x' }) });
  assert.equal(bad.warnings.length, 1);
  assert.ok(Object.values(bad.switches).every((v) => v === false));
  const r = readMods({ home: home({ mods: { blindfold: 'yes', witness: true, zzz: true } }) });
  assert.equal(r.switches.blindfold, false);
  assert.equal(r.switches.witness, true);
  assert.equal('zzz' in r.switches, false);
});

// ── setMod ──────────────────────────────────────────────────────────────────

test('setMod flips one switch and preserves every sibling key', async () => {
  const { setMod, readMods } = await mods();
  const h = home({ agent_tools: { '*': ['mcp__x__y'] }, other: 1 });
  const on = setMod({ home: h, feature: 'canon-guard', on: true });
  assert.equal(on.ok, true);
  let cfg = JSON.parse(readFileSync(cfgFile(h), 'utf8'));
  assert.deepEqual(cfg.agent_tools, { '*': ['mcp__x__y'] });
  assert.equal(cfg.other, 1);
  assert.equal(cfg.mods['canon-guard'], true);
  setMod({ home: h, feature: 'git-guard', on: true });
  setMod({ home: h, feature: 'canon-guard', on: false });
  cfg = JSON.parse(readFileSync(cfgFile(h), 'utf8'));
  assert.equal(cfg.mods['canon-guard'], false, 'off is stored as false, not deleted');
  assert.equal(cfg.mods['git-guard'], true);
  const sw = readMods({ home: h }).switches;
  assert.deepEqual(NAMES.filter((n) => sw[n]), ['git-guard']);
});

test('setMod refuses an unknown name before reading or writing, and never calls claude', async () => {
  const { setMod, enableMod } = await mods();
  const h = home();
  const r = setMod({ home: h, feature: 'blindfolds', on: true });
  assert.equal(r.ok, false);
  for (const n of NAMES) assert.match(r.error, new RegExp(n));
  assert.equal(existsSync(join(h, '.astro')), false);
  const fake = fakeClaude();
  const e = enableMod({ home: h, run: fake.run, targets: twoDirs(h), feature: 'nope' });
  assert.equal(e.ok, false);
  assert.equal(fake.calls.length, 0);
});

test('setMod refuses an unparseable file and leaves it byte-identical', async () => {
  const { setMod } = await mods();
  const h = home('{oops');
  const r = setMod({ home: h, feature: 'git-guard', on: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /not valid JSON/);
  assert.equal(readFileSync(cfgFile(h), 'utf8'), '{oops');
});

test('setMod keeps unknown mods keys and leaves no temp file behind', async () => {
  const { setMod } = await mods();
  const h = home({ mods: { zzz: true } });
  assert.equal(setMod({ home: h, feature: 'witness', on: true }).ok, true);
  const cfg = JSON.parse(readFileSync(cfgFile(h), 'utf8'));
  assert.equal(cfg.mods.zzz, true);
  assert.equal(cfg.mods.witness, true);
  assert.deepEqual(readdirSync(join(h, '.astro')), ['config.json']);
});

// ── plugin ops ──────────────────────────────────────────────────────────────

test('ensurePlugin adds the marketplace then installs, in every dir, with the right env', async () => {
  const { ensurePlugin, modsMarketplacePath } = await mods();
  const h = home();
  const fake = fakeClaude();
  const res = ensurePlugin({ home: h, run: fake.run, targets: twoDirs(h) });
  assert.deepEqual(res.map((r) => r.outcome), ['installed', 'installed']);
  const base = fake.plugin().filter((c) => c.key === 'default').map((c) => c.args.join(' '));
  assert.ok(base.indexOf(`plugin marketplace add ${modsMarketplacePath({ home: h })} --json`) >= 0);
  assert.ok(base.indexOf(`plugin install ${PLUGIN} --json`) > base.findIndex((l) => l.includes('marketplace add')));
  assert.ok(fake.plugin().filter((c) => c.key === join(h, 'p2')).length > 0, 'the profile dir carries CLAUDE_CONFIG_DIR');
  assert.deepEqual(fake.of('default').plugins, [PLUGIN]);
  assert.deepEqual(fake.of(join(h, 'p2')).plugins, [PLUGIN]);
});

test('ensurePlugin again reports already and does not install twice', async () => {
  const { ensurePlugin } = await mods();
  const h = home();
  const fake = fakeClaude();
  ensurePlugin({ home: h, run: fake.run, targets: twoDirs(h) });
  const before = fake.verbs().filter((v) => v === 'install').length;
  const res = ensurePlugin({ home: h, run: fake.run, targets: twoDirs(h) });
  assert.deepEqual(res.map((r) => r.outcome), ['already', 'already']);
  assert.equal(fake.verbs().filter((v) => v === 'install').length, before);
});

test('a foreign astro-code marketplace is a collision with a fix, untouched, and the other dir still installs', async () => {
  const { ensurePlugin } = await mods();
  const h = home();
  const p2 = join(h, 'p2');
  const fake = fakeClaude({ seed: { [p2]: { name: 'astro-code', path: '/somebody/elses' } } });
  const res = ensurePlugin({ home: h, run: fake.run, targets: twoDirs(h) });
  const byLabel = Object.fromEntries(res.map((r) => [r.label, r]));
  assert.equal(byLabel.base.outcome, 'installed');
  assert.equal(byLabel.p2.outcome, 'collision');
  assert.match(byLabel.p2.fix, /marketplace remove astro-code/);
  assert.match(byLabel.p2.fix, new RegExp(`CLAUDE_CONFIG_DIR=${p2}`));
  assert.equal(fake.plugin().filter((c) => c.key === p2 && ['add', 'install'].includes(c.args[2] === 'add' ? 'add' : c.args[1])).length, 0);
  assert.deepEqual(fake.of(p2).marketplaces, [{ name: 'astro-code', path: '/somebody/elses' }]);
});

test('a failed install rolls back the marketplace this call added', async () => {
  const { ensurePlugin } = await mods();
  const h = home();
  const fake = fakeClaude({ failInstallIn: ['default'] });
  const res = ensurePlugin({ home: h, run: fake.run, targets: twoDirs(h) });
  assert.equal(res.find((r) => r.label === 'base').outcome, 'failed');
  assert.equal(res.find((r) => r.label === 'p2').outcome, 'installed', 'one dir failing never aborts the others');
  assert.deepEqual(fake.of('default').marketplaces, [], 'no half-installed dir');
});

test('updatePlugin updates only where the plugin is installed from our marketplace', async () => {
  const { ensurePlugin, updatePlugin } = await mods();
  const h = home();
  const p2 = join(h, 'p2');
  const fake = fakeClaude({ seed: { [p2]: { name: 'astro-code', path: '/somebody/elses' } } });
  assert.ok(updatePlugin({ home: h, run: fake.run, targets: twoDirs(h) }).every((r) => r.outcome === 'skipped'));
  assert.equal(fake.verbs().includes('update'), false, 'not installed → no update');
  ensurePlugin({ home: h, run: fake.run, targets: baseOnly(h) });
  const res = updatePlugin({ home: h, run: fake.run, targets: twoDirs(h) });
  assert.equal(res.find((r) => r.label === 'base').outcome, 'updated');
  assert.equal(res.find((r) => r.label === 'p2').outcome, 'skipped');
  const upd = fake.plugin().filter((c) => c.args[1] === 'update');
  assert.equal(upd.length, 1);
  assert.equal(upd[0].args.join(' '), `plugin update ${PLUGIN} -y --json`);
});

test('removePlugin uninstalls before it removes the marketplace and leaves a foreign one alone', async () => {
  const { ensurePlugin, removePlugin } = await mods();
  const h = home();
  const p2 = join(h, 'p2');
  const fake = fakeClaude({ seed: { [p2]: { name: 'astro-code', path: '/somebody/elses' } } });
  ensurePlugin({ home: h, run: fake.run, targets: baseOnly(h) });
  removePlugin({ home: h, run: fake.run, targets: twoDirs(h) });
  const seq = fake.plugin().filter((c) => c.key === 'default').map((c) => c.args.slice(1, 3).join(' '));
  assert.ok(seq.indexOf(`uninstall ${PLUGIN}`) >= 0 && seq.indexOf('marketplace remove') > seq.indexOf(`uninstall ${PLUGIN}`));
  assert.deepEqual(fake.of('default').marketplaces, []);
  assert.deepEqual(fake.of('default').plugins, []);
  assert.deepEqual(fake.of(p2).marketplaces, [{ name: 'astro-code', path: '/somebody/elses' }]);
  assert.equal(fake.plugin().some((c) => c.key === p2 && c.args[1] !== 'marketplace' && c.args[1] !== 'list'), false);
  assert.equal(fake.plugin().some((c) => c.key === p2 && c.args[2] === 'remove'), false);
});

// ── status / enable ─────────────────────────────────────────────────────────

test('modsStatus with no claude: found false, no plugin call, every feature off and unable', async () => {
  const { modsStatus, MOD_FLOOR } = await mods();
  const h = home();
  const fake = fakeClaude({ missing: true });
  const s = modsStatus({ home: h, run: fake.run, targets: twoDirs(h) });
  assert.equal(s.floor, MOD_FLOOR);
  assert.equal(s.claude.found, false);
  assert.equal(fake.plugin().length, 0);
  assert.deepEqual(s.features.map((f) => f.name), NAMES);
  assert.deepEqual(s.features.map((f) => f.kind), KINDS);
  assert.ok(s.features.every((f) => f.on === false && f.canTakeEffect === false && typeof f.why === 'string'));
});

test('modsStatus on an old claude makes no plugin call and reports meetsFloor false', async () => {
  const { modsStatus } = await mods();
  const h = home({ mods: { blindfold: true, 'spawn-policy': true } });
  const fake = fakeClaude({ version: '2.1.287' });
  const s = modsStatus({ home: h, run: fake.run, targets: twoDirs(h) });
  assert.equal(s.claude.meetsFloor, false);
  assert.equal(fake.plugin().length, 0);
  const w = s.features.find((f) => f.name === 'spawn-policy');
  assert.equal(w.on, true);
  assert.equal(w.canTakeEffect, false);
  assert.match(w.why, /not built yet/, 'the first failing reason wins; the floor shows in claude.meetsFloor and on enable');
  assert.match(s.features.find((f) => f.name === 'blindfold').why, /2\.1\.287 < 2\.1\.292/, 'a built mod names the floor');
});

test('modsStatus reports the plugin per dir so a partial fan-out is visible', async () => {
  const { modsStatus, ensurePlugin } = await mods();
  const h = home();
  const fake = fakeClaude();
  ensurePlugin({ home: h, run: fake.run, targets: baseOnly(h) });
  const s = modsStatus({ home: h, run: fake.run, targets: twoDirs(h) });
  assert.equal(s.plugin.installed, true);
  assert.deepEqual(s.plugin.dirs.map((d) => [d.label, d.installed, d.marketplace]), [['base', true, 'ours'], ['p2', false, 'absent']]);
});

test('enableMod on a hook feature records the switch and makes no claude call at all', async () => {
  const { enableMod, readMods } = await mods();
  const h = home();
  const fake = fakeClaude();
  const r = enableMod({ home: h, run: fake.run, targets: twoDirs(h), cursorTargets: new Map(), feature: 'canon-guard' });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'hook');
  assert.equal(fake.calls.length, 0);
  assert.equal(readMods({ home: h }).switches['canon-guard'], true);
});

test('enableMod on a mod feature with an old claude records the switch and installs nothing', async () => {
  const { enableMod, readMods } = await mods();
  const h = home();
  const fake = fakeClaude({ version: '2.1.287' });
  const r = enableMod({ home: h, run: fake.run, targets: twoDirs(h), feature: 'blindfold' });
  assert.equal(r.ok, true);
  assert.equal(r.claude, 'old');
  assert.equal(r.version, '2.1.287');
  assert.equal(r.plugin, null);
  assert.equal(fake.plugin().length, 0);
  assert.equal(readMods({ home: h }).switches.blindfold, true);
  const gone = enableMod({ home: h, run: fakeClaude({ missing: true }).run, targets: twoDirs(h), feature: 'witness' });
  assert.equal(gone.claude, 'absent');
});

test('enableMod on a mod feature at the floor installs the plugin through ensurePlugin', async () => {
  const { enableMod } = await mods();
  const h = home();
  mkdirSync(join(h, '.astro', 'code', 'mods'), { recursive: true });
  const fake = fakeClaude();
  const r = enableMod({ home: h, run: fake.run, targets: twoDirs(h), feature: 'blindfold' });
  assert.equal(r.claude, 'ok');
  assert.deepEqual(r.plugin.map((p) => p.outcome), ['installed', 'installed']);
  assert.equal(r.built, true);
  assert.equal(r.phase, 39);
});

test('modsStatus: blindfold on with the plugin installed can take effect; on a missing config dir it names the dir', async () => {
  const { modsStatus, ensurePlugin } = await mods();
  const h = home({ mods: { blindfold: true } });
  mkdirSync(join(h, '.astro', 'code', 'mods'), { recursive: true });
  const fake = fakeClaude();
  ensurePlugin({ home: h, run: fake.run, targets: baseOnly(h) });
  const on = modsStatus({ home: h, run: fake.run, targets: baseOnly(h), cursorTargets: new Map() }).features.find((f) => f.name === 'blindfold');
  assert.equal(on.canTakeEffect, true);
  assert.equal(on.why, '');
  const bare = home({ mods: { blindfold: true } });
  const none = modsStatus({ home: bare, run: fakeClaude().run, targets: new Map([[join(bare, '.claude'), 'base']]), cursorTargets: new Map() }).features.find((f) => f.name === 'blindfold');
  assert.equal(none.canTakeEffect, false);
  assert.equal(none.why, `no Claude Code config dir (${join(bare, '.claude')})`);
});

test('enableMod of a mod before ac install ships the marketplace records the switch, runs no plugin command and says install is needed', async () => {
  const { enableMod, readMods } = await mods();
  const h = home();
  const fake = fakeClaude();
  const r = enableMod({ home: h, run: fake.run, targets: twoDirs(h), feature: 'blindfold' });
  assert.equal(r.ok, true);
  assert.equal(r.claude, 'ok');
  assert.equal(r.install, 'needed');
  assert.equal(r.plugin, null);
  assert.equal(fake.plugin().length, 0);
  assert.equal(readMods({ home: h }).switches.blindfold, true);
  // with the marketplace shipped it installs as before
  mkdirSync(join(h, '.astro', 'code', 'mods'), { recursive: true });
  const again = enableMod({ home: h, run: fake.run, targets: twoDirs(h), feature: 'blindfold' });
  assert.equal(again.install, undefined);
  assert.deepEqual(again.plugin.map((p) => p.outcome), ['installed', 'installed']);
});

test('enableMod before install still reports an old or absent claude as before', async () => {
  const { enableMod } = await mods();
  const h = home();
  assert.equal(enableMod({ home: h, run: fakeClaude({ version: '2.1.287' }).run, targets: twoDirs(h), feature: 'witness' }).claude, 'old');
  assert.equal(enableMod({ home: h, run: fakeClaude({ missing: true }).run, targets: twoDirs(h), feature: 'witness' }).claude, 'absent');
});

// ── canon-guard: the switch is the registration (phase 37, ADR-072) ─────────

const SCRIPT = 'astro-canon-guard.mjs';
const GIT_SCRIPT = 'astro-git-guard.mjs';
const FIVE = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const entriesFor = (script) => (settings) => Object.values(settings.hooks || {}).flat()
  .filter((e) => (e.hooks || []).some((x) => typeof x.command === 'string' && x.command.includes(script)));
const ours = entriesFor(SCRIPT);
const gitOurs = entriesFor(GIT_SCRIPT);
// Claude config dirs under a fresh home; `seed` writes settings.json (an object, or a raw string).
function claudeDirs(h, seeds) {
  const t = new Map();
  Object.entries(seeds).forEach(([name, seed]) => {
    const dir = join(h, name);
    mkdirSync(dir, { recursive: true });
    if (seed !== null) writeFileSync(join(dir, 'settings.json'), typeof seed === 'string' ? seed : JSON.stringify(seed, null, 2) + '\n');
    t.set(dir, name);
  });
  return t;
}
// The installed script, so guardState can tell enforced from broken.
function installScript(h) {
  mkdirSync(join(h, '.astro', 'code', 'hooks'), { recursive: true });
  for (const n of [SCRIPT, GIT_SCRIPT]) writeFileSync(join(h, '.astro', 'code', 'hooks', n), '// stub\n');
}
const USER_HOOK = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] }] } };

async function withProcessEnv(vars, fn) {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('enableMod canon-guard registers one entry per Claude dir without spawning claude; disableMod restores the files', async () => {
  const { enableMod, disableMod } = await mods();
  const h = home();
  const targets = claudeDirs(h, { c1: { theme: 'dark', ...USER_HOOK }, c2: { theme: 'light' } });
  const [d1, d2] = [...targets.keys()];
  const before = [readJson(join(d1, 'settings.json')), readJson(join(d2, 'settings.json'))];
  const fake = fakeClaude();
  const args = { home: h, run: fake.run, targets, cursorTargets: new Map(), feature: 'canon-guard' };

  const r = enableMod(args);
  assert.equal(fake.calls.length, 0, 'a hook never spawns claude');
  assert.deepEqual(r.hooks.map((x) => [x.host, x.outcome]), [['claude', 'added'], ['claude', 'added']]);
  for (const d of [d1, d2]) {
    const entries = ours(readJson(join(d, 'settings.json')));
    assert.equal(entries.length, 1);
    assert.deepEqual(new Set(entries[0].matcher.split('|')), new Set(FIVE));
  }
  assert.ok(readJson(join(d1, 'settings.json')).hooks.PreToolUse.some((e) => e.hooks[0].command === 'echo user-hook'), 'user hook kept');

  const again = enableMod(args);
  assert.deepEqual(again.hooks.map((x) => x.outcome), ['already', 'already']);
  for (const d of [d1, d2]) assert.equal(ours(readJson(join(d, 'settings.json'))).length, 1, 'no duplicate');

  const off = disableMod({ ...args, run: undefined });
  assert.deepEqual(off.hooks.map((x) => x.outcome), ['removed', 'removed']);
  assert.deepEqual(readJson(join(d1, 'settings.json')), before[0]);
  assert.deepEqual(readJson(join(d2, 'settings.json')), before[1]);
});

test('enableMod git-guard registers one Bash entry per Claude dir beside canon-guard; each disable removes only itself', async () => {
  const { enableMod, disableMod } = await mods();
  const h = home();
  const targets = claudeDirs(h, { c1: { theme: 'dark', ...USER_HOOK }, c2: { theme: 'light' } });
  const [d1, d2] = [...targets.keys()];
  const before = [readJson(join(d1, 'settings.json')), readJson(join(d2, 'settings.json'))];
  const fake = fakeClaude();
  const args = { home: h, run: fake.run, targets, cursorTargets: new Map() };

  const r = enableMod({ ...args, feature: 'git-guard' });
  assert.equal(fake.calls.length, 0, 'a hook never spawns claude');
  assert.deepEqual(r.hooks.map((x) => [x.host, x.outcome]), [['claude', 'added'], ['claude', 'added']]);
  for (const d of [d1, d2]) {
    const entries = gitOurs(readJson(join(d, 'settings.json')));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].matcher, 'Bash');
  }
  assert.deepEqual(enableMod({ ...args, feature: 'git-guard' }).hooks.map((x) => x.outcome), ['already', 'already']);

  enableMod({ ...args, feature: 'canon-guard' });
  for (const d of [d1, d2]) {
    assert.equal(gitOurs(readJson(join(d, 'settings.json'))).length, 1);
    assert.equal(ours(readJson(join(d, 'settings.json'))).length, 1);
  }

  disableMod({ ...args, run: undefined, feature: 'git-guard' });
  for (const d of [d1, d2]) {
    assert.equal(gitOurs(readJson(join(d, 'settings.json'))).length, 0);
    assert.equal(ours(readJson(join(d, 'settings.json'))).length, 1, 'canon-guard intact');
  }
  disableMod({ ...args, run: undefined, feature: 'canon-guard' });
  assert.deepEqual(readJson(join(d1, 'settings.json')), before[0]);
  assert.deepEqual(readJson(join(d2, 'settings.json')), before[1]);
});

test('syncHookFeatures makes registration follow the switch: add, restore, remove, absent, failed', async () => {
  const { syncHookFeatures, setMod } = await mods();
  const h = home();
  const targets = claudeDirs(h, { c1: {}, c2: { ...USER_HOOK }, c3: null });
  const [d1, d2, d3] = [...targets.keys()];
  const sync = (extra = {}) => syncHookFeatures({ home: h, targets, cursorTargets: new Map(), only: 'canon-guard', ...extra });

  setMod({ home: h, feature: 'canon-guard', on: true });
  const first = sync();
  assert.deepEqual(first.map((x) => [x.feature, x.host, x.outcome]), [['canon-guard', 'claude', 'added'], ['canon-guard', 'claude', 'added'], ['canon-guard', 'claude', 'added']]);
  assert.ok(existsSync(join(d3, 'settings.json')), 'a dir with no settings.json gets one');
  assert.deepEqual(sync().map((x) => x.outcome), ['already', 'already', 'already']);

  // a hand-deleted entry is restored
  const s1 = readJson(join(d1, 'settings.json'));
  delete s1.hooks;
  writeFileSync(join(d1, 'settings.json'), JSON.stringify(s1));
  assert.deepEqual(sync().map((x) => x.outcome), ['added', 'already', 'already']);
  assert.equal(ours(readJson(join(d1, 'settings.json'))).length, 1);

  // switch off: every planted entry goes
  setMod({ home: h, feature: 'canon-guard', on: false });
  assert.deepEqual(sync().map((x) => x.outcome), ['removed', 'removed', 'removed']);
  for (const d of [d1, d2, d3]) assert.equal(ours(readJson(join(d, 'settings.json'))).length, 0);
  assert.deepEqual(sync().map((x) => x.outcome), ['absent', 'absent', 'absent']);

  // only: a feature that is not a hook yields nothing
  assert.deepEqual(sync({ only: 'blindfold' }), []);

  // only: git-guard follows its own switch
  setMod({ home: h, feature: 'git-guard', on: true });
  assert.deepEqual(sync({ only: 'git-guard' }).map((x) => [x.feature, x.outcome]), [['git-guard', 'added'], ['git-guard', 'added'], ['git-guard', 'added']]);
  setMod({ home: h, feature: 'git-guard', on: false });
  assert.deepEqual(sync({ only: 'git-guard' }).map((x) => x.outcome), ['removed', 'removed', 'removed']);
});

test('syncHookFeatures: a missing dir is absent and not created; an unparseable file fails untouched while the others proceed', async () => {
  const { syncHookFeatures, setMod } = await mods();
  const h = home();
  setMod({ home: h, feature: 'canon-guard', on: true });
  const targets = claudeDirs(h, { bad: '{nope', good: {} });
  const ghost = join(h, 'ghost');
  targets.set(ghost, 'ghost');
  const out = syncHookFeatures({ home: h, targets, cursorTargets: new Map(), only: 'canon-guard' });
  const by = Object.fromEntries(out.map((x) => [x.label, x]));
  assert.equal(by.ghost.outcome, 'absent');
  assert.ok(!existsSync(ghost), 'a Claude dir is never created');
  assert.equal(by.bad.outcome, 'failed');
  assert.ok(by.bad.error);
  assert.equal(readFileSync(join(h, 'bad', 'settings.json'), 'utf8'), '{nope');
  assert.equal(by.good.outcome, 'added');
  assert.equal(ours(readJson(join(h, 'good', 'settings.json'))).length, 1);
});

test('modsStatus reports where canon-guard is enforced, per dir, never from the switch alone', async () => {
  const { modsStatus, enableMod } = await mods();
  const h = home();
  installScript(h);
  const targets = claudeDirs(h, { c1: {}, c2: {} });
  const [d1, d2] = [...targets.keys()];
  const fake = fakeClaude();
  const status = () => modsStatus({ home: h, run: fake.run, targets, cursorTargets: new Map() }).features.find((f) => f.name === 'canon-guard');

  const off = status();
  assert.equal(off.on, false);
  assert.equal(off.why, 'off', 'built and off reads off, not not-built-yet');

  enableMod({ home: h, run: fake.run, targets, cursorTargets: new Map(), feature: 'canon-guard' });
  const on = status();
  assert.deepEqual(on.enforcement.map((r) => [r.host, r.label, r.state]), [['claude', 'c1', 'enforced'], ['claude', 'c2', 'enforced']]);
  assert.equal(on.canTakeEffect, true);
  assert.equal(on.why, '');

  const s1 = readJson(join(d1, 'settings.json'));
  delete s1.hooks;
  writeFileSync(join(d1, 'settings.json'), JSON.stringify(s1));
  const part = status();
  assert.deepEqual(part.enforcement.map((r) => r.state), ['missing', 'enforced']);
  assert.equal(part.canTakeEffect, true, 'enforced somewhere');

  const s2 = readJson(join(d2, 'settings.json'));
  delete s2.hooks;
  writeFileSync(join(d2, 'settings.json'), JSON.stringify(s2));
  const none = status();
  assert.equal(none.on, true);
  assert.equal(none.canTakeEffect, false);
  assert.match(none.why, /run ac install/);
});

test('modsStatus gives Cursor its own enforcement row: native, via the Claude import, or not enforced', async () => {
  const { modsStatus, enableMod } = await mods();
  const cursorMod = (await import('../lib/hosts/cursor.mjs')).default;
  const h = home();
  installScript(h);
  const cursorDir = join(h, 'cursor');
  mkdirSync(cursorDir);
  await withProcessEnv({ HOME: h, CURSOR_CONFIG_DIR: cursorDir, CLAUDE_CONFIG_DIR: undefined }, async () => {
    const cursorTargets = cursorMod.configTargets();
    const claudeT = claudeDirs(h, { claudeA: {} });
    const row = (st) => st.features.find((f) => f.name === 'canon-guard').enforcement.find((r) => r.host === 'cursor');
    const status = (t) => modsStatus({ home: h, run: fakeClaude().run, targets: t, cursorTargets });

    // native: no $HOME/.claude, so Cursor gets its own preToolUse entry
    enableMod({ home: h, run: fakeClaude().run, targets: claudeT, cursorTargets, feature: 'canon-guard' });
    assert.equal(row(status(claudeT)).state, 'enforced');
    assert.match(readFileSync(join(cursorDir, 'hooks.json'), 'utf8'), /astro-canon-guard\.mjs\\?" cursor/);

    // Claude Code appears: Cursor rides its import, enforced only if Claude's base entry is
    mkdirSync(join(h, '.claude'));
    writeFileSync(join(h, '.claude', 'settings.json'), '{}\n');
    const base = baseOnly(h);
    const { syncHookFeatures } = await mods();
    syncHookFeatures({ home: h, targets: base, cursorTargets });
    assert.equal(row(status(base)).state, 'via-claude-import');
    assert.ok(!/astro-canon-guard/.test(readFileSync(join(cursorDir, 'hooks.json'), 'utf8')), 'native copy stripped');

    // base entry deleted: nothing blocks Cursor either
    const s = readJson(join(h, '.claude', 'settings.json'));
    delete s.hooks;
    writeFileSync(join(h, '.claude', 'settings.json'), JSON.stringify(s));
    assert.equal(row(status(base)).state, 'not-enforced');
  });
});

test('modsStatus carries the verdict on git-guard and canon-guard enforcement rows; off and built reads off', async () => {
  const { modsStatus, enableMod } = await mods();
  const cursorMod = (await import('../lib/hosts/cursor.mjs')).default;
  const h = home();
  installScript(h);
  const targets = claudeDirs(h, { c1: {} });
  const feat = (st, n) => st.features.find((f) => f.name === n);
  const status = (extra = {}) => modsStatus({ home: h, run: fakeClaude().run, targets, cursorTargets: new Map(), ...extra });

  const off = feat(status(), 'git-guard');
  assert.equal(off.why, 'off');
  assert.doesNotMatch(off.why, /not built/);

  enableMod({ home: h, run: fakeClaude().run, targets, cursorTargets: new Map(), feature: 'git-guard' });
  enableMod({ home: h, run: fakeClaude().run, targets, cursorTargets: new Map(), feature: 'canon-guard' });
  const st = status();
  assert.deepEqual(feat(st, 'git-guard').enforcement.map((r) => [r.state, r.verdict]), [['enforced', 'ask']]);
  assert.deepEqual(feat(st, 'canon-guard').enforcement.map((r) => [r.state, r.verdict]), [['enforced', 'deny']]);

  const cursorDir = join(h, 'cursor');
  mkdirSync(cursorDir);
  await withProcessEnv({ HOME: h, CURSOR_CONFIG_DIR: cursorDir, CLAUDE_CONFIG_DIR: undefined }, async () => {
    const cursorTargets = cursorMod.configTargets();
    const claudeOnly = claudeDirs(h, { claudeA: {} });
    enableMod({ home: h, run: fakeClaude().run, targets: claudeOnly, cursorTargets, feature: 'git-guard' });
    const row = feat(modsStatus({ home: h, run: fakeClaude().run, targets: claudeOnly, cursorTargets }), 'git-guard').enforcement.find((r) => r.host === 'cursor');
    assert.equal(row.state, 'enforced');
    assert.equal(row.verdict, 'deny');
  });
});

// ── phase 39: no `claude plugin` command against a config dir that does not exist ──────────────
// (a `claude plugin …` call creates ~/.claude and ~/.claude.json, which on a Cursor-only machine
// flips the next `ac install` into Claude-import mode)

test('plugin lifecycle against dirs that do not exist makes zero claude calls and reads noDir / skipped', async () => {
  const { pluginState, ensurePlugin, updatePlugin, removePlugin } = await mods();
  const h = home();
  const targets = new Map([[join(h, '.claude'), 'base'], [join(h, 'p2'), 'p2']]);
  const fake = fakeClaude();
  const args = { home: h, run: fake.run, targets };
  assert.deepEqual(pluginState(args).map((s) => [s.label, s.noDir, s.marketplace, s.installed]), [['base', true, 'absent', false], ['p2', true, 'absent', false]]);
  assert.deepEqual(ensurePlugin(args).map((r) => r.outcome), ['skipped', 'skipped']);
  assert.match(ensurePlugin(args)[0].message, /start Claude Code once, then re-run ac mods enable/);
  assert.deepEqual(updatePlugin(args).map((r) => r.outcome), ['skipped', 'skipped']);
  assert.deepEqual(removePlugin(args).map((r) => r.outcome), ['skipped', 'skipped']);
  assert.equal(fake.calls.length, 0, 'not even a --version: nothing ran');
  assert.equal(existsSync(join(h, '.claude')), false);
});

test('modsStatus reads a missing base dir as noDir with no plugin call', async () => {
  const { modsStatus } = await mods();
  const h = home({ mods: { blindfold: true } });
  const targets = new Map([[join(h, '.claude'), 'base']]);
  const fake = fakeClaude();
  const s = modsStatus({ home: h, run: fake.run, targets, cursorTargets: new Map() });
  assert.equal(fake.plugin().length, 0);
  assert.equal(s.plugin.dirs[0].noDir, true);
  assert.equal(s.plugin.installed, false);
  assert.equal(s.features.find((x) => x.name === 'blindfold').canTakeEffect, false);
});
