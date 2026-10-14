// Phase 37 t1 — behaviour spec for hooks/astro-canon-guard.mjs (CRITERIA C3-C10, plus the
// Cursor shape and the store-path parity). RED until t2 lands the script (ADR-018): every
// reach into the hook is a subprocess spawn or an `await import(…)` inside an async test
// body, so a missing script fails only these tests, never the module load.
//
// Everything runs against a temp HOME and temp git projects; CLAUDE_CONFIG_DIR,
// CURSOR_CONFIG_DIR and ASTRO_PRINCIPLES_DIR are dropped unless a test sets them, and PATH
// is pinned. Nothing touches a developer's real ~/.claude, ~/.astro or repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync, chmodSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(FRAMEWORK, 'hooks', 'astro-canon-guard.mjs');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');
const PINNED_PATH = '/usr/bin:/bin';

// ---------------------------------------------------------------- harness

function runGit(cwd, args) {
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf8',
    env: { PATH: PINNED_PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  return r;
}
function gitOk(cwd, ...args) {
  const r = runGit(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args]);
  assert.equal(r.status === 0 || args[0] === 'merge', true, `git ${args.join(' ')}: ${r.stderr}`);
  return r;
}

const PROTECTED_NAMES = ['roadmap.json', 'state.json', 'debt.json', 'backlog.json', 'fixes.json', 'ROADMAP.md', 'DECISIONS.in-force.md'];
const UNPROTECTED_FILES = ['config.json', 'CONVENTIONS.md', 'DECISIONS.md', 'PROJECT.md'];

function makeProject(S, name = 'p') {
  const P = join(S, name);
  mkdirSync(join(P, '.astrocode', 'phases', '37-x'), { recursive: true });
  mkdirSync(join(P, 'src'), { recursive: true });
  mkdirSync(join(P, 'docs'), { recursive: true });
  for (const n of [...PROTECTED_NAMES, ...UNPROTECTED_FILES]) {
    writeFileSync(join(P, '.astrocode', n), n.endsWith('.json') ? '{\n  "k": "v"\n}\n' : `# ${n}\n`);
  }
  writeFileSync(join(P, '.astrocode', 'phases', '37-x', 'CONTEXT.md'), '# ctx\n');
  writeFileSync(join(P, '.astrocode', 'phases', '37-x', 'PLAN.md'), '# plan\n');
  writeFileSync(join(P, '.astrocode', 'phases', '37-x', 'state.json'), '{}\n');
  writeFileSync(join(P, '.astrocode', 'ROADMAP.md.bak'), 'bak\n');
  writeFileSync(join(P, 'src', 'a.js'), 'export {};\n');
  writeFileSync(join(P, 'docs', 'roadmap.json'), '{}\n');
  // symlinked files under src/ pointing at each protected file
  for (const n of PROTECTED_NAMES) symlinkSync(join('..', '.astrocode', n), join(P, 'src', `s-${n}`));
  gitOk(P, 'init', '-q', '-b', 'main');
  gitOk(P, 'add', '-A');
  gitOk(P, 'commit', '-q', '-m', 'init');
  return P;
}

function sandbox() {
  const S = realpathSync(mkdtempSync(join(tmpdir(), 'ac-canon-guard-')));
  const HOME = join(S, 'home');
  mkdirSync(join(HOME, '.claude'), { recursive: true });
  mkdirSync(join(HOME, '.astro', 'principles'), { recursive: true });
  writeFileSync(join(HOME, '.astro', 'principles', 'p-1.md'), '---\nid: p-1\n---\nstmt\n');
  writeFileSync(join(HOME, '.astro', 'config.json'), '{"mods":{"canon-guard":false}}\n');
  writeFileSync(join(HOME, '.astro', 'principles-notes.md'), 'notes\n');
  const P = makeProject(S);
  symlinkSync(P, join(S, 'link'));
  return { S, HOME, P };
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
function isDenied(r) {
  if (r.status === 2) return true;
  const d = decision(r);
  return r.status === 0 && d?.hookSpecificOutput?.permissionDecision === 'deny';
}
function isAllowed(r) {
  return r.status === 0 && !r.stdout.trim() && !/permissionDecision/.test(r.stdout);
}
function reasonOf(r) {
  return r.status === 2 ? r.stderr : decision(r)?.hookSpecificOutput?.permissionDecisionReason ?? '';
}
function noStack(r) {
  return !/ {4}at /.test(r.stdout) && !/ {4}at /.test(r.stderr) && !/^\w*Error:/m.test(r.stderr);
}

const claudeEvent = (tool, p, cwd) => {
  const base = { hook_event_name: 'PreToolUse', cwd, tool_name: tool };
  if (tool === 'Write') return { ...base, tool_input: { file_path: p, content: 'x' } };
  if (tool === 'Edit') return { ...base, tool_input: { file_path: p, old_string: 'a', new_string: 'b' } };
  if (tool === 'MultiEdit') return { ...base, tool_input: { file_path: p, edits: [{ old_string: 'a', new_string: 'b' }] } };
  if (tool === 'NotebookEdit') return { ...base, tool_input: { notebook_path: p, new_source: 'x' } };
  throw new Error(tool);
};
const bashEvent = (command, cwd) => ({ hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command } });
const TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

// ---------------------------------------------------------------- C3

test('C3: every protected file x tool x path spelling is denied', () => {
  const { S, HOME, P } = sandbox();
  try {
    const env = ENV(HOME);
    const spellings = (n) => [
      ['absolute', join(P, '.astrocode', n), P],
      ['relative', `.astrocode/${n}`, P],
      ['dot-relative', `./.astrocode/${n}`, P],
      ['src/..', `src/../.astrocode/${n}`, P],
      ['../ from src', `../.astrocode/${n}`, join(P, 'src')],
      ['absolute, cwd /', join(P, '.astrocode', n), '/'],
      ['symlinked dir', join(S, 'link', '.astrocode', n), P],
      ['symlinked file', join(P, 'src', `s-${n}`), P],
    ];
    for (const n of PROTECTED_NAMES) {
      for (const [label, p, cwd] of spellings(n)) {
        for (const tool of TOOLS) {
          const r = feed(claudeEvent(tool, p, cwd), { env });
          assert.ok(isDenied(r), `${tool} ${label} ${n}: expected deny, got status ${r.status} out=${r.stdout} err=${r.stderr}`);
        }
      }
    }
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('C3: on a case-insensitive filesystem a differently-cased spelling is denied too', (t) => {
  const { S, HOME, P } = sandbox();
  try {
    if (!existsSync(join(P, '.astrocode', 'STATE.JSON')) && !existsSync(join(P, '.ASTROCODE'))) {
      return t.skip('case-sensitive filesystem');
    }
    const env = ENV(HOME);
    for (const n of ['STATE.json', 'Roadmap.JSON']) {
      const r = feed(claudeEvent('Write', join(P, '.astrocode', n), P), { env });
      assert.ok(isDenied(r), `${n}: expected deny, got status ${r.status} out=${r.stdout}`);
    }
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('C3: a differently-cased spelling of a not-yet-existing protected file is denied on any filesystem', () => {
  // On macOS a Write to FIXES.json creates fixes.json; realpath can't fix the case of a
  // file that isn't there yet, so the name itself must compare case-insensitively.
  const { S, HOME, P } = sandbox();
  try {
    const env = ENV(HOME);
    for (const n of ['fixes.json', 'debt.json', 'backlog.json']) rmSync(join(P, '.astrocode', n), { force: true });
    for (const n of ['FIXES.json', 'Fixes.json', 'DEBT.json', 'Backlog.json', 'roadmap.JSON', 'ROADMAP.MD', 'decisions.IN-FORCE.md']) {
      const w = feed(claudeEvent('Write', `.astrocode/${n}`, P), { env });
      assert.ok(isDenied(w), `Write ${n}: expected deny, got status ${w.status} out=${w.stdout}`);
      const b = feed(bashEvent(`echo x > .astrocode/${n}`, P), { env });
      assert.ok(isDenied(b), `Bash > ${n}: expected deny, got status ${b.status} out=${b.stdout}`);
    }
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('C3: the principle store is protected, in the default place and under ASTRO_PRINCIPLES_DIR', () => {
  const { S, HOME, P } = sandbox();
  try {
    const env = ENV(HOME);
    const store = join(HOME, '.astro', 'principles', 'p-1.md');
    for (const tool of TOOLS) {
      assert.ok(isDenied(feed(claudeEvent(tool, store, P), { env })), `${tool} default store`);
      assert.ok(isDenied(feed(claudeEvent(tool, '~/.astro/principles/p-1.md', P), { env })), `${tool} ~ store`);
    }
    const alt = join(S, 'alt');
    mkdirSync(alt);
    writeFileSync(join(alt, 'p-2.md'), 'x\n');
    const envAlt = ENV(HOME, { ASTRO_PRINCIPLES_DIR: alt });
    assert.ok(isDenied(feed(claudeEvent('Write', join(alt, 'p-2.md'), P), { env: envAlt })), 'override store denied');
    assert.ok(isDenied(feed(claudeEvent('Write', join(alt, 'new.md'), P), { env: envAlt })), 'new file in override store denied');
    // with the override set, the default location is no longer the store
    assert.ok(isAllowed(feed(claudeEvent('Write', store, P), { env: envAlt })), 'default store unprotected once overridden');
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('C3: a Write creating a deleted fixes.json (target does not exist) is denied', () => {
  const { S, HOME, P } = sandbox();
  try {
    rmSync(join(P, '.astrocode', 'fixes.json'));
    const r = feed(claudeEvent('Write', join(P, '.astrocode', 'fixes.json'), P), { env: ENV(HOME) });
    assert.ok(isDenied(r), `status ${r.status} out=${r.stdout}`);
    const rel = feed(claudeEvent('Write', '.astrocode/fixes.json', P), { env: ENV(HOME) });
    assert.ok(isDenied(rel));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('C3: the script never consults the config switch (mods.canon-guard:false or no key) — registration is the switch', () => {
  const { S, HOME, P } = sandbox();
  try {
    const cfg = join(HOME, '.astro', 'config.json');
    assert.match(readFileSync(cfg, 'utf8'), /"canon-guard":false/);
    assert.ok(isDenied(feed(claudeEvent('Write', join(P, '.astrocode', 'state.json'), P), { env: ENV(HOME) })));
    rmSync(cfg);
    assert.ok(isDenied(feed(claudeEvent('Write', join(P, '.astrocode', 'state.json'), P), { env: ENV(HOME) })));
    assert.doesNotMatch(readFileSync(HOOK, 'utf8').replace(/\/\/.*$/gm, ''), /config\.json|readMods|switches/);
  } finally { rmSync(S, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- C4

function allowedWriteTargets(HOME, P, S) {
  const fresh = mkdtempSync(join(tmpdir(), 'ac-canon-fresh-'));
  const list = [
    ...UNPROTECTED_FILES.map((n) => [`.astrocode/${n}`, P]),
    [join(HOME, '.astro', 'config.json'), P],
    ['.astrocode/phases/37-x/CONTEXT.md', P],
    ['.astrocode/phases/37-x/PLAN.md', P],
    ['.astrocode/phases/37-x/state.json', P],
    ['.astrocode/ROADMAP.md.bak', P],
    ['src/a.js', P],
    ['docs/roadmap.json', P],
    [join(HOME, '.astro', 'principles-notes.md'), P],
    [join(fresh, 'state.json'), P],
  ];
  writeFileSync(join(fresh, 'state.json'), '{}\n');
  return { list, fresh };
}

test('C4: files outside the protected set are allowed with no decision at all', () => {
  const { S, HOME, P } = sandbox();
  const { list, fresh } = allowedWriteTargets(HOME, P, S);
  try {
    for (const [p, cwd] of list) {
      for (const tool of ['Write', 'Edit']) {
        const r = feed(claudeEvent(tool, p, cwd), { env: ENV(HOME) });
        assert.ok(isAllowed(r), `${tool} ${p}: status ${r.status} out=${r.stdout} err=${r.stderr}`);
      }
    }
  } finally { rmSync(S, { recursive: true, force: true }); rmSync(fresh, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- C5 / C6

test('C5: obvious Bash writes to a protected file are denied, segment by segment', () => {
  const { S, HOME, P } = sandbox();
  try {
    const env = ENV(HOME);
    const store = join(HOME, '.astro', 'principles', 'p-1.md');
    const cases = [
      ['echo x > .astrocode/state.json', P],
      ['echo x >.astrocode/state.json', P],
      ['echo x >> .astrocode/debt.json', P],
      ["sed -i 's/a/b/' .astrocode/roadmap.json", P],
      ["sed -i.bak 's/a/b/' .astrocode/roadmap.json", P],
      ["perl -pi -e 's/a/b/' .astrocode/backlog.json", P],
      ['echo x | tee .astrocode/fixes.json', P],
      ['echo x | tee -a .astrocode/ROADMAP.md', P],
      ['cp /tmp/x .astrocode/ROADMAP.md', P],
      ['mv /tmp/x .astrocode/DECISIONS.in-force.md', P],
      ['rm -f .astrocode/state.json', P],
      ['truncate -s 0 .astrocode/state.json', P],
      ['dd if=/dev/null of=.astrocode/state.json', P],
      [`echo x > ${store}`, P],
      ['ac status && echo x > .astrocode/state.json', P],
      ['git status; rm .astrocode/debt.json', P],
      ['cat src/a.js | tee .astrocode/roadmap.json', P],
      ['echo x > ../.astrocode/state.json', join(P, 'src')],
      ['(echo x > .astrocode/state.json)', P],
      ['(rm .astrocode/state.json)', P],
      ['(cp /tmp/x .astrocode/roadmap.json)', P],
      ['(cd .astrocode && echo x > state.json)', P],
      [`echo x > ${P}/.astrocode/state.json`, '/tmp'],
      // a shell keyword or brace in front of the command word
      ['if [ -f .astrocode/state.json ]; then rm .astrocode/state.json; fi', P],
      ['if true; then echo; else rm .astrocode/state.json; fi', P],
      ['while false; do cp /tmp/x .astrocode/state.json; done', P],
      ['for f in .astrocode/state.json; do sed -i s/a/b/ .astrocode/state.json; done', P],
      ['{ rm .astrocode/state.json; }', P],
      ['! rm .astrocode/fixes.json', P],
      // the shell performs the redirect, even on an ac or git line
      ['ac status > .astrocode/state.json', P],
      ['git show HEAD:.astrocode/state.json > .astrocode/state.json', P],
    ];
    for (const [command, cwd] of cases) {
      const r = feed(bashEvent(command, cwd), { env });
      assert.ok(isDenied(r), `expected deny for: ${command} (cwd ${cwd}) — status ${r.status} out=${r.stdout}`);
    }
  } finally { rmSync(S, { recursive: true, force: true }); }
});

const BASH_ALLOW = [
  "perl -Ilib -ne 'print' .astrocode/state.json",
  "perl -Mwarnings -ne 'print' .astrocode/roadmap.json",
  "perl -Mstrict -e 'print 1' .astrocode/state.json",
  'ac phase add "x"',
  'ac roadmap render',
  'ac debt list',
  'cat .astrocode/state.json',
  'head -n 5 .astrocode/roadmap.json',
  'grep -n phase .astrocode/roadmap.json 2>/dev/null',
  "jq '.phases' .astrocode/roadmap.json",
  'sed -n 1p .astrocode/state.json',
  'cat .astrocode/state.json > /tmp/copy.json',
  'cp .astrocode/roadmap.json /tmp/r.json',
  'ls -la .astrocode',
  'git add .astrocode/roadmap.json',
  'git checkout -- .astrocode/state.json',
  'echo x > src/a.js',
  'echo x > .astrocode/config.json',
  'rm .astrocode/phases/37-x/PLAN.md',
];

test('C6: sanctioned and read-only Bash is never refused', () => {
  const { S, HOME, P } = sandbox();
  try {
    for (const command of BASH_ALLOW) {
      const r = feed(bashEvent(command, P), { env: ENV(HOME) });
      assert.ok(isAllowed(r), `expected allow for: ${command} — status ${r.status} out=${r.stdout} err=${r.stderr}`);
    }
  } finally { rmSync(S, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- C7

const VERBS = {
  'roadmap.json': { say: ['ac phase', 'ac milestone'], help: [['phase'], ['milestone']], source: /AGENTS\.md|ADR-004/ },
  'state.json': { say: ['ac phase', 'ac milestone'], help: [['phase'], ['milestone']], source: /AGENTS\.md|ADR-004/ },
  'debt.json': { say: ['ac debt'], help: [['debt']], source: /AGENTS\.md|ADR-004/ },
  'backlog.json': { say: ['ac backlog'], help: [['backlog']], source: /AGENTS\.md|ADR-004/ },
  'fixes.json': { say: ['ac fix'], help: [['fix']], source: /AGENTS\.md|ADR-004/ },
  'ROADMAP.md': { say: ['ac roadmap render'], help: [['roadmap', 'render']], source: /AGENTS\.md|ADR-004/ },
  'DECISIONS.in-force.md': { say: ['ac canon pull'], help: [['canon', 'pull']], source: /AGENTS\.md|ADR-004/ },
};

function helpCovers(helpText, words) {
  // every word on ONE `ac <first>` help line; `enable|disable` and `[pull …]` cover the word
  const re = new RegExp(`^\\s*ac ${words[0]}\\b(.*)$`, 'm');
  const lines = helpText.split('\n').filter((l) => re.test(l));
  return lines.some((l) => words.slice(1).every((w) => l.includes(w)));
}

test('C7: the reason names the rule source, that file\'s verb, and both escapes, in two lines', () => {
  const { S, HOME, P } = sandbox();
  try {
    const help = spawnSync(process.execPath, [AC, 'help'], { encoding: 'utf8', env: ENV(HOME) }).stdout;
    const store = join(HOME, '.astro', 'principles', 'p-1.md');
    const rows = [
      ...PROTECTED_NAMES.map((n) => [n, join(P, '.astrocode', n), VERBS[n]]),
      ['principle store', store, { say: ['ac principles'], help: [['principles']], source: /ADR-057|ADR-058/ }],
    ];
    for (const [label, p, spec] of rows) {
      const r = feed(claudeEvent('Write', p, P), { env: ENV(HOME) });
      assert.ok(isDenied(r), label);
      const reason = reasonOf(r);
      assert.match(reason, spec.source, `${label}: names its source`);
      for (const verb of spec.say) assert.ok(reason.includes(verb), `${label}: names "${verb}" in: ${reason}`);
      for (const words of spec.help) assert.ok(helpCovers(help, words), `${label}: "ac ${words.join(' ')}" is in ac help`);
      assert.match(reason, /conflict|merge/i, `${label}: conflict escape`);
      assert.ok(reason.includes('ac mods disable canon-guard'), `${label}: mods escape`);
      assert.equal(reason.trim().split('\n').length, 2, `${label}: two lines`);
      assert.doesNotMatch(reason, /ASTRO_[A-Z_]+|\benv(ironment)? var/i, `${label}: no env-var escape`);
      assert.ok(noStack(r), `${label}: no stack trace`);
      if (label === 'ROADMAP.md') assert.ok(!reason.includes('ac phase'), 'ROADMAP.md is not pointed at ac phase');
    }
    assert.ok(helpCovers(help, ['mods', 'disable']), '`ac mods enable|disable` is in ac help');
  } finally { rmSync(S, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- C8

function conflictedProject(S, name) {
  const Q = makeProject(S, name);
  const rm = join(Q, '.astrocode', 'roadmap.json');
  gitOk(Q, 'checkout', '-q', '-b', 'side');
  writeFileSync(rm, '{\n  "k": "side"\n}\n');
  gitOk(Q, 'commit', '-q', '-am', 'side');
  gitOk(Q, 'checkout', '-q', 'main');
  writeFileSync(rm, '{\n  "k": "main"\n}\n');
  gitOk(Q, 'commit', '-q', '-am', 'main');
  gitOk(Q, 'merge', 'side');
  return Q;
}

test('C8a: a protected file carrying a line-start conflict marker may be edited', () => {
  const { S, HOME, P } = sandbox();
  try {
    writeFileSync(join(P, '.astrocode', 'debt.json'), '<<<<<<< HEAD\n{}\n=======\n{"a":1}\n>>>>>>> other\n');
    for (const tool of ['Write', 'Edit']) {
      const r = feed(claudeEvent(tool, '.astrocode/debt.json', P), { env: ENV(HOME) });
      assert.ok(isAllowed(r), `${tool}: ${r.stdout}`);
    }
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('C8b-d: a real unmerged file is editable (markers or not), per file, and denied again after commit', () => {
  const { S, HOME } = sandbox();
  try {
    const Q = conflictedProject(S, 'q');
    const env = ENV(HOME);
    const status = runGit(Q, ['status', '--porcelain']).stdout;
    assert.match(status, /^UU .*roadmap\.json/m, 'fixture really conflicts');

    assert.ok(isAllowed(feed(claudeEvent('Edit', '.astrocode/roadmap.json', Q), { env })), 'b: with markers');

    // strip the markers by hand, WITHOUT git add — still UU, still editable
    writeFileSync(join(Q, '.astrocode', 'roadmap.json'), '{\n  "k": "resolved"\n}\n');
    assert.match(runGit(Q, ['status', '--porcelain']).stdout, /^UU .*roadmap\.json/m, 'still unmerged');
    assert.ok(isAllowed(feed(claudeEvent('Edit', '.astrocode/roadmap.json', Q), { env })), 'b: markers stripped, still UU');

    // c: the escape is per file, not repo-wide
    assert.ok(isDenied(feed(claudeEvent('Write', '.astrocode/state.json', Q), { env })), 'c: clean state.json still denied');

    // d: resolved + committed -> denied again
    gitOk(Q, 'add', '.astrocode/roadmap.json');
    gitOk(Q, 'commit', '-q', '-m', 'resolve');
    assert.equal(runGit(Q, ['status', '--porcelain']).stdout.trim(), '');
    assert.ok(isDenied(feed(claudeEvent('Edit', '.astrocode/roadmap.json', Q), { env })), 'd: denied after resolution');
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('C8e: a mid-line <<<<<<< in a clean protected file does not open the escape', () => {
  const { S, HOME, P } = sandbox();
  try {
    writeFileSync(join(P, '.astrocode', 'debt.json'), '{"note":"see <<<<<<< HEAD marker"}\n');
    assert.ok(isDenied(feed(claudeEvent('Write', '.astrocode/debt.json', P), { env: ENV(HOME) })));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- C9

test('C9: malformed or unexpected input fails open, silently', () => {
  const { S, HOME, P } = sandbox();
  try {
    const env = ENV(HOME);
    const state = join(P, '.astrocode', 'state.json');
    const raws = [
      '',
      'not json',
      '{}',
      JSON.stringify({ tool_name: 'Write' }),
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 42 } }),
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: null } }),
      JSON.stringify({ tool_name: 'FutureTool', tool_input: { file_path: state } }),
      JSON.stringify({ tool_name: 'Write', cwd: join(S, 'no-such-dir'), tool_input: { file_path: 'state.json' } }),
    ];
    for (const raw of raws) {
      const r = feed(null, { env, rawInput: raw });
      assert.ok(isAllowed(r), `input ${JSON.stringify(raw)}: status ${r.status} out=${r.stdout} err=${r.stderr}`);
      assert.ok(noStack(r), `input ${JSON.stringify(raw)}: no stack`);
      assert.equal(r.stderr.trim(), '', `input ${JSON.stringify(raw)}: silent`);
    }
  } finally { rmSync(S, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- C10

test('C10: deciding an unprotected call spawns no other program, and is quick', () => {
  const { S, HOME, P } = sandbox();
  const { list, fresh } = allowedWriteTargets(HOME, P, S);
  try {
    const bin = join(S, 'bin');
    const log = join(S, 'spawned.log');
    mkdirSync(bin);
    writeFileSync(log, '');
    for (const name of ['git', 'ac', 'jq']) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "${log}"\nexit 0\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const env = { PATH: `${bin}:${PINNED_PATH}`, HOME };
    for (const [p, cwd] of list) {
      for (const tool of ['Write', 'Edit']) {
        assert.ok(isAllowed(feed(claudeEvent(tool, p, cwd), { env })), `${tool} ${p}`);
      }
    }
    for (const command of BASH_ALLOW) {
      assert.ok(isAllowed(feed(bashEvent(command, P), { env })), command);
    }
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) feed(claudeEvent('Write', 'src/a.js', P), { env });
    const ms = Date.now() - t0;
    assert.equal(readFileSync(log, 'utf8'), '', 'no git/ac/jq was spawned');
    assert.ok(ms < 20000, `20 unprotected Writes took ${ms} ms`);
  } finally { rmSync(S, { recursive: true, force: true }); rmSync(fresh, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- Cursor shape

test('Cursor: with the cursor arg a preToolUse payload gets the permission:deny shape', () => {
  const { S, HOME, P } = sandbox();
  try {
    const env = ENV(HOME);
    const state = join(P, '.astrocode', 'state.json');
    const payloads = [
      { hook_event_name: 'preToolUse', cwd: P, tool_name: 'Write', tool_input: { file_path: state, content: 'x' } },
      { hook_event_name: 'preToolUse', cwd: P, tool_name: 'Delete', tool_input: { file_path: state } },
      { hook_event_name: 'preToolUse', cwd: P, tool_name: 'Shell', tool_input: { command: 'echo x > .astrocode/state.json', cwd: P } },
    ];
    for (const ev of payloads) {
      const r = feed(ev, { env, args: ['cursor'] });
      assert.equal(r.status, 0, ev.tool_name);
      const d = decision(r);
      assert.equal(d?.permission, 'deny', `${ev.tool_name}: ${r.stdout}`);
      assert.ok(typeof d.user_message === 'string' && d.user_message.length > 0, `${ev.tool_name}: user_message`);
      assert.ok(!/ask|allow/.test(d.permission));
    }
    const ok = [
      { hook_event_name: 'preToolUse', cwd: P, tool_name: 'Write', tool_input: { file_path: join(P, 'src', 'a.js'), content: 'x' } },
      { hook_event_name: 'preToolUse', cwd: P, tool_name: 'Delete', tool_input: { file_path: join(P, 'src', 'a.js') } },
      { hook_event_name: 'preToolUse', cwd: P, tool_name: 'Shell', tool_input: { command: 'ls', cwd: P } },
    ];
    for (const ev of ok) {
      const r = feed(ev, { env, args: ['cursor'] });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '', `${ev.tool_name}: empty stdout`);
    }
  } finally { rmSync(S, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- pure helpers + parity

test('exports: PROTECTED, judgePath, bashTargets, denyReason, decide', async () => {
  const { S, HOME, P } = sandbox();
  try {
    const m = await import('../hooks/astro-canon-guard.mjs');
    assert.ok(Object.isFrozen(m.PROTECTED), 'PROTECTED is frozen');
    const names = m.PROTECTED.filter((e) => e.name).map((e) => e.name).sort();
    assert.deepEqual(names, [...PROTECTED_NAMES].sort());
    assert.equal(m.PROTECTED.filter((e) => e.store).length, 1, 'exactly one store entry');
    for (const e of m.PROTECTED) for (const k of ['verb', 'rule', 'source']) assert.ok(e[k], `entry has ${k}`);

    const env = { HOME };
    assert.equal(m.judgePath('src/a.js', P, env), null);
    assert.equal(m.judgePath('.astrocode/config.json', P, env), null);
    assert.equal(m.judgePath('.astrocode/state.json', P, env)?.name, 'state.json');
    assert.ok(m.judgePath(join(HOME, '.astro', 'principles', 'p-1.md'), P, env)?.store);

    const targets = m.bashTargets('echo x > .astrocode/state.json && ac status', P, env);
    assert.ok(targets.includes(join(P, '.astrocode', 'state.json')));
    assert.deepEqual(m.bashTargets('cat .astrocode/state.json', P, env), []);
    assert.deepEqual(m.bashTargets('ac phase add x', P, env), []);

    const entry = m.judgePath('.astrocode/ROADMAP.md', P, env);
    const reason = m.denyReason(entry, '.astrocode/ROADMAP.md');
    assert.ok(reason.includes('ac roadmap render'));
    assert.equal(reason.trim().split('\n').length, 2);

    const hit = m.decide(claudeEvent('Write', '.astrocode/state.json', P), { env });
    assert.ok(hit && hit.reason && hit.entry);
    assert.equal(m.decide(claudeEvent('Write', 'src/a.js', P), { env }), null);
    assert.equal(m.decide({ tool_name: 'FutureTool', tool_input: { file_path: '.astrocode/state.json' }, cwd: P }, { env }), null);
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('parity: the hook resolves the store dir exactly as lib/principles.mjs principlesDir does', async () => {
  const { S, HOME, P } = sandbox();
  try {
    const m = await import('../hooks/astro-canon-guard.mjs');
    const { principlesDir } = await import('../lib/principles.mjs');
    for (const env of [{ HOME }, { HOME, ASTRO_PRINCIPLES_DIR: join(S, 'alt') }]) {
      mkdirSync(principlesDir(env), { recursive: true });
      const inside = join(principlesDir(env), 'p-9.md');
      assert.ok(m.judgePath(inside, P, env)?.store, `inside ${principlesDir(env)}`);
      assert.equal(m.judgePath(join(dirname(principlesDir(env)), 'principles-notes.md'), P, env), null, 'sibling with the same name prefix');
    }
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('importing the hook module does not block on stdin or print anything', () => {
  assert.ok(existsSync(HOOK), 'hooks/astro-canon-guard.mjs exists');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(HOOK)}); console.log('imported');`], {
    encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'imported');
});
