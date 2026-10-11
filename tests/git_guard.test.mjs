// Phase 38 t1 — behaviour spec for hooks/astro-git-guard.mjs (CRITERIA C3-C9, the Cursor shape,
// and the single-source ties). RED until t2 lands the script (ADR-018): every reach into the
// hook is a subprocess spawn or an `await import(…)` inside an async test body, so a missing
// script fails only these tests, never the module load.
//
// Everything runs against a temp HOME and a real temp git repo; PATH is pinned. Nothing touches
// a developer's real ~/.claude, ~/.astro or repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(FRAMEWORK, 'hooks', 'astro-git-guard.mjs');
const PINNED_PATH = '/usr/bin:/bin';

// ---------------------------------------------------------------- harness

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: PINNED_PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function sandbox() {
  const S = realpathSync(mkdtempSync(join(tmpdir(), 'ac-git-guard-')));
  const HOME = join(S, 'home');
  mkdirSync(join(HOME, '.astro'), { recursive: true });
  const R = join(S, 'r');
  mkdirSync(join(R, 'src'), { recursive: true });
  git(R, 'init', '-q', '-b', 'main');
  writeFileSync(join(R, 'src', 'a.js'), 'export {};\n');
  git(R, 'add', '-A');
  git(R, 'commit', '-q', '-m', 'init');
  writeFileSync(join(R, 'notes.txt'), 'keep me\n');
  const WT = join(R, '.claude', 'worktrees', 'agent-1');
  git(R, 'worktree', 'add', '-q', WT, '-b', 'wt1');
  return { S, HOME, R, WT };
}

const ENV = (HOME, extra = {}) => ({ PATH: PINNED_PATH, HOME, ...extra });

function feed(event, { env, args = [], rawInput } = {}) {
  return spawnSync(process.execPath, [HOOK, ...args], {
    input: rawInput !== undefined ? rawInput : JSON.stringify(event),
    env, encoding: 'utf8', timeout: 20000,
  });
}

function decision(r) {
  if (r.stdout && r.stdout.trim()) {
    try { return JSON.parse(r.stdout); } catch { return { unparseable: r.stdout }; }
  }
  return null;
}
const verdictOf = (r) => decision(r)?.hookSpecificOutput?.permissionDecision;
const isRefused = (r) => r.status === 0 && ['ask', 'deny'].includes(verdictOf(r));
const isAllowed = (r) => r.status === 0 && !r.stdout.trim() && !/permissionDecision|"allow"/.test(r.stdout);
const reasonOf = (r) => decision(r)?.hookSpecificOutput?.permissionDecisionReason ?? '';
const noStack = (r) => !/ {4}at /.test(r.stdout) && !/ {4}at /.test(r.stderr) && !/^\w*Error:/m.test(r.stderr);

const bashEvent = (command, cwd) => ({ hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command } });

function intact(R) {
  assert.equal(git(R, 'stash', 'list').trim(), '', 'stash list stays empty');
  assert.ok(existsSync(join(R, 'notes.txt')), 'notes.txt survives');
}

const REFUSED_FORMS = [
  'git stash', 'git stash -u', 'git stash --include-untracked', 'git stash -a', 'git stash --all',
  'git stash save "wip"', 'git stash push', 'git stash push -u', 'git stash push -m "wip"',
  'git stash push --keep-index', 'git clean -f', 'git clean -fd', 'git clean -fdx', 'git clean --force',
  'git reset --hard', 'git reset --hard HEAD~1', 'git reset --hard origin/main',
  'git checkout .', 'git checkout -- .', 'git restore .', 'git restore --worktree .',
  'git restore --staged .', 'git restore --staged --worktree .',
  // P1 extras
  'git stash push -- .', 'git stash push src/a.js', 'git checkout HEAD -- .', 'git stash -k',
];

const WRAPPED_FORMS = (R) => [
  `cd ${R} && git stash -u`, 'cd src; git clean -fd', 'FOO=1 git reset --hard', 'GIT_DIR=.git git stash',
  'command git clean -f', 'exec git stash -u', `git -C ${R} stash -u`, `git -C "${R}" reset --hard`,
  `git --git-dir=${R}/.git stash`, 'git -c core.pager=cat stash -u',
  'git status && git stash -u && git stash pop', 'git fetch || git reset --hard origin/main',
  'ac status; git clean -fdx', 'echo y | git clean -f', 'git status\ngit reset --hard',
  'bash -c "git stash -u"', "sh -c 'git reset --hard'", 'bash -c "cd src && git clean -fd"',
  'lean-ctx -c "git stash -u"', "lean-ctx -c 'cd /tmp && git reset --hard'",
  // F2: the recorded rewrite forms
  "/usr/local/bin/lean-ctx -c 'git stash -u'",
  "/usr/local/bin/lean-ctx -c 'git commit -m '\\''it'\\''\\'\\'''\\''s'\\'' && git stash'",
  `lean-ctx -c 'bash -c "git stash -u"'`,
  'env -i git stash -u', 'sudo git clean -fd', 'nohup git stash &', 'zsh -lc "git reset --hard"',
];

const ALLOWED_FORMS = [
  'git stash push -- src/a.js', 'git stash push -m "wip" -- src/a.js notes.txt', 'git stash push -u -- notes.txt',
  'git stash -- src/a.js', 'git stash pop', 'git stash apply stash@{0}', 'git stash list', 'git stash show -p',
  'git stash drop', 'git clean -n', 'git clean --dry-run -d', 'git clean -nd', 'git reset --soft HEAD~1',
  'git reset HEAD src/a.js', 'git reset --mixed', 'git checkout -- src/a.js', 'git checkout main',
  'git checkout -b feat', 'git restore src/a.js', 'git restore --staged src/a.js', 'git status',
  'git log --oneline', 'git log --grep=stash', 'git push --force origin feat', 'git branch -D feat',
  'git worktree remove --force .claude/worktrees/agent-1',
  'echo "never run git stash -u here"', 'git commit -m "avoid git reset --hard"',
  'grep -rn "git clean -fd" docs', 'ac mods disable git-guard', 'ls -la',
  "cat <<'EOF'\ngit stash -u\nEOF",
];

function table(forms, cwds, expect, env) {
  for (const cwd of cwds) {
    for (const cmd of forms) {
      const r = feed(bashEvent(cmd, cwd), { env });
      assert.ok(noStack(r), `no stack for ${cmd}`);
      assert.equal(expect(r), true, `${JSON.stringify(cmd)} @${cwd}: status=${r.status} stdout=${r.stdout}`);
    }
  }
}

// ---------------------------------------------------------------- C3

test('C3: every canon-listed unscoped form is refused in the tree and in a worktree; the config switch is never read', () => {
  const { HOME, R, WT } = sandbox();
  table(REFUSED_FORMS, [R, WT], isRefused, ENV(HOME));
  writeFileSync(join(HOME, '.astro', 'config.json'), '{"mods":{"git-guard":false}}\n');
  assert.equal(isRefused(feed(bashEvent('git stash -u', R), { env: ENV(HOME) })), true);
  intact(R);
});

// ---------------------------------------------------------------- C4

test('C4: wrapped, prefixed and compound spellings are refused', () => {
  const { HOME, R } = sandbox();
  table(WRAPPED_FORMS(R), [R], isRefused, ENV(HOME));
  intact(R);
});

// ---------------------------------------------------------------- C5

test('C5: scoped, read-only, out-of-scope git and mere mentions are never refused', () => {
  const { HOME, R, WT } = sandbox();
  table(ALLOWED_FORMS, [R], isAllowed, ENV(HOME));
  table(ALLOWED_FORMS.slice(0, 12), [WT], isAllowed, ENV(HOME));
  intact(R);
});

// ---------------------------------------------------------------- C6 / C7

test('C6: the reason cites the rule, says why, names the alternative and the escape, briefly', () => {
  const { HOME, R } = sandbox();
  for (const cmd of ['git stash -u', 'git clean -fd', 'git reset --hard', 'git checkout .']) {
    const reason = reasonOf(feed(bashEvent(cmd, R), { env: ENV(HOME) }));
    assert.match(reason, /ADR-035|ADR-038/, cmd);
    assert.match(reason, /repository-wide|destroyed/, cmd);
    assert.ok(reason.includes('git stash push -- <path>'), cmd);
    assert.ok(reason.includes('git stash pop'), cmd);
    assert.ok(reason.includes('ac mods disable git-guard'), cmd);
    assert.ok(reason.split('\n').length <= 8, cmd);
    assert.ok(!reason.includes('ASTRO_'), cmd);
  }
});

test('C7: every refused case returns the same verdict, and it is VERDICT', async () => {
  const { HOME, R } = sandbox();
  const { VERDICT } = await import('../hooks/astro-git-guard.mjs');
  const seen = new Set();
  for (const cmd of [...REFUSED_FORMS, ...WRAPPED_FORMS(R)]) seen.add(verdictOf(feed(bashEvent(cmd, R), { env: ENV(HOME) })));
  assert.deepEqual([...seen], [VERDICT]);
});

// ---------------------------------------------------------------- C8

test('C8: malformed or unexpected input fails open, silently', () => {
  const { HOME, R } = sandbox();
  const env = ENV(HOME);
  const quiet = [
    { rawInput: '' }, { rawInput: 'not json' }, { event: {} }, { event: { tool_name: 'Bash' } },
    { event: { tool_name: 'Bash', tool_input: { command: null } } },
    { event: { tool_name: 'Bash', tool_input: { command: 42 } } },
    { event: { tool_name: 'Write', tool_input: { file_path: '/tmp/x', content: 'git stash -u' } } },
  ];
  for (const c of quiet) {
    const r = feed(c.event, { env, rawInput: c.rawInput });
    assert.equal(isAllowed(r), true, JSON.stringify(c));
    assert.ok(noStack(r));
    assert.equal(r.stderr, '');
  }
  for (const e of [bashEvent('bash -c "git stash -u', R), bashEvent('git stash -u', join(R, 'no-such-dir'))]) {
    const r = feed(e, { env });
    assert.equal(r.status, 0);
    assert.ok(noStack(r));
  }
});

// ---------------------------------------------------------------- C9

test('C9: deciding spawns no other program and is fast', () => {
  const { S, HOME, R } = sandbox();
  const bin = join(S, 'bin');
  const log = join(S, 'spawned.log');
  mkdirSync(bin);
  for (const n of ['git', 'ac', 'jq', 'lean-ctx']) {
    writeFileSync(join(bin, n), `#!/bin/sh\necho ${n} >> "${log}"\n`);
    chmodSync(join(bin, n), 0o755);
  }
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME };
  for (const cmd of [...REFUSED_FORMS, ...WRAPPED_FORMS(R), ...ALLOWED_FORMS]) feed(bashEvent(cmd, R), { env });
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) feed(bashEvent('git status', R), { env });
  assert.ok(Date.now() - t0 < 20000, 'twenty calls under 20 s');
  assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '', 'nothing was spawned');
});

// ---------------------------------------------------------------- Cursor

test('Cursor: the arg and the preToolUse event name both get a deny in Cursor shape', () => {
  const { HOME, R } = sandbox();
  const env = ENV(HOME);
  const payload = (cmd, extra = {}) => ({ tool_name: 'Shell', tool_input: { command: cmd, cwd: R }, ...extra });
  const viaArg = decision(feed(payload('git stash -u'), { env, args: ['cursor'] }));
  const viaEvent = decision(feed(payload('git stash -u', { hook_event_name: 'preToolUse' }), { env }));
  for (const d of [viaArg, viaEvent]) {
    assert.equal(d.permission, 'deny');
    assert.ok(d.user_message && d.user_message.length > 0);
    assert.ok(d.agent_message && d.agent_message.length > 0);
  }
  assert.equal(isAllowed(feed(payload('git status'), { env, args: ['cursor'] })), true);
});

// ---------------------------------------------------------------- single source

test('VERDICT and CURSOR_VERDICT equal the verdicts in GUARD_HOOKS', async () => {
  const { VERDICT, CURSOR_VERDICT } = await import('../hooks/astro-git-guard.mjs');
  const { GUARD_HOOKS } = await import('../lib/hosts/guards.mjs');
  assert.equal(VERDICT, GUARD_HOOKS['git-guard'].claude.verdict);
  assert.equal(CURSOR_VERDICT, GUARD_HOOKS['git-guard'].cursor.verdict);
});

test('drift guard: every spelling NO_BROAD_STASH forbids is refused by decide', async () => {
  const { decide } = await import('../hooks/astro-git-guard.mjs');
  const src = readFileSync(join(FRAMEWORK, 'workflows', 'execute-phase.mjs'), 'utf8');
  const start = src.indexOf('const NO_BROAD_STASH');
  assert.ok(start >= 0);
  const literal = src.slice(start, src.indexOf('Scope it and restore it', start));
  const spellings = [...literal.matchAll(/\\`(git [^`\\]+)\\`/g)].map((m) => m[1]);
  assert.ok(spellings.length >= 4, `found ${spellings.join(' | ')}`);
  for (const s of spellings) {
    assert.ok(decide({ tool_name: 'Bash', tool_input: { command: s } }), `${s} is refused`);
  }
});

test('importing the module does not block on stdin', async () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "await import(process.argv[1]); console.log('ok')", HOOK], {
    input: '', encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(r.stdout, /ok/);
});
