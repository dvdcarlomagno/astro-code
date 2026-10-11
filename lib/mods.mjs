// astro-mods: the optional, Claude-only enforcement layer (ADR-071) -- its feature registry,
// its per-user switches, and the `claude plugin` lifecycle that installs it. The plugin itself
// lives in mods/astro-mods/; this module is the ONLY writer of the switches and the only thing
// that talks to `claude plugin`, so `bin/ac.mjs` stays a thin renderer.
//
// Why the switches live in ~/.astro/config.json under `mods` (beside `agent_tools`, ADR-068)
// and not in the plugin's `userConfig`: userConfig is per Claude PROFILE and invisible to the
// settings hooks of phases 37/38, which also run on Cursor. One per-user file is the single
// source for the mod, the hooks and every host. A missing key, a missing file, or a value that
// is not a boolean all mean OFF -- a typo can never turn enforcement on.
//
// A read never writes (`readMods` does not even create ~/.astro). `--switches-only` exists
// for the hot path: the plugin's `session.start` and the settings hooks need the switches
// without paying for a `claude` spawn, so `ac mods status --json --switches-only` reads the
// file and nothing else.
//
// Why the DEFAULT config dir drops CLAUDE_CONFIG_DIR (`claudeEnvFor`): `claude` relocates
// `~/.claude.json` when the variable is set, even to the path it would have used anyway. The
// default profile keeps Claude's own default layout; every other dir gets the variable.
//
// Why `ac` compares the marketplace path itself: `claude plugin marketplace add <path>` under
// an existing name silently RE-POINTS it and exits 0 (observed on 2.1.292). Left to claude, a
// user's own marketplace called `astro-code` would be replaced by ours without a word. So a
// foreign `astro-code` is a `collision` with a fix line and is never touched.
//
// Why a failed install rolls back the marketplace add THIS call made: a dir with the
// marketplace but no plugin is a half-install that later reads as "installed from a stale
// marketplace". Either the whole pair lands in a dir or none of it does. One dir failing never
// aborts the others -- a profile fan-out is best-effort per dir and reports each.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { configTargets } from './hosts/claude.mjs';

/** The one Claude Code floor for the whole plugin: first release with `agentId` on tool.check (2.1.290) and workflow agents on agent.spawn (2.1.292). */
export const MOD_FLOOR = '2.1.292';

const MARKETPLACE = 'astro-code';
const PLUGIN_NAME = 'astro-mods';
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE}`;

/** The eight features. `built` flips to true as phases 37-44 land; until then enabling one records the switch and says so. */
export const FEATURES = Object.freeze([
  { name: 'canon-guard', kind: 'hook', phase: 37, built: false, description: 'refuse hand edits to generated and registry-owned state' },
  { name: 'git-guard', kind: 'hook', phase: 38, built: false, description: 'refuse unscoped destructive git in the shared tree' },
  { name: 'blindfold', kind: 'mod', phase: 39, built: false, description: 'keep the verifier and criteria-author plan-blind' },
  { name: 'spawn-policy', kind: 'mod', phase: 40, built: false, description: 'refuse haiku, pin role models, isolate parallel waves' },
  { name: 'witness', kind: 'mod', phase: 41, built: false, description: "tell a human acceptance from an agent's" },
  { name: 'brief-section', kind: 'mod', phase: 42, built: false, description: 'principles brief as one cached system-prompt section' },
  { name: 'phase-band', kind: 'mod', phase: 43, built: false, description: 'phase band with next-command buttons' },
  { name: 'live-capture', kind: 'mod', phase: 44, built: false, description: 'offer principle capture from human-typed prompts' },
].map((f) => Object.freeze(f)));

const NAMES = FEATURES.map((f) => f.name);
const featureOf = (name) => FEATURES.find((f) => f.name === name);
const configFile = (home) => join(home, '.astro', 'config.json');

// ── claude ──────────────────────────────────────────────────────────────────

/** Run `claude`. Never throws: a missing binary is `missing: true`, so callers branch instead of crash. */
export function runClaude(args, { env } = {}) {
  const r = spawnSync('claude', args, { encoding: 'utf8', timeout: 60000, windowsHide: true, env });
  const missing = !!(r.error && r.error.code === 'ENOENT');
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', missing };
}

/** `process.env` aimed at one Claude config dir (the default dir keeps Claude's own layout, so the variable is removed). */
export function claudeEnvFor(dir, { home = homedir() } = {}) {
  const env = { ...process.env };
  if (resolve(dir) === resolve(join(home, '.claude'))) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = dir;
  return env;
}

/** The leading `X.Y.Z` of `claude --version` output, or null. */
export function parseClaudeVersion(text) {
  const m = /^\s*(\d+\.\d+\.\d+)/.exec(String(text ?? ''));
  return m ? m[1] : null;
}

/** Numeric per segment, so 2.1.1000 > 2.1.9. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** `{ found, version }` -- found:false when no claude is on PATH, version:null when the output is unreadable. */
export function claudeVersion({ run = runClaude } = {}) {
  const r = run(['--version'], { env: process.env });
  if (r.missing) return { found: false, version: null };
  return { found: true, version: parseClaudeVersion(r.stdout) };
}

// ── switches ────────────────────────────────────────────────────────────────

/** `{ switches, warnings, configured }`. Never throws, never writes; a missing file or key is all off. */
export function readMods({ home = homedir() } = {}) {
  const switches = Object.fromEntries(NAMES.map((n) => [n, false]));
  const warnings = [];
  let configured = false;
  const file = configFile(home);
  if (!existsSync(file)) return { switches, warnings, configured };
  let cfg;
  try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch {
    warnings.push('~/.astro/config.json is not valid JSON — every mod is off');
    return { switches, warnings, configured };
  }
  const raw = cfg && typeof cfg === 'object' ? cfg.mods : undefined;
  if (raw === undefined) return { switches, warnings, configured };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('mods in ~/.astro/config.json must be an object of feature → true/false — every mod is off');
    return { switches, warnings, configured };
  }
  configured = true;
  for (const n of NAMES) switches[n] = raw[n] === true;
  return { switches, warnings, configured };
}

/**
 * Flip one switch in `<home>/.astro/config.json` -- the only writer of the `mods` key. Mirrors
 * `updateAgentTools`: the file is shared, so sibling keys and unknown `mods` keys are kept, the
 * write is atomic, and a file that is not valid JSON is REFUSED rather than overwritten. An
 * unknown name is refused before anything is read or written.
 *
 * @returns {{ ok: true, switches: object } | { ok: false, error: string }}
 */
export function setMod({ home = homedir(), feature, on }) {
  if (!featureOf(feature)) return { ok: false, error: `unknown feature "${feature}" — use one of: ${NAMES.join(', ')}` };
  const file = configFile(home);
  let cfg = {};
  if (existsSync(file)) {
    try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch {
      return { ok: false, error: `${file} is not valid JSON — fix it first; nothing was changed` };
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      return { ok: false, error: `${file} is not valid JSON — fix it first; nothing was changed` };
    }
  }
  const current = cfg.mods && typeof cfg.mods === 'object' && !Array.isArray(cfg.mods) ? { ...cfg.mods } : {};
  current[feature] = !!on;
  cfg.mods = current;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  renameSync(tmp, file);
  return { ok: true, switches: readMods({ home }).switches };
}

// ── plugin lifecycle ────────────────────────────────────────────────────────

/** Where `ac install` ships the marketplace. The plugin is installed FROM here, never from the repo checkout. */
export function modsMarketplacePath({ home = homedir() } = {}) {
  return join(home, '.astro', 'code', 'mods');
}

const canon = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
const dirsOf = (targets) => [...targets].map(([dir, label]) => ({ dir, label }));

// Run a `claude plugin … --json` command and parse its stdout. Anything that is not a clean
// exit with JSON is an error STRING, never a throw.
function jsonRun(run, args, env) {
  const r = run(args, { env });
  if (r.missing) return { ok: false, error: 'claude not found' };
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = undefined; }
  if (r.status !== 0) {
    const code = parsed && (parsed.failureCode || parsed.outcome);
    return { ok: false, error: `claude ${args.slice(0, 3).join(' ')} failed${code ? ` (${code})` : ''}: ${firstLine(r.stderr) || firstLine(r.stdout) || `exit ${r.status}`}` };
  }
  if (parsed === undefined) return { ok: false, error: `claude ${args.slice(0, 3).join(' ')} printed no JSON` };
  return { ok: true, value: parsed };
}

function listMarketplaces(run, env) {
  const r = jsonRun(run, ['plugin', 'marketplace', 'list', '--json'], env);
  if (!r.ok) return r;
  return { ok: true, entries: Array.isArray(r.value) ? r.value : [] };
}

function listPlugins(run, env) {
  const r = jsonRun(run, ['plugin', 'list', '--json'], env);
  if (!r.ok) return r;
  return { ok: true, installed: (Array.isArray(r.value) ? r.value : []).some((p) => p && p.id === PLUGIN_ID) };
}

const marketplaceVerdict = (entries, mine) => {
  const found = entries.find((e) => e && e.name === MARKETPLACE);
  if (!found) return { marketplace: 'absent', marketplacePath: null };
  const path = found.path || found.installLocation || null;
  return { marketplace: path && canon(path) === canon(mine) ? 'ours' : 'other', marketplacePath: path };
};

const fixFor = (dir, home) => {
  const prefix = resolve(dir) === resolve(join(home, '.claude')) ? '' : `CLAUDE_CONFIG_DIR=${dir} `;
  return `${prefix}claude plugin marketplace remove ${MARKETPLACE}`;
};

/** One entry per target: `{ dir, label, marketplace: ours|other|absent|unknown, marketplacePath, installed, enabled, error? }`. */
export function pluginState({ home = homedir(), run = runClaude, targets = configTargets() } = {}) {
  const mine = modsMarketplacePath({ home });
  return dirsOf(targets).map(({ dir, label }) => {
    const env = claudeEnvFor(dir, { home });
    const base = { dir, label, marketplace: 'unknown', marketplacePath: null, installed: false, enabled: false };
    const ml = listMarketplaces(run, env);
    if (!ml.ok) return { ...base, error: ml.error };
    const verdict = marketplaceVerdict(ml.entries, mine);
    const pl = jsonRun(run, ['plugin', 'list', '--json'], env);
    if (!pl.ok) return { ...base, ...verdict, error: pl.error };
    const mineEntry = (Array.isArray(pl.value) ? pl.value : []).find((p) => p && p.id === PLUGIN_ID);
    return { ...base, ...verdict, installed: !!mineEntry, enabled: !!(mineEntry && mineEntry.enabled !== false) };
  });
}

/**
 * Install astro-mods into every config dir, marketplace first. A foreign `astro-code`
 * marketplace is a `collision` (touched not at all); a failed install undoes the marketplace
 * add this call made. Returns `[{ dir, label, outcome: installed|already|collision|failed, message, fix? }]`.
 */
export function ensurePlugin({ home = homedir(), run = runClaude, targets = configTargets() } = {}) {
  const mine = modsMarketplacePath({ home });
  return dirsOf(targets).map(({ dir, label }) => {
    const env = claudeEnvFor(dir, { home });
    const done = (outcome, message, extra = {}) => ({ dir, label, outcome, message, ...extra });
    try {
      const ml = listMarketplaces(run, env);
      if (!ml.ok) return done('failed', ml.error);
      const verdict = marketplaceVerdict(ml.entries, mine);
      if (verdict.marketplace === 'other') {
        return done('collision', `a different "${MARKETPLACE}" marketplace is already registered here (${verdict.marketplacePath || 'unknown path'}) — left untouched`, { fix: fixFor(dir, home) });
      }
      let added = false;
      const rollback = () => { if (added) run(['plugin', 'marketplace', 'remove', MARKETPLACE, '--json'], { env }); };
      if (verdict.marketplace === 'absent') {
        const add = jsonRun(run, ['plugin', 'marketplace', 'add', mine, '--json'], env);
        if (!add.ok) return done('failed', add.error);
        added = true;
      }
      const pl = listPlugins(run, env);
      if (!pl.ok) { rollback(); return done('failed', pl.error); }
      if (pl.installed) return done('already', `${PLUGIN_ID} is already installed`);
      const inst = jsonRun(run, ['plugin', 'install', PLUGIN_ID, '--json'], env);
      if (!inst.ok) { rollback(); return done('failed', inst.error); }
      return done('installed', `${PLUGIN_ID} installed`);
    } catch (e) {
      return done('failed', String(e && e.message || e));
    }
  });
}

/** `claude plugin update` where the plugin is installed from OUR marketplace. `[{ dir, label, outcome: updated|skipped|failed, message }]`. */
export function updatePlugin({ home = homedir(), run = runClaude, targets = configTargets() } = {}) {
  return pluginState({ home, run, targets }).map((s) => {
    const done = (outcome, message) => ({ dir: s.dir, label: s.label, outcome, message });
    if (s.error) return done('failed', s.error);
    if (!s.installed || s.marketplace !== 'ours') return done('skipped', 'astro-mods is not installed from the astro-code marketplace here');
    const r = jsonRun(run, ['plugin', 'update', PLUGIN_ID, '-y', '--json'], claudeEnvFor(s.dir, { home }));
    return r.ok ? done('updated', `${PLUGIN_ID} refreshed`) : done('failed', r.error);
  });
}

/**
 * Uninstall the plugin, THEN drop the marketplace, only where the marketplace is ours -- a
 * foreign `astro-code` is never touched. `[{ dir, label, outcome: removed|skipped|failed, removed: [..], message }]`.
 */
export function removePlugin({ home = homedir(), run = runClaude, targets = configTargets() } = {}) {
  return pluginState({ home, run, targets }).map((s) => {
    const env = claudeEnvFor(s.dir, { home });
    const done = (outcome, message, removed = []) => ({ dir: s.dir, label: s.label, outcome, message, removed });
    if (s.error) return done('failed', s.error);
    if (s.marketplace !== 'ours') return done('skipped', 'no astro-code marketplace of ours here');
    const removed = [];
    const problems = [];
    if (s.installed) {
      const u = jsonRun(run, ['plugin', 'uninstall', PLUGIN_ID, '-y', '--json'], env);
      if (u.ok) removed.push('plugin'); else problems.push(u.error);
    }
    const m = jsonRun(run, ['plugin', 'marketplace', 'remove', MARKETPLACE, '--json'], env);
    if (m.ok) removed.push('marketplace'); else problems.push(m.error);
    return problems.length ? done('failed', problems.join('; '), removed) : done('removed', `removed ${removed.join(' and ')}`, removed);
  });
}

// ── status / enable ─────────────────────────────────────────────────────────

/**
 * Everything `ac mods status` shows. It never runs a `plugin` command when Claude is missing
 * or below the floor -- there is nothing a plugin listing could change about the answer.
 */
export function modsStatus({ home = homedir(), run = runClaude, targets = configTargets() } = {}) {
  const { switches, warnings } = readMods({ home });
  const cv = claudeVersion({ run });
  const meetsFloor = !!(cv.found && cv.version && compareVersions(cv.version, MOD_FLOOR) >= 0);
  const dirs = meetsFloor ? pluginState({ home, run, targets }) : [];
  const installed = dirs.some((d) => d.installed);
  const base = dirs.find((d) => d.label === 'base') || dirs[0];
  const baseReady = !!(base && base.installed && base.marketplace === 'ours');
  const features = FEATURES.map((f) => {
    const on = switches[f.name];
    let why = '';
    if (!on) why = 'off';
    else if (!f.built) why = `not built yet (phase ${f.phase})`;
    else if (f.kind === 'mod') {
      if (!cv.found) why = 'no Claude Code found';
      else if (!meetsFloor) why = cv.version ? `Claude Code ${cv.version} < ${MOD_FLOOR}` : `Claude Code version unreadable (needs ≥ ${MOD_FLOOR})`;
      else if (!baseReady) why = 'astro-mods plugin not installed';
    }
    return { name: f.name, kind: f.kind, phase: f.phase, built: f.built, description: f.description, on, canTakeEffect: why === '', why };
  });
  return {
    floor: MOD_FLOOR,
    claude: { found: cv.found, version: cv.version, meetsFloor },
    plugin: { installed, total: [...targets].length, dirs },
    features,
    warnings,
  };
}

/**
 * Turn a feature on. The switch is recorded FIRST and unconditionally (a refused name or an
 * unparseable file stops everything else); a `hook` never touches `claude`; a `mod` installs
 * the plugin only on a Claude at or above the floor -- below it, or absent, the switch stays
 * recorded and no `plugin` command runs.
 */
export function enableMod({ home = homedir(), run = runClaude, targets = configTargets(), feature } = {}) {
  const set = setMod({ home, feature, on: true });
  if (!set.ok) return set;
  const f = featureOf(feature);
  const result = { ok: true, feature, kind: f.kind, phase: f.phase, built: f.built, claude: null, version: null, plugin: null };
  if (f.kind === 'hook') return result;
  const cv = claudeVersion({ run });
  result.version = cv.version;
  if (!cv.found) return { ...result, claude: 'absent' };
  if (!cv.version) return { ...result, claude: 'unknown' };
  if (compareVersions(cv.version, MOD_FLOOR) < 0) return { ...result, claude: 'old' };
  return { ...result, claude: 'ok', plugin: ensurePlugin({ home, run, targets }) };
}

/** Turn a feature off. Never spawns claude; the plugin stays installed and inert. */
export function disableMod({ home = homedir(), feature } = {}) {
  const set = setMod({ home, feature, on: false });
  if (!set.ok) return set;
  const f = featureOf(feature);
  return { ok: true, feature, kind: f.kind };
}
