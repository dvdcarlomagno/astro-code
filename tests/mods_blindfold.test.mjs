// Phase 39 — the blindfold mod: `astro-verifier` and `astro-criteria-author` are denied the plan
// files ADR-021 keeps from them, enforced per agent through the astro-mods plugin's hooks.
// RED first (ADR-018): the engine is the shared simulator (fixtures/mods_engine.mjs) driving the
// plugin through `register()`, and the blindfold module arrives only through
// `await import(...)` inside the test bodies, so a missing hook or module fails each test on its
// own instead of crashing the file at load.
//
// The agent join is source-agnostic here (`identify`): it fires `agent.spawn` the way PROBE.md
// records it for each spawn path AND lists the agent, so an implementation built on either
// source resolves it. DENIED means the plugin's own `deny` -- never `ask`. ALLOWED means the
// result IS what the engine beneath answered (BENEATH, by identity): a plugin that answered its
// own `allow` would override the user's permission rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boot, answer, switches, SESSION_START, BENEATH } from './fixtures/mods_engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = '/work/proj';
const D = `${P}/.astrocode/phases/39-x`;
const PATHS = ['workflow', 'agent-tool'];
const VERIFIER = 'astro-verifier';
const AUTHOR = 'astro-criteria-author';
const blindfold = () => import('../mods/astro-mods/hooks/features/blindfold.js');

let serial = 0;
/** Spawn `role` the way PROBE.md records it for `path`, and list it; resolves its agentId. */
async function identify(eng, role, path, agentId = `a${(++serial).toString(16).padStart(16, '0')}`) {
  const e = {
    tool_use_id: path === 'workflow' ? 'toolu_workflow_call' : `toolu_${agentId}`,
    prompt: 'p', description: 'd', subagentType: role,
    provider: { plugin: 'user', tier: 'user' }, parentModel: 'claude-opus-5-5[1m]',
    permissionMode: 'bypassPermissions', background: false, fork: false,
    ...(path === 'workflow' ? { workflow: { runId: 'wf_x', agentIndex: 1 } } : {}),
  };
  const listed = await eng.currentAgents();
  eng.setAgents([...listed, { id: agentId, type: role, description: '', status: 'running' }]);
  await eng.invoke('agent.spawn', e, { beneath: { model: 'opus', agentId } });
  return agentId;
}

async function armed({ on = true } = {}) {
  const eng = await boot(answer(switches({ blindfold: on })));
  let agents = [];
  eng.currentAgents = async () => agents;
  const set = eng.setAgents;
  eng.setAgents = (list) => { agents = list; set(list); };
  await eng.invoke('session.start', { ...SESSION_START });
  eng.setCwd(P);
  eng.setExists((p) => p === `${P}/.astrocode/phases`);
  return eng;
}

const check = (eng, agentId, tool, input) => eng.invoke('tool.check', { tool, input, tool_use_id: 'toolu_c', ...(agentId ? { agentId } : {}) });
const read = (eng, id, file_path, tool = 'Read') => check(eng, id, tool, tool === 'NotebookRead' ? { notebook_path: file_path } : { file_path });
const bash = (eng, id, command) => check(eng, id, 'Bash', { command });
const denied = (r) => !!r && r.decision === 'deny';
const allowed = (r) => r === BENEATH;

function expectRows(rows, results, label) {
  rows.forEach((row, i) => {
    const [want, what] = row;
    const ok = want === 'deny' ? denied(results[i]) : allowed(results[i]);
    assert.ok(ok, `${label}: ${what} should be ${want === 'deny' ? 'DENIED' : 'ALLOWED'}, got ${JSON.stringify(results[i])}`);
  });
}

// ── C3: Read, per role ──────────────────────────────────────────────────────

const VERIFIER_READS = [
  ['deny', `${D}/PLAN.md`], ['deny', `${D}/SPEC.md`], ['deny', `${P}/.astrocode/phases/07-other/plan.md`],
  ['deny', `${D}/Plan.MD`], ['deny', '.astrocode/phases/39-x/PLAN.md'], ['deny', 'C:\\work\\proj\\.astrocode\\phases\\39-x\\PLAN.md'],
  ['deny', `${P}/.astrocode/phases/39-x/../39-x/PLAN.md`],
  ['allow', `${D}/ACCEPTANCE.md`],
];
const AUTHOR_READS = [
  ['deny', `${D}/PLAN.md`], ['deny', `${D}/ACCEPTANCE.md`], ['deny', `${D}/SPEC.md`],
  ['deny', `${D}/Acceptance.MD`], ['deny', `${D}/spec.md`], ['deny', `${P}/.astrocode/phases/07-other/plan.md`],
];

for (const path of PATHS) {
  test(`${path}: the verifier is denied PLAN.md and SPEC.md in any phase dir and case, and may read ACCEPTANCE.md`, async () => {
    const eng = await armed();
    const id = await identify(eng, VERIFIER, path);
    const results = [];
    for (const [, file] of VERIFIER_READS) results.push(await read(eng, id, file));
    expectRows(VERIFIER_READS.map(([w, f]) => [w, `Read ${f}`]), results, 'verifier');
    assert.ok(denied(await read(eng, id, `${D}/PLAN.md`, 'NotebookRead')), 'NotebookRead of PLAN.md');
    assert.ok(denied(await check(eng, id, 'NotebookEdit', { notebook_path: `${D}/PLAN.md` })), 'a notebook_path is judged whatever the tool');
    assert.ok(denied(await check(eng, id, 'Edit', { file_path: `${D}/PLAN.md` })), 'Edit of PLAN.md');
  });

  test(`${path}: the criteria-author is denied PLAN.md, ACCEPTANCE.md and SPEC.md, mixed case included`, async () => {
    const eng = await armed();
    const id = await identify(eng, AUTHOR, path);
    const results = [];
    for (const [, file] of AUTHOR_READS) results.push(await read(eng, id, file));
    expectRows(AUTHOR_READS.map(([w, f]) => [w, `Read ${f}`]), results, 'criteria-author');
  });

  test(`${path}: a deny quotes ADR-021 and the agent's own rule, names the file and CRITERIA.md, and never names an escape`, async () => {
    const { RULE } = await blindfold();
    for (const role of [VERIFIER, AUTHOR]) {
      const eng = await armed();
      const id = await identify(eng, role, path);
      const r = await read(eng, id, `${D}/PLAN.md`);
      assert.equal(r && r.decision, 'deny');
      assert.match(r.reason, /ADR-021/);
      assert.ok(r.reason.includes(RULE[role]), `${role}: reason carries its own rule`);
      assert.match(r.reason, /PLAN\.md/);
      assert.match(r.reason, /CRITERIA\.md/);
      assert.doesNotMatch(r.reason, /ac mods|disable/i);
      assert.ok(r.reason.split('\n').length <= 4, 'at most four lines');
    }
  });
}

// ── C4: Bash ────────────────────────────────────────────────────────────────

const CMD_DENIED = [
  'cat .astrocode/phases/39-x/PLAN.md',
  'head -n 5 "$P/.astrocode/phases/39-x/SPEC.md"',
  'grep -n foo .astrocode/phases/39-x/PLAN.md',
  'sed -n 1p .astrocode/phases/39-x/plan.md',
  'cp .astrocode/phases/39-x/PLAN.md /tmp/x',
  'rg TODO .astrocode/phases',
  'grep -r foo .astrocode/phases/39-x',
  'cd .astrocode/phases/39-x && cat PLAN.md',
  'cd .astrocode/phases/39-x && cat ./PLAN.md',
  'cd /work/proj/.astrocode/phases/39-x && head ./SPEC.md',
  'cd .astrocode/phases && cat 39-x/PLAN.md',
  'cd .astrocode && cat phases/39-x/SPEC.md',
  'git show HEAD:.astrocode/phases/39-x/PLAN.md',
  "bash -c 'cat .astrocode/phases/39-x/SPEC.md'",
  "/usr/local/bin/lean-ctx -c 'cat .astrocode/phases/39-x/PLAN.md'",
  'FOO=1 env cat .astrocode/phases/39-x/PLAN.md',
  'ls src; cat .astrocode/phases/39-x/PLAN.md',
  // Phase 39 verify: a recursive-search root or a file operand relative to an earlier cd, and a
  // phase path carried in a variable, reached the plan while allowed.
  'cd .astrocode/phases; grep -r foo 39-x',
  'cd .astrocode/phases && rg TODO 39-x',
  'cd .astrocode && rg TODO phases',
  'cd /work/proj/.astrocode && rg TODO phases',
  'cd .astrocode && grep -rn foo phases/39-x',
  'cd -- .astrocode/phases && cat 39-x/PLAN.md',
  'D=.astrocode/phases/39-x; cat $D/PLAN.md',
  // Phase 39, second verify: the project root spelled as an expansion, git -C as a cd for its own
  // operands, and a raw plan path inside an interpreter string.
  'grep -r foo "$PWD"', 'grep -rn foo ${PWD}', 'rg -n TODO "$PWD"', 'grep -r foo -- "$PWD"', 'grep -r foo "$PWD/"',
  'grep -rn foo "$(git rev-parse --show-toplevel)"', 'cd "$(git rev-parse --show-toplevel)" && grep -r foo .',
  'git -C .astrocode/phases/39-x show HEAD:./PLAN.md',
  `node -e "console.log(require('fs').readFileSync('.astrocode/phases/39-x/PLAN.md','utf8'))"`,
  `python3 -c "print(open('.astrocode/phases/39-x/SPEC.md').read())"`,
  'rg -g "!.astrocode/nothing" TODO', 'rg -t all TODO', 'rg --type all TODO .astrocode',
];
const CMD_ALLOWED = [
  'node --test tests/', 'cat .astrocode/phases/39-x/CRITERIA.md', 'git log --oneline -5', 'ls src',
  'cat docs/PLAN.md', 'cd src && cat ./PLAN.md', 'find . -maxdepth 1 -type f', 'cat .astrocode/phases/39-x/PLAN.md.orig', 'cd .astrocode/phases/39-x && cat ./CRITERIA.md', 'grep -rn foo src', 'cat .astrocode/PROJECT.md',
];

for (const path of PATHS) {
  test(`${path}: the verifier cannot reach PLAN.md or SPEC.md through the shell, and ordinary shell work is untouched`, async () => {
    const eng = await armed();
    const id = await identify(eng, VERIFIER, path);
    const rows = [...CMD_DENIED.map((c) => ['deny', c]), ...CMD_ALLOWED.map((c) => ['allow', c]), ['allow', 'cat .astrocode/phases/39-x/ACCEPTANCE.md']];
    const results = [];
    for (const [, c] of rows) results.push(await bash(eng, id, c));
    expectRows(rows, results, 'verifier Bash');
  });

  test(`${path}: the criteria-author is denied the same set plus ACCEPTANCE.md`, async () => {
    const eng = await armed();
    const id = await identify(eng, AUTHOR, path);
    const rows = [...CMD_DENIED.map((c) => ['deny', c]), ['deny', 'cat .astrocode/phases/39-x/ACCEPTANCE.md'], ...CMD_ALLOWED.map((c) => ['allow', c])];
    const results = [];
    for (const [, c] of rows) results.push(await bash(eng, id, c));
    expectRows(rows, results, 'criteria-author Bash');
  });
}

// ── C5: Grep and Glob ───────────────────────────────────────────────────────

for (const path of PATHS) {
  test(`${path}: a broad Grep or Glob over the phases tree is denied, a narrowed one is allowed`, async () => {
    const eng = await armed();
    const id = await identify(eng, VERIFIER, path);
    const rows = [
      ['deny', 'Grep path=phase dir', 'Grep', { pattern: 'x', path: D }],
      ['deny', 'Grep path=.astrocode/phases', 'Grep', { pattern: 'x', path: `${P}/.astrocode/phases` }],
      ['deny', 'Grep path=.astrocode', 'Grep', { pattern: 'x', path: `${P}/.astrocode` }],
      ['deny', 'Grep path=parent', 'Grep', { pattern: 'x', path: P }],
      ['deny', 'Grep with no path', 'Grep', { pattern: 'x' }],
      ['deny', 'Glob **/*.md under the phases dir', 'Glob', { pattern: '**/*.md', path: `${P}/.astrocode/phases` }],
      ['deny', 'Glob **/* with no path', 'Glob', { pattern: '**/*' }],
      ['allow', 'Grep path=CRITERIA.md', 'Grep', { pattern: 'x', path: `${D}/CRITERIA.md` }],
      ['allow', 'Grep over src', 'Grep', { pattern: 'x', path: `${P}/src` }],
      ['allow', 'Grep glob *.mjs over the project', 'Grep', { pattern: 'x', path: P, glob: '*.mjs' }],
      ['allow', 'Glob src/**/*.js', 'Glob', { pattern: 'src/**/*.js' }],
      ['allow', 'Glob .astrocode/phases/*/CRITERIA.md', 'Glob', { pattern: '.astrocode/phases/*/CRITERIA.md' }],
      // Phase 39 verify: a glob aimed at the phases tree is not a narrowing (rg --hidden --glob
      // really returned PLAN.md for each of these).
      ['deny', 'Grep glob .astrocode/phases/*/PLAN.md', 'Grep', { pattern: 'x', path: P, glob: '.astrocode/phases/*/PLAN.md' }],
      ['deny', 'Grep glob **/39-x/*', 'Grep', { pattern: 'x', path: P, glob: '**/39-x/*' }],
      ['deny', 'Grep glob **/phases/**/*.md', 'Grep', { pattern: 'x', path: P, glob: '**/phases/**/*.md' }],
      ['deny', 'Grep glob .astrocode/**', 'Grep', { pattern: 'x', path: P, glob: '.astrocode/**' }],
      ['deny', 'Grep phases root, glob 39-x/*', 'Grep', { pattern: 'x', path: `${P}/.astrocode/phases`, glob: '39-x/*' }],
      ['deny', 'Glob **/39-x/*', 'Glob', { pattern: '**/39-x/*' }],
      ['deny', 'Glob 39-x/* under phases', 'Glob', { pattern: '39-x/*', path: `${P}/.astrocode/phases` }],
      ['allow', 'Grep glob src/**/*.md over the project', 'Grep', { pattern: 'x', path: P, glob: 'src/**/*.md' }],
      // Phase 39 third verify: how Claude's Grep hands globs to rg (split on whitespace and commas
      // outside braces, --glob overriding --type, a leading / anchored at the root, negation-only
      // lists including everything else). Real rg returned PLAN.md for each.
      ['deny', 'Grep glob {**/PLAN.md,x}', 'Grep', { pattern: 'x', path: P, glob: '{**/PLAN.md,x}' }],
      ['deny', 'Grep glob {phases plan,src}', 'Grep', { pattern: 'x', path: P, glob: '{.astrocode/phases/*/PLAN.md,src/*.js}' }],
      ['deny', 'Grep glob /.astrocode/**', 'Grep', { pattern: 'x', path: P, glob: '/.astrocode/**' }],
      ['deny', 'Grep glob list (space)', 'Grep', { pattern: 'x', path: P, glob: 'src/*.js .astrocode/phases/*/PLAN.md' }],
      ['deny', 'Grep glob list (comma)', 'Grep', { pattern: 'x', path: P, glob: 'src/*.js,.astrocode/phases/*/PLAN.md' }],
      ['deny', 'Grep glob !src/**', 'Grep', { pattern: 'x', path: P, glob: '!src/**' }],
      ['deny', 'Grep glob !*.js', 'Grep', { pattern: 'x', path: P, glob: '!*.js' }],
      ['deny', 'Grep type js + glob *.md', 'Grep', { pattern: 'x', path: P, type: 'js', glob: '*.md' }],
      ['deny', 'Grep phases type js + glob *.md', 'Grep', { pattern: 'x', path: `${P}/.astrocode/phases`, type: 'js', glob: '*.md' }],
      ['deny', 'Grep phases glob !*.js', 'Grep', { pattern: 'x', path: `${P}/.astrocode/phases`, glob: '!*.js' }],
      ['deny', 'Glob {**/PLAN.md,x}', 'Glob', { pattern: '{**/PLAN.md,x}' }],
      ['deny', 'Glob {phases plan,src}', 'Glob', { pattern: '{.astrocode/phases/*/PLAN.md,src/*.js}' }],
      ['allow', 'Grep glob list of code only', 'Grep', { pattern: 'x', path: P, glob: 'src/*.js,lib/*.mjs' }],
      // A slashed negation is anchored at the search root, so only the **/-led form is provable.
      ['deny', 'Grep glob !.astrocode/** (anchored)', 'Grep', { pattern: 'x', path: P, glob: '!.astrocode/**' }],
      ['allow', 'Grep glob !**/.astrocode/**', 'Grep', { pattern: 'x', path: P, glob: '!**/.astrocode/**' }],
      // Phase 39 fourth verify: narrowing must be provable. A negation that merely mentions the
      // tree, rg's type 'all', and a glob led in through the project folder from a root above it.
      ['deny', 'Grep type all', 'Grep', { pattern: 'x', path: P, type: 'all' }],
      ['deny', 'Grep glob !…/CRITERIA.md', 'Grep', { pattern: 'x', path: P, glob: '!.astrocode/phases/39-x/CRITERIA.md' }],
      ['deny', 'Grep glob !**/phases/zzz/**', 'Grep', { pattern: 'x', path: P, glob: '!**/phases/zzz/**' }],
      ['deny', 'Grep glob !.astrocode/nothing', 'Grep', { pattern: 'x', path: P, glob: '!.astrocode/nothing' }],
      ['deny', 'Grep parent root glob proj/.astrocode/phases/*/PLAN.md', 'Grep', { pattern: 'x', path: '/work', glob: 'proj/.astrocode/phases/*/PLAN.md' }],
      ['deny', 'Grep parent root glob proj/**', 'Grep', { pattern: 'x', path: '/work', glob: 'proj/**' }],
      ['deny', 'Glob parent root proj/**', 'Glob', { pattern: 'proj/**', path: '/work' }],
      ['deny', 'Glob parent root proj/.astrocode/**/PLAN.md', 'Glob', { pattern: 'proj/.astrocode/**/PLAN.md', path: '/work' }],
      ['deny', 'Glob !.astrocode/nothing', 'Glob', { pattern: '!.astrocode/nothing' }],
      ['deny', 'Grep type js + glob !*.js', 'Grep', { pattern: 'x', path: P, glob: '!*.js', type: 'js' }],
      ['allow', 'Grep type js', 'Grep', { pattern: 'x', path: P, type: 'js' }],
      // rg globs are case-sensitive: !**/*.md does not exclude PLAN.MD, so a name negation proves nothing.
      ['deny', 'Grep glob !**/*.md', 'Grep', { pattern: 'x', path: P, glob: '!**/*.md' }],
      // Phase 39 fifth verify: case-variant and anchored negations, unnormalised absolute Globs, ~.
      ['deny', 'Grep glob !{plan,spec}.md', 'Grep', { pattern: 'x', path: P, glob: '!{plan,spec}.md' }],
      ['deny', 'Grep glob !*.MD', 'Grep', { pattern: 'x', path: P, glob: '!*.MD' }],
      ['deny', 'Grep glob !.ASTROCODE/**', 'Grep', { pattern: 'x', path: P, glob: '!.ASTROCODE/**' }],
      ['deny', 'Grep glob !PHASES', 'Grep', { pattern: 'x', path: P, glob: '!PHASES' }],
      ['deny', 'Grep glob !phases/**', 'Grep', { pattern: 'x', path: P, glob: '!phases/**' }],
      ['deny', 'Grep parent root glob !.astrocode/**', 'Grep', { pattern: 'x', path: '/work', glob: '!.astrocode/**' }],
      ['deny', 'Grep parent root glob !/.astrocode/**', 'Grep', { pattern: 'x', path: '/work', glob: '!/.astrocode/**' }],
      ['deny', 'Glob /work/proj/./**/*.md', 'Glob', { pattern: '/work/proj/./**/*.md' }],
      ['deny', 'Glob /work/../work/proj/**/*.md', 'Glob', { pattern: '/work/../work/proj/**/*.md' }],
      ['deny', 'Glob /work/proj/src/../**/PLAN.md', 'Glob', { pattern: '/work/proj/src/../**/PLAN.md' }],
      ['deny', 'Grep path ~', 'Grep', { pattern: 'x', path: '~' }],
      ['deny', 'Grep path ~/proj', 'Grep', { pattern: 'x', path: '~/proj' }],
      ['deny', 'Glob path ~/proj', 'Glob', { pattern: '**/*.md', path: '~/proj' }],
      ['deny', 'Glob pattern ~/proj/**/PLAN.md', 'Glob', { pattern: '~/proj/**/PLAN.md' }],
    ];
    const results = [];
    for (const [, , tool, input] of rows) results.push(await check(eng, id, tool, input));
    expectRows(rows.map(([w, what]) => [w, what]), results, 'search');
  });
}

// ── C6: only the two roles ──────────────────────────────────────────────────

for (const path of PATHS) {
  test(`${path}: allowed files stay readable for both roles, including a PLAN.md outside a phase dir`, async () => {
    for (const role of [VERIFIER, AUTHOR]) {
      const eng = await armed();
      const id = await identify(eng, role, path);
      const files = [`${D}/CRITERIA.md`, `${D}/CONTEXT.md`, `${P}/.astrocode/PROJECT.md`, `${P}/.astrocode/CONVENTIONS.md`, `${P}/src/a.js`, `${P}/docs/PLAN.md`];
      for (const f of files) assert.ok(allowed(await read(eng, id, f)), `${role} may read ${f}`);
    }
  });

  test(`${path}: executors, planners, researchers, workflow agents, other types and the main loop read the plan freely`, async () => {
    const eng = await armed();
    for (const role of ['astro-executor', 'astro-planner', 'astro-researcher', 'workflow-subagent', 'general-purpose']) {
      const id = await identify(eng, role, path);
      assert.ok(allowed(await read(eng, id, `${D}/PLAN.md`)), `${role} reads PLAN.md`);
      assert.ok(allowed(await bash(eng, id, 'cat .astrocode/phases/39-x/PLAN.md')), `${role} cats PLAN.md`);
    }
    eng.listCalls.length = 0;
    assert.ok(allowed(await read(eng, undefined, `${D}/PLAN.md`)), 'the main loop reads PLAN.md');
    assert.ok(allowed(await bash(eng, undefined, 'cat .astrocode/phases/39-x/SPEC.md')));
    assert.equal(eng.listCalls.length, 0, 'the main loop never costs a lookup');
  });
}

// ── C7: off means off, and no state of the plugin's own ────────────────────

test('with the switch off every denied case is allowed, the join source is never consulted, and agent.spawn passes by identity', async () => {
  for (const path of PATHS) {
    const eng = await armed({ on: false });
    const spawnResult = { model: 'opus', agentId: 'a1' };
    const spawn = { subagentType: VERIFIER, prompt: 'p', tool_use_id: 't', ...(path === 'workflow' ? { workflow: { runId: 'w', agentIndex: 1 } } : {}) };
    const out = await eng.invoke('agent.spawn', spawn, { beneath: spawnResult });
    assert.equal(out, spawnResult, 'agent.spawn returns next(e)\'s value by identity');
    eng.setAgents([{ id: 'a1', type: VERIFIER, description: '', status: 'running' }]);
    eng.listCalls.length = 0;
    for (const f of VERIFIER_READS.filter(([w]) => w === 'deny').map(([, f]) => f)) assert.ok(allowed(await read(eng, 'a1', f)), `Read ${f}`);
    for (const c of CMD_DENIED) assert.ok(allowed(await bash(eng, 'a1', c)), c);
    assert.ok(allowed(await check(eng, 'a1', 'Grep', { pattern: 'x', path: `${P}/.astrocode/phases` })));
    assert.ok(allowed(await check(eng, 'a1', 'Glob', { pattern: '**/*.md', path: `${P}/.astrocode/phases` })));
    assert.equal(eng.listCalls.length, 0, 'the join source is never consulted');
  }
});

test('blindfold writes no file and reads nothing from disk: it asks the engine, in memory', async () => {
  const src = readFileSync(join(ROOT, 'mods', 'astro-mods', 'hooks', 'features', 'blindfold.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\$\.fs\.(write|read|append|mkdir|remove|delete)/);
  assert.doesNotMatch(src, /\bfrom 'node:|\brequire\(/, 'no Node module: all string logic');
});

// ── C8: a guard that cannot identify the agent lets the action through ──────

const VARIANTS = {
  throw: { list: () => Promise.reject(new Error('list blew up')), spawn: () => Promise.reject(new Error('next blew up')), toasts: 1 },
  hang: { list: () => new Promise(() => {}), spawn: () => new Promise(() => {}), toasts: 1 },
  'no entry': { list: () => Promise.resolve([]), spawn: { model: 'opus' }, toasts: 0 },
};
for (const [name, v] of Object.entries(VARIANTS)) {
  test(`when the join ${name}s: every PLAN.md read is allowed within bounded time, no rejection escapes, and the notice is at most once`.replace('no entrys', 'has no entry'), async () => {
    const eng = await armed();
    eng.setAgents(v.list);
    await eng.invoke('agent.spawn', { subagentType: VERIFIER, prompt: 'p', tool_use_id: 't' }, { beneath: v.spawn, budgetMs: 1000 });
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const r = await read(eng, 'a-unknown', `${D}/PLAN.md`);
      assert.ok(allowed(r), `call ${i + 1} is allowed, got ${JSON.stringify(r)}`);
      assert.ok(Date.now() - t0 < 5000, 'bounded time');
    }
    if (v.toasts === 0) assert.equal(eng.toasts.length, 0, 'no entry is the normal case: no notice');
    else {
      assert.ok(eng.toasts.length <= 1, `at most one notice, got ${JSON.stringify(eng.toasts)}`);
      assert.match(eng.toasts.join(''), /astro-mods/);
    }
  });
}

// ── one table, quoted from the agents ───────────────────────────────────────

test('FORBIDDEN is the one table of forbidden files, and each RULE is a verbatim line of its agent file', async () => {
  const { FORBIDDEN, RULE } = await blindfold();
  assert.deepEqual(FORBIDDEN, { 'astro-verifier': ['plan.md', 'spec.md'], 'astro-criteria-author': ['plan.md', 'acceptance.md', 'spec.md'] });
  assert.ok(Object.isFrozen(FORBIDDEN) && Object.isFrozen(RULE));
  for (const [role, file] of [[VERIFIER, 'astro-verifier.md'], [AUTHOR, 'astro-criteria-author.md']]) {
    const text = readFileSync(join(ROOT, 'agents', file), 'utf8');
    assert.ok(text.includes(RULE[role]), `${file} no longer contains: ${RULE[role]}`);
    assert.doesNotMatch(text, /blindfold|\bac mods\b/, `${file} must not depend on the mod (ADR-071 b)`);
  }
});
