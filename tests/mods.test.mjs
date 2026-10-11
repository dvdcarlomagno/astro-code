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
function twoDirs(h) {
  return new Map([[join(h, '.claude'), 'base'], [join(h, 'p2'), 'p2']]);
}

// ── registry ────────────────────────────────────────────────────────────────

test('the registry lists the eight features in order with their kinds, none built yet, floor 2.1.292', async () => {
  const { FEATURES, MOD_FLOOR } = await mods();
  assert.equal(MOD_FLOOR, '2.1.292');
  assert.deepEqual(FEATURES.map((f) => f.name), NAMES);
  assert.deepEqual(FEATURES.map((f) => f.kind), KINDS);
  assert.deepEqual(FEATURES.map((f) => f.phase), [37, 38, 39, 40, 41, 42, 43, 44]);
  assert.ok(FEATURES.every((f) => f.built === false && f.description.length > 10));
  assert.ok(Object.isFrozen(FEATURES));
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
  ensurePlugin({ home: h, run: fake.run, targets: new Map([[join(h, '.claude'), 'base']]) });
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
  ensurePlugin({ home: h, run: fake.run, targets: new Map([[join(h, '.claude'), 'base']]) });
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
  const h = home({ mods: { blindfold: true } });
  const fake = fakeClaude({ version: '2.1.287' });
  const s = modsStatus({ home: h, run: fake.run, targets: twoDirs(h) });
  assert.equal(s.claude.meetsFloor, false);
  assert.equal(fake.plugin().length, 0);
  const b = s.features.find((f) => f.name === 'blindfold');
  assert.equal(b.on, true);
  assert.equal(b.canTakeEffect, false);
  assert.match(b.why, /2\.1\.292/);
});

test('modsStatus reports the plugin per dir so a partial fan-out is visible', async () => {
  const { modsStatus, ensurePlugin } = await mods();
  const h = home();
  const fake = fakeClaude();
  ensurePlugin({ home: h, run: fake.run, targets: new Map([[join(h, '.claude'), 'base']]) });
  const s = modsStatus({ home: h, run: fake.run, targets: twoDirs(h) });
  assert.equal(s.plugin.installed, true);
  assert.deepEqual(s.plugin.dirs.map((d) => [d.label, d.installed, d.marketplace]), [['base', true, 'ours'], ['p2', false, 'absent']]);
});

test('enableMod on a hook feature records the switch and makes no claude call at all', async () => {
  const { enableMod, readMods } = await mods();
  const h = home();
  const fake = fakeClaude();
  const r = enableMod({ home: h, run: fake.run, targets: twoDirs(h), feature: 'canon-guard' });
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
  const fake = fakeClaude();
  const r = enableMod({ home: h, run: fake.run, targets: twoDirs(h), feature: 'blindfold' });
  assert.equal(r.claude, 'ok');
  assert.deepEqual(r.plugin.map((p) => p.outcome), ['installed', 'installed']);
  assert.equal(r.built, false);
  assert.equal(r.phase, 39);
});
