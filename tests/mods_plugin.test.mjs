// Phase 36 — the astro-mods plugin skeleton (ADR-071): it enforces NOTHING and fails open.
// RED first (ADR-018): the plugin's modules arrive only through `await import(...)` inside the
// test bodies, so a missing module fails each test on its own.
//
// The engine is a small in-test simulator, because the plugin is plain ESM that only needs
// something to call `register(on)` and then drive its hooks the way Claude Code does:
//   - `on(name, hook)` records the hook and returns `{ catch(h) }`;
//   - an invocation that THROWS, REJECTS or OVERRUNS the budget goes to the recorded `.catch`
//     handler with `next` augmented by `error` and `called` -- the fail-open mechanism the
//     real validator accepts (PROBE.md F3), which is why the plugin has no wrapper of its own;
//   - `$` has just `process.run` and `ui.toast`, both recorders. Anything else the plugin
//     reached for would be undefined and surface as a failed hook (and a toast).
// Event shapes come from PROBE.md: `session.start` is `{ cwd, surface, isInteractive }`.
//
// register() starts a clean slate (every switch off, the once-per-session notice re-armed), so
// each test registers a fresh simulated engine against the same module instance: the plugin's
// sibling modules are cached by Node and a `?query` on register.js would not reach them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'mods', 'astro-mods');
const HOOKS = join(PLUGIN, 'hooks');
const PROBE_MD = join(ROOT, '.astrocode', 'phases', '36-astro-mods-foundation-adr-api-probe', 'PROBE.md');
const NAMES = ['canon-guard', 'git-guard', 'blindfold', 'spawn-policy', 'witness', 'brief-section', 'phase-band', 'live-capture'];
const ARGV = ['ac', 'mods', 'status', '--json', '--switches-only'];
const SESSION_START = { cwd: '/work/proj', surface: null, isInteractive: false };

const plugin = () => import('../mods/astro-mods/hooks/register.js');
const switches = (over = {}) => ({ switches: { ...Object.fromEntries(NAMES.map((n) => [n, false])), ...over }, warnings: [] });
const answer = (obj) => async () => ({ exitCode: 0, stdout: JSON.stringify(obj), stderr: '', isStdoutTruncated: false, isStderrTruncated: false });

async function boot(runImpl, { toastThrows = false } = {}) {
  const { register } = await plugin();
  const hooks = [];
  const on = (name, hook) => {
    const rec = { name, hook, catchHandler: null };
    hooks.push(rec);
    return { catch(h) { rec.catchHandler = h; return this; } };
  };
  const runs = [];
  const toasts = [];
  const $ = {
    process: { run: (argv, init) => { runs.push({ argv, init }); return runImpl(argv, init); } },
    ui: { toast: (text) => { toasts.push(text); if (toastThrows) throw new Error('no UI under -p'); } },
  };
  register(on, {});
  async function invoke(name, e, budgetMs = 10000) {
    const rec = hooks.find((h) => h.name === name);
    const next = Object.assign((x) => x, { called: false });
    let timer;
    try {
      const overrun = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('hook overran its budget')), budgetMs); });
      return await Promise.race([Promise.resolve().then(() => rec.hook($, e, next)), overrun]);
    } catch (error) {
      if (!rec.catchHandler) throw error;
      return await rec.catchHandler($, e, Object.assign((x) => x, { called: false, error }));
    } finally {
      clearTimeout(timer);
    }
  }
  return { hooks, invoke, runs, toasts };
}

// ── switches all off ────────────────────────────────────────────────────────

test('with every switch off, every registered handler passes the event through untouched', async () => {
  const eng = await boot(answer(switches()));
  assert.deepEqual(eng.hooks.map((h) => h.name), ['session.start'], 'this phase registers session.start and nothing else');
  assert.ok(eng.hooks.every((h) => typeof h.catchHandler === 'function'), 'every hook has a fail-open .catch');
  for (const rec of eng.hooks) {
    const e = { ...SESSION_START };
    assert.equal(await eng.invoke(rec.name, e), e, `${rec.name} resolves to next(e)'s value`);
  }
  assert.deepEqual(eng.toasts, []);
});

test('session.start reads the switches through ac, with argv exactly and a timeout under the hook budget', async () => {
  const eng = await boot(answer(switches()));
  await eng.invoke('session.start', { ...SESSION_START });
  assert.equal(eng.runs.length, 1);
  assert.deepEqual(eng.runs[0].argv, ARGV);
  assert.ok(eng.runs[0].init.timeoutMs > 0 && eng.runs[0].init.timeoutMs <= 8000, 'stays under the session.start budget');
});

test('a switch that is on is read, and a feature that is not built yet still passes through', async () => {
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

test('no module reads an event field PROBE.md does not record as observed', () => {
  const probe = readFileSync(PROBE_MD, 'utf8');
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
