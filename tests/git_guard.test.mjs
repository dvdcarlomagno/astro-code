// Phase 38 t1 — behaviour spec for hooks/astro-git-guard.mjs (CRITERIA C3-C9, the Cursor shape,
// and the single-source ties). RED until t2 lands the script (ADR-018): every reach into the
// hook is a subprocess spawn or an `await import(…)` inside an async test body, so a missing
// script fails only these tests, never the module load.
//
// Everything runs against a temp HOME and a real temp git repo; PATH is pinned. Nothing touches
// a developer's real ~/.claude, ~/.astro or repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync, existsSync, rmSync } from 'node:fs';
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
  // Work at stake in both trees, so "nothing at stake" never lets a refused form through here.
  for (const t of [R, WT]) writeFileSync(join(t, 'src', 'a.js'), 'export const changed = 1;\n');
  writeFileSync(join(WT, 'scratch.txt'), 'untracked\n');
  mkdirSync(join(HOME, 'tmp'));
  return { S, HOME, R, WT };
}

// TMPDIR points inside HOME, so the sandbox repos are not "scratch" to the hook (os.tmpdir()).
const ENV = (HOME, extra = {}) => ({ PATH: PINNED_PATH, HOME, TMPDIR: join(HOME, 'tmp'), ...extra });

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
  'git stash push --keep-index', 'git clean -fd -econfig', 'git clean -fdenotes', 'git clean -fd -e n', 'git clean -f -- -n', 'git clean -f', 'git clean -fd', 'git clean -fdx', 'git clean --force',
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

test('C6: the reason says what the command does, the safer way for it and the off switch, in two lines', () => {
  const { HOME, R } = sandbox();
  const effects = {
    'git stash -u': /stash, which every session shares/,
    'git clean -fd': /deletes every untracked file/,
    'git reset --hard': /throws away every uncommitted change in the repo\. /,
    'git reset --hard HEAD~1': /moves the branch to HEAD~1, dropping any commits after it/,
    'git checkout .': /throws away every uncommitted change/,
    'git restore --staged .': /unstages every staged change in the repo \(the files keep their edits\)/,
    'git restore --staged --worktree .': /throws away every uncommitted change/,
  };
  for (const [cmd, effect] of Object.entries(effects)) {
    const reason = reasonOf(feed(bashEvent(cmd, R), { env: ENV(HOME) }));
    assert.match(reason, effect, cmd);
    assert.match(reason, /Refused\./, cmd);
    if (cmd.startsWith('git clean')) {
      assert.ok(reason.includes('git clean -n'), cmd);
      assert.doesNotMatch(reason, /git stash push/, cmd);
    } else {
      assert.ok(reason.includes('git stash push -- <path>'), cmd);
      assert.ok(reason.includes('git stash pop'), cmd);
    }
    assert.ok(reason.includes('ac mods disable git-guard'), cmd);
    assert.equal(reason.split('\n').length, 2, cmd);
    assert.doesNotMatch(reason, /ADR-\d+|ASTRO_/, cmd);
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

test('C9: deciding spawns nothing; only a refused call asks git, and a git that cannot answer keeps the refusal', () => {
  const { S, HOME, R } = sandbox();
  const bin = join(S, 'bin');
  const log = join(S, 'spawned.log');
  mkdirSync(bin);
  for (const n of ['git', 'ac', 'jq', 'lean-ctx']) {
    writeFileSync(join(bin, n), `#!/bin/sh\necho ${n} >> "${log}"\n`);
    chmodSync(join(bin, n), 0o755);
  }
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME, TMPDIR: join(HOME, 'tmp') };
  const spawned = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  for (const cmd of ALLOWED_FORMS) feed(bashEvent(cmd, R), { env });
  assert.equal(spawned(), '', 'an allowed call spawns nothing');
  for (const cmd of [...REFUSED_FORMS, ...WRAPPED_FORMS(R)]) {
    assert.equal(isRefused(feed(bashEvent(cmd, R), { env })), true, `${cmd}: a git with no answer keeps the refusal`);
  }
  assert.match(spawned(), /^(git\n)+$/, 'a refused call spawns git and nothing else');
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) feed(bashEvent('git status', R), { env });
  assert.ok(Date.now() - t0 < 20000, 'twenty calls under 20 s');
});

// ---------------------------------------------------------------- nothing at stake

function cleanRepo(S, name) {
  const C = join(S, name);
  mkdirSync(join(C, 'src'), { recursive: true });
  git(C, 'init', '-q', '-b', 'main');
  writeFileSync(join(C, 'src', 'a.js'), 'export {};\n');
  writeFileSync(join(C, '.gitignore'), '*.log\n');
  git(C, 'add', '-A');
  git(C, 'commit', '-q', '-m', 'init');
  git(C, 'commit', '-q', '--allow-empty', '-m', 'second');
  return C;
}

test('a probe that puts back its own file is not refused: a literal variable, a loop over named files or a glob under a named folder', () => {
  const { HOME, R } = sandbox();
  const env = ENV(HOME);
  table([
    'F=src/a.js; printf x >> $F; git checkout -- $F', 'F=src/a.js; git checkout -- "$F"', 'F=src/a.js; git checkout -q ${F}',
    'export W=src/a.js; git checkout $W notes.txt', 'FOO=1 BAR=src; git restore $BAR', 'git checkout src/*.js', 'git checkout -- src/*',
    'diff <(git show HEAD:src/a.js) src/a.js', 'diff <(cut -f2 notes.txt | sort) <(cut -f1 notes.txt)',
    'for F in src/a.js; do git checkout -- $F; done', 'for f in src/a.js notes.txt; do for s in x y; do git checkout -- "$f"; done; done',
  ], [R], isAllowed, env);
  table([
    'F=.; git checkout -- $F', 'F=$(pwd); git checkout -- $F', 'git checkout -- $F; F=src/a.js', 'F=src/a.js; F=.; git checkout -- $F',
    'F=src/a.js git checkout -- $F', 'read F; git checkout -- $F', 'for F in src/a.js .; do git checkout -- $F; done',
    'for F in *; do git checkout -- $F; done', 'for F in $(git ls-files); do git checkout -- $F; done', 'for F in src/a.js; do F=.; git checkout -- $F; done',
    'for F in src/a.js; do :; done; for F in .; do git checkout -- $F; done',
    'git checkout -- *.js', 'git checkout -- */a.js', 'diff <(git reset --hard) notes.txt', 'cat <(git stash -u)', `D=${R}; git checkout -- $D`, 'F=src/a.js; git stash push -- $F/../..',
  ], [R], isRefused, env);
  intact(R);
});

test('nothing at stake: a clean tree is not refused; a commit-dropping reset, odd shapes and unsure calls still are', () => {
  const { S, HOME, R } = sandbox();
  const C = cleanRepo(S, 'clean');
  const env = ENV(HOME);
  const allowed = ['git reset --hard', 'git reset --hard HEAD', 'git reset -q --hard', 'git checkout .', 'git restore .',
    'git checkout -f main', 'git stash', 'git stash -u', 'git clean -fd', 'git clean -fdx'];
  table(allowed, [C], isAllowed, env);
  table([`cd ${C} && git reset --hard`, `cd ${C}; git clean -fd`, `bash -c "cd ${C} && git reset --hard"`], [R], isAllowed, env);
  const asked = ['git reset --hard HEAD~1', 'git reset --hard origin/main', `git -C ${C} reset --hard`, 'FOO=1 git reset --hard',
    'touch x && git reset --hard', 'git status && git reset --hard', 'git reset --hard $REF',
    'git -C $(pwd) stash', `cd ${C} && touch x && git reset --hard`, 'cd ~ && git reset --hard'];
  table(asked, [C], isRefused, env);
  table([`cd ${R} && git reset --hard`], [C], isRefused, env);
  // Only what each command destroys counts: an untracked file stakes clean and stash -u, not reset.
  writeFileSync(join(C, 'new.txt'), 'x\n');
  table(['git reset --hard'], [C], isAllowed, env);
  table(['git clean -fd', 'git stash -u', 'git checkout .'], [C], isRefused, env);
  rmSync(join(C, 'new.txt'));
  writeFileSync(join(C, 'build.log'), 'x\n');
  table(['git clean -fd'], [C], isAllowed, env);
  table(['git clean -fdx', 'git stash -a'], [C], isRefused, env);
});

test('nothing at stake: a repo whose git data is under TMPDIR is scratch; a worktree of a real repo placed there is not', () => {
  const { S, HOME, R } = sandbox();
  const scratch = ENV(HOME, { TMPDIR: S });
  table(['git reset --hard', 'git clean -fd', 'git stash -u'], [R], isAllowed, scratch);
  table(['git reset --hard $REF'], [R], isRefused, scratch);
  const WT2 = join(HOME, 'tmp', 'wt2');
  git(R, 'worktree', 'add', '-q', WT2, '-b', 'wt2');
  writeFileSync(join(WT2, 'src', 'a.js'), 'export const changed = 2;\n');
  table(['git reset --hard', 'git stash'], [WT2], isRefused, ENV(HOME));
});

test('nothing at stake: a repo marked .git/astrocode-scratch is scratch wherever it lives; an unmarked project is still refused', () => {
  const { S, HOME, R, WT } = sandbox();
  const C = cleanRepo(S, 'copy');
  writeFileSync(join(C, 'src', 'a.js'), 'export const probed = 1;\n');
  writeFileSync(join(C, 'junk.txt'), 'x\n');
  table(['git reset --hard', 'git checkout -q -- .', 'git clean -fdq'], [C], isRefused, ENV(HOME));
  writeFileSync(join(C, '.git', 'astrocode-scratch'), '');
  table(['git reset --hard', 'git checkout -q -- .', 'git clean -fdq', `cd ${C} && git reset --hard`], [C], isAllowed, ENV(HOME));
  table(['git reset --hard $BASE'], [C], isRefused, ENV(HOME));
  table(['git reset --hard'], [R, WT], isRefused, ENV(HOME));
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

// Regression cases a verifier executed for real in a scratch repo: each destroyed data while the
// guard allowed it (phase 38, first verify run). Same-effect spellings (git's unambiguous long-option
// abbreviations, an --exclude value that looks like -n, a later --no-dry-run) and wrappers that hide
// the git command (timeout, stdbuf, exec -a NAME, env -C DIR, git global options outside a fixed list).
const BYPASS_FORMS = [
  'git clean -f --exclude -n', 'git clean -n --no-dry-run -f',
  'git reset --har', 'git reset --ha',
  'timeout 60 git reset --hard', 'timeout -s KILL 5 git stash -u', 'stdbuf -oL git clean -fd',
  'exec -a x git stash', 'env -C /tmp git stash',
  'git --no-advice reset --hard', 'git --glob-pathspecs stash',
];

test('C3/C4: spellings and wrappers that destroyed data in a real repo are refused', () => {
  const { HOME, R, WT } = sandbox();
  table(BYPASS_FORMS, [R, WT], isRefused, ENV(HOME));
  intact(R);
});

// Round three (phase 38, third verify run), plus the shapes "ask when unsure" exists for: the
// guard can't prove these scoped, so it asks. Each `R`-relative or `$PWD` pathspec names the
// whole tree when run from the repo root.
const UNSURE_FORMS = (R) => [
  'git reset --h', 'git reset --h HEAD~1',
  'git stash push -- "$PWD"', `git stash push -- ${R}`, 'git stash push -- src/..', "git stash push -- '**'",
  "git stash push -- ':!x'", 'git checkout -- "$PWD"', "git checkout HEAD -- '**'", `git restore -- ${R}`,
  "git restore -W -- '**'",
  "env -S 'git stash -u'", "env --split-string='git stash -u'", 'env -S"git reset --hard"',
  'git -C $(pwd) stash -u', 'git -C $(git rev-parse --show-toplevel) reset --hard', 'git -C $(pwd) clean -fd',
  'git --git-dir=$(pwd)/.git stash -u', 'git --attr-source HEAD stash -u',
  // unsure shapes
  '$GIT stash -u', '"$(command -v git)" reset --hard', 'git --frobnicate stash',
  'xargs git clean -f', 'watch git reset --hard', 'eval "git stash -u"', 'git checkout -- $TARGET',
];

test('C3/C4: whole-tree pathspecs, env -S, $(…) values and unknown wrappers are refused', () => {
  const { HOME, R } = sandbox();
  table(UNSURE_FORMS(R), [R], isRefused, ENV(HOME));
  intact(R);
});

// Round four (phase 38, fourth verify run): each ran for real and destroyed work while allowed.
const ROUND4_FORMS = [
  "bash -c -- 'git stash -u'", "sh -c -- 'git reset --hard'",
  'git -c alias.x=stash x -u', "git -c alias.x='reset --hard' x", "git -c alias.wipe='clean -fd' wipe",
  'git -c alias.co=checkout co .', "git -c 'alias.x=!git stash -u' x", 'git -c help.autocorrect=immediate stsh -u',
  'git stash push -m -- -u', 'git stash -m -- -u', 'git stash push -m -- -a', 'git stash push --message -- --include-untracked',
  "printf '.\\n' | git stash push --pathspec-from-file=-", "printf '.\\n' | git stash push --pathspec-from-file=- -u",
  "printf '.\\n' | git checkout --pathspec-from-file=- HEAD", "printf '.\\n' | git restore --pathspec-from-file=-",
  'git checkout -f', 'git checkout -f HEAD', 'git checkout --force main', 'git switch -f main', 'git switch --discard-changes main',
];

test('C3/C4: round-four spellings (aliases, -c --, -m values, pathspec files, -f) are refused', () => {
  const { HOME, R } = sandbox();
  table(ROUND4_FORMS, [R], isRefused, ENV(HOME));
  intact(R);
});

// ADR-082: what the guard cannot read at all runs. Matching the text for "git" and a destructive
// word anywhere refused a mutation-test script whose comment said "restore FILE", and the ask
// stalled an unattended workflow until the user came back.
const UNREAD_FORMS = [
  'git $SUB -u', "echo 'git stash -u' | bash", "x='git stash -u'; $x", `C='git reset --hard'; bash -c "$C"`,
  `bash -c "bash -c \\"bash -c 'git stash -u'\\""`,
  "# one mutation of FILE, then restore FILE\nR=/repo\ngit -C $R archive HEAD server | tar -x -C /tmp/p\n$P cometjobs TestX pick.go 'if a {' 'if false {'",
];

test('ADR-082: calls the guard cannot read run, and a refusal is a deny, never an ask', () => {
  const { HOME, R } = sandbox();
  table(UNREAD_FORMS, [R], isAllowed, ENV(HOME));
  assert.equal(verdictOf(feed(bashEvent('git stash -u', R), { env: ENV(HOME) })), 'deny');
  intact(R);
});

test('ADR-082: a scratch-copy probe runs with assignments, a wrapper and its test after the reset; the project is still refused', () => {
  const { S, HOME, R } = sandbox();
  const scratch = ENV(HOME, { TMPDIR: S });
  const C = cleanRepo(S, 'mut');
  writeFileSync(join(C, 'src', 'a.js'), 'export const mutated = 1;\n');
  table([
    `M=${C}; cd $M; git checkout -q -- .; git diff --stat; node --version`,
    `/usr/local/bin/lean-ctx -c 'M=${C}; cd $M; git checkout -q -- .; grep -n x src/a.js | head'`,
  ], [R], isAllowed, scratch);
  table([`cd ${C}; git checkout -q -- .; cd ${R}; git reset --hard`, `cd ${C}; git checkout -- .; git -C ${R} stash -u`], [R], isRefused, scratch);
  table([`cd ${R}; git checkout -q -- .; echo hi`], [R], isRefused, ENV(HOME));
});
