// Guard registration on the host adapters (phase 37 t4, PLAN.md P6).
//
// RED: `lib/hosts/guards.mjs` and the `registerGuard`/`unregisterGuard`/`guardState`
// symbols on `claude.mjs`/`cursor.mjs` do not exist yet (t3, t5, t6 land them), so every
// new symbol is reached via `await import(...)` inside async test bodies (ADR-018).
// Every test runs under a temp HOME with the config-dir env vars unset, so nothing
// ever touches the real ~/.claude or ~/.cursor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withEnv(home, fn) {
  const keys = ['HOME', 'CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CURSOR_CONFIG_DIR;
  return Promise.resolve(fn()).finally(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

const FIVE = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];
const SCRIPT = 'astro-canon-guard.mjs';
const GIT_SCRIPT = 'astro-git-guard.mjs';

// A fake install home that really holds the guard script (guardState checks it exists).
function installHome(fakeHome, { withScript = true } = {}) {
  const home = join(fakeHome, '.astro', 'code');
  mkdirSync(join(home, 'hooks'), { recursive: true });
  if (withScript) for (const n of [SCRIPT, GIT_SCRIPT]) writeFileSync(join(home, 'hooks', n), '// stub\n');
  return home;
}

const guardEntries = (settings) =>
  Object.values(settings.hooks || {}).flat().filter((e) =>
    (e.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(SCRIPT)));

const entriesOf = (settings, script) =>
  Object.values(settings.hooks || {}).flat().filter((e) =>
    (e.hooks || [e]).some((h) => typeof h.command === 'string' && h.command.includes(script)));

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

// --- Claude: settings.json PreToolUse entry --------------------------------------

test('claude.registerGuard adds one five-tool entry beside a user hook, is idempotent, re-points a stale path, and unregisters to a JSON-equal file', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-guard-claude-'));
  await withEnv(fakeHome, async () => {
    const claude = (await import('../lib/hosts/claude.mjs')).default;
    const { GUARD_HOOKS } = await import('../lib/hosts/guards.mjs');
    const spec = GUARD_HOOKS['canon-guard'];
    const home = installHome(fakeHome);
    const dir = join(fakeHome, '.claude');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'settings.json');
    const before = {
      theme: 'dark',
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] }] },
    };
    writeFileSync(file, JSON.stringify(before, null, 2) + '\n');

    const r = claude.registerGuard(dir, home, spec);
    assert.equal(r.ok, true);
    const after = read(file);
    assert.equal(after.theme, 'dark', 'unrelated key kept');
    assert.ok(after.hooks.PreToolUse.some((e) => e.hooks.some((h) => h.command === 'echo user-hook')), 'user hook kept');
    const ours = guardEntries(after);
    assert.equal(ours.length, 1, 'exactly one guard entry');
    assert.deepEqual(new Set(ours[0].matcher.split('|')), new Set(FIVE));
    assert.equal(typeof ours[0].hooks[0].timeout, 'number');
    assert.equal(ours[0].hooks[0].type, 'command');

    // second call writes nothing: bytes and mtime unchanged
    const bytes = readFileSync(file, 'utf8');
    const old = new Date(Date.now() - 60_000);
    utimesSync(file, old, old);
    const mtime = statSync(file).mtimeMs;
    const again = claude.registerGuard(dir, home, spec);
    assert.equal(again.ok, true);
    assert.equal(again.changed, false);
    assert.equal(readFileSync(file, 'utf8'), bytes);
    assert.equal(statSync(file).mtimeMs, mtime, 'no write on the idempotent path');

    // a stale-path guard entry is re-pointed, not duplicated
    const stale = read(file);
    for (const e of guardEntries(stale)) {
      for (const h of e.hooks) h.command = h.command.replace(home, '/old/place/.astro/code');
    }
    writeFileSync(file, JSON.stringify(stale, null, 2) + '\n');
    claude.registerGuard(dir, home, spec);
    const fixed = guardEntries(read(file));
    assert.equal(fixed.length, 1, 'stale entry replaced, not duplicated');
    assert.ok(fixed[0].hooks[0].command.includes(home));
    assert.ok(!fixed[0].hooks[0].command.includes('/old/place'));

    claude.unregisterGuard(dir, home, spec);
    assert.deepEqual(read(file), before, 'unregister restores a JSON-equal file');
  });
});

test('claude.registerGuard skips a missing dir without creating it, and leaves unparseable settings untouched', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-guard-claude-edge-'));
  await withEnv(fakeHome, async () => {
    const claude = (await import('../lib/hosts/claude.mjs')).default;
    const { GUARD_HOOKS } = await import('../lib/hosts/guards.mjs');
    const spec = GUARD_HOOKS['canon-guard'];
    const home = installHome(fakeHome);

    const missing = join(fakeHome, 'no-such-claude');
    const r = claude.registerGuard(missing, home, spec);
    assert.equal(r.ok, false);
    assert.equal(r.skipped, true);
    assert.ok(!existsSync(missing), 'a Claude config dir is never created');
    assert.doesNotThrow(() => claude.unregisterGuard(missing, home, spec));
    assert.ok(!existsSync(missing));

    const dir = join(fakeHome, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), '{nope');
    const bad = claude.registerGuard(dir, home, spec);
    assert.equal(bad.ok, false);
    assert.ok(bad.error, 'reports why');
    assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), '{nope', 'left byte-for-byte untouched');
  });
});

test('claude.guardState reports enforced, missing and broken (script absent)', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-guard-claude-state-'));
  await withEnv(fakeHome, async () => {
    const claude = (await import('../lib/hosts/claude.mjs')).default;
    const { GUARD_HOOKS } = await import('../lib/hosts/guards.mjs');
    const spec = GUARD_HOOKS['canon-guard'];
    const home = installHome(fakeHome);
    const dir = join(fakeHome, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), '{}\n');

    assert.equal(claude.guardState(dir, home, spec), 'missing');
    claude.registerGuard(dir, home, spec);
    assert.equal(claude.guardState(dir, home, spec), 'enforced');

    const noScript = installHome(mkdtempSync(join(tmpdir(), 'ac-guard-noscript-')), { withScript: false });
    assert.equal(claude.guardState(dir, noScript, spec), 'broken', 'entry present but script absent');
  });
});

test('claude.unregisterHooks (uninstall) also strips the guard entry', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-guard-claude-uninstall-'));
  await withEnv(fakeHome, async () => {
    const claude = (await import('../lib/hosts/claude.mjs')).default;
    const { GUARD_HOOKS } = await import('../lib/hosts/guards.mjs');
    const spec = GUARD_HOOKS['canon-guard'];
    const home = installHome(fakeHome);
    const dir = join(fakeHome, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), '{}\n');
    claude.registerHooks(dir, home);
    claude.registerGuard(dir, home, spec);
    assert.equal(guardEntries(read(join(dir, 'settings.json'))).length, 1);

    claude.unregisterHooks(dir, home);
    assert.equal(guardEntries(read(join(dir, 'settings.json'))).length, 0, 'no entry left pointing into a deleted home');
  });
});

// --- Cursor native (Claude absent) ----------------------------------------------

test('cursor.registerGuard writes a native preToolUse entry, keeps user hooks, is byte-idempotent, unregisters only itself, and flips to import when Claude appears', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-guard-cursor-'));
  await withEnv(fakeHome, async () => {
    const cursor = (await import('../lib/hosts/cursor.mjs')).default;
    const { GUARD_HOOKS } = await import('../lib/hosts/guards.mjs');
    const spec = GUARD_HOOKS['canon-guard'];
    const home = installHome(fakeHome);
    const dir = join(fakeHome, '.cursor');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'hooks.json');
    const user = { version: 1, hooks: { preToolUse: [{ command: 'echo user-pre' }], stop: [{ command: 'echo user-stop' }] } };
    writeFileSync(file, JSON.stringify(user, null, 2) + '\n');

    const r = cursor.registerGuard(dir, home, spec);
    assert.equal(r.branch, 'native');
    const written = read(file);
    assert.equal(written.version, 1);
    assert.ok(written.hooks.preToolUse.some((e) => e.command === 'echo user-pre'), 'user hook kept');
    const ours = written.hooks.preToolUse.filter((e) => typeof e.command === 'string' && e.command.includes(SCRIPT));
    assert.equal(ours.length, 1);
    assert.match(ours[0].command, /astro-canon-guard\.mjs" cursor$/);
    assert.equal(ours[0].matcher, 'Write|Delete|Shell');
    assert.equal(typeof ours[0].timeout, 'number');
    assert.equal(cursor.guardState(dir, home, spec), 'native');

    const bytes = readFileSync(file, 'utf8');
    cursor.registerGuard(dir, home, spec);
    assert.equal(readFileSync(file, 'utf8'), bytes, 'idempotent and byte-identical');

    cursor.unregisterGuard(dir, home, spec);
    assert.deepEqual(read(file), user, 'only the guard is removed');
    assert.equal(cursor.guardState(dir, home, spec), 'missing');

    // flip: Claude Code appears, the native guard is stripped (Cursor imports Claude's)
    cursor.registerGuard(dir, home, spec);
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    const flipped = cursor.registerGuard(dir, home, spec);
    assert.equal(flipped.branch, 'import');
    assert.deepEqual(read(file), user, 'native guard stripped on import');
  });
});

// --- Two guards side by side ------------------------------------------------------

test('claude: canon-guard and git-guard coexist in one settings.json and each removes only itself', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-guard-both-'));
  await withEnv(fakeHome, async () => {
    const claude = (await import('../lib/hosts/claude.mjs')).default;
    const { GUARD_HOOKS } = await import('../lib/hosts/guards.mjs');
    const canon = GUARD_HOOKS['canon-guard'];
    const gitg = GUARD_HOOKS['git-guard'];
    const home = installHome(fakeHome);
    const dir = join(fakeHome, '.claude');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'settings.json');
    const before = { theme: 'dark', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] }] } };
    writeFileSync(file, JSON.stringify(before, null, 2) + '\n');

    claude.registerGuard(dir, home, canon);
    claude.registerGuard(dir, home, gitg);
    const both = read(file);
    assert.equal(entriesOf(both, SCRIPT).length, 1);
    assert.equal(entriesOf(both, GIT_SCRIPT).length, 1);
    assert.equal(entriesOf(both, GIT_SCRIPT)[0].matcher, 'Bash');
    assert.equal(claude.guardState(dir, home, canon), 'enforced');
    assert.equal(claude.guardState(dir, home, gitg), 'enforced');

    const withCanonOnly = (() => { claude.unregisterGuard(dir, home, gitg); return readFileSync(file, 'utf8'); })();
    assert.equal(entriesOf(read(file), SCRIPT).length, 1, 'canon-guard intact');
    assert.equal(entriesOf(read(file), GIT_SCRIPT).length, 0);
    assert.ok(read(file).hooks.PreToolUse.some((e) => e.hooks.some((h) => h.command === 'echo user-hook')));
    assert.equal(claude.guardState(dir, home, gitg), 'missing', 'missing when only canon-guard is registered');

    claude.registerGuard(dir, home, gitg);
    claude.unregisterGuard(dir, home, canon);
    assert.equal(entriesOf(read(file), GIT_SCRIPT).length, 1, 'git-guard intact');
    claude.unregisterGuard(dir, home, gitg);
    assert.deepEqual(read(file), before, 'both gone: JSON-equal to the original');
    assert.ok(withCanonOnly.length > 0);
  });
});

test('cursor native: both guards register and each unregisters only itself', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-guard-both-cursor-'));
  await withEnv(fakeHome, async () => {
    const cursor = (await import('../lib/hosts/cursor.mjs')).default;
    const { GUARD_HOOKS } = await import('../lib/hosts/guards.mjs');
    const canon = GUARD_HOOKS['canon-guard'];
    const gitg = GUARD_HOOKS['git-guard'];
    const home = installHome(fakeHome);
    const dir = join(fakeHome, '.cursor');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'hooks.json');
    const user = { version: 1, hooks: { preToolUse: [{ command: 'echo user-pre' }] } };
    writeFileSync(file, JSON.stringify(user, null, 2) + '\n');

    cursor.registerGuard(dir, home, canon);
    assert.equal(cursor.registerGuard(dir, home, gitg).branch, 'native');
    const pre = read(file).hooks.preToolUse;
    assert.equal(pre.filter((e) => e.command.includes(GIT_SCRIPT)).length, 1);
    assert.equal(pre.find((e) => e.command.includes(GIT_SCRIPT)).matcher, 'Shell');
    assert.equal(pre.filter((e) => e.command.includes(SCRIPT)).length, 1);

    cursor.unregisterGuard(dir, home, gitg);
    const after = read(file).hooks.preToolUse;
    assert.equal(after.filter((e) => e.command.includes(GIT_SCRIPT)).length, 0);
    assert.equal(after.filter((e) => e.command.includes(SCRIPT)).length, 1, 'canon-guard intact');
    cursor.unregisterGuard(dir, home, canon);
    assert.deepEqual(read(file), user);
  });
});

// --- Debt: Cursor ownership by script filename -----------------------------------

test('cursor registerHooks owns astro entries by script filename: a stale-path entry is re-pointed, then removed on the import flip', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-guard-own-'));
  await withEnv(fakeHome, async () => {
    const cursor = (await import('../lib/hosts/cursor.mjs')).default;
    const home = installHome(fakeHome);
    const dir = join(fakeHome, '.cursor');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'hooks.json');
    writeFileSync(file, JSON.stringify({
      version: 1,
      hooks: { sessionStart: [
        { command: 'node /old/place/.astro/code/hooks/astro-update.mjs' },
        { command: 'echo mine' },
      ] },
    }));

    const r = cursor.registerHooks(dir, home);
    assert.equal(r.branch, 'native');
    const start = read(file).hooks.sessionStart;
    const updates = start.filter((e) => e.command.includes('astro-update.mjs'));
    assert.equal(updates.length, 1, 'exactly one astro-update entry');
    assert.ok(updates[0].command.includes(join(home, 'hooks', 'astro-update.mjs')), 'points at the current home');
    assert.ok(!updates[0].command.includes('/old/place'));
    assert.ok(start.some((e) => e.command === 'echo mine'));

    // plant another stale-path entry, then flip to import: every astro entry goes
    const planted = read(file);
    planted.hooks.sessionStart.push({ command: 'node /elsewhere/hooks/astro-update.mjs' });
    writeFileSync(file, JSON.stringify(planted));
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    const flipped = cursor.registerHooks(dir, home);
    assert.equal(flipped.branch, 'import');
    const finalStart = read(file).hooks.sessionStart;
    assert.deepEqual(finalStart, [{ command: 'echo mine' }], 'stale-path astro entries removed, user entry stays');
  });
});
