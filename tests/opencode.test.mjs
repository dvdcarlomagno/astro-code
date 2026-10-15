// OpenCode host adapter — rendering (pure) and install/uninstall (black-box, real CLI
// against a throwaway $HOME with a clean env, like install_cursor.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getHost } from '../lib/hosts/index.mjs';
import { parseFrontmatter } from '../lib/hosts/render.mjs';
import { resolveAgentModel, AGENT_ROLE } from '../lib/hosts/opencode.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');
const readCommand = (n) => readFileSync(join(FRAMEWORK, 'commands', `${n}.md`), 'utf8');
const readAgent = (n) => readFileSync(join(FRAMEWORK, 'agents', `${n}.md`), 'utf8');
const sourceNames = (kind) => readdirSync(join(FRAMEWORK, kind)).filter((f) => f.endsWith('.md')).sort();

function run(T, args, env = {}) {
  return spawnSync(process.execPath, [AC, ...args], {
    env: { HOME: T, PATH: '/usr/bin:/bin', ...env },
    encoding: 'utf8',
    timeout: 60000,
  });
}

function writeUserConfig(T, cfg) {
  mkdirSync(join(T, '.astro'), { recursive: true });
  writeFileSync(join(T, '.astro', 'config.json'), JSON.stringify(cfg));
}

// --- rendering -----------------------------------------------------------------

test('an OpenCode command keeps description + $ARGUMENTS, drops Claude-only keys, carries the tool note', () => {
  const [file] = getHost('opencode').renderCommand('astro-plan', readCommand('astro-plan'));
  assert.equal(file.path, 'astro-plan.md');
  const { frontmatter, body } = parseFrontmatter(file.content);
  assert.deepEqual(Object.keys(frontmatter), ['description']);
  assert.equal(frontmatter.description, parseFrontmatter(readCommand('astro-plan')).frontmatter.description);
  assert.match(body, /^> \*\*Running on OpenCode\.\*\*/);
  assert.match(body, /`subagent`/);
  assert.match(body, /`question`/);
  assert.ok(body.includes('$ARGUMENTS'), '$ARGUMENTS is left for OpenCode to substitute');
  assert.ok(body.endsWith(parseFrontmatter(readCommand('astro-plan')).body), 'source body verbatim');
});

test('an OpenCode agent is a subagent with no Claude-only keys and no model by default', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-r-'));
  const prev = process.env.HOME;
  process.env.HOME = T;
  try {
    const [file] = getHost('opencode').renderAgent('astro-executor', readAgent('astro-executor'));
    const { frontmatter, body } = parseFrontmatter(file.content);
    assert.equal(file.path, 'astro-executor.md');
    assert.deepEqual(frontmatter, { description: parseFrontmatter(readAgent('astro-executor')).frontmatter.description, mode: 'subagent' });
    assert.equal(body, parseFrontmatter(readAgent('astro-executor')).body);
  } finally {
    process.env.HOME = prev;
  }
});

test('every shipped agent has a role, so none silently misses the model mapping', () => {
  for (const f of sourceNames('agents')) assert.ok(AGENT_ROLE[f.slice(0, -3)], `${f} has no AGENT_ROLE entry`);
});

test('resolveAgentModel: user tier → opencode.models id; ids verbatim; inherit / unmapped → undefined', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-m-'));
  assert.equal(resolveAgentModel('astro-planner', T), undefined, 'no config → inherit');
  writeUserConfig(T, {
    models: { planner: 'opus', researcher: 'sonnet', executor: 'haiku', verifier: 'inherit' },
    opencode: { models: { opus: 'p/opus-x', haiku: 'p/haiku-x' } },
  });
  assert.equal(resolveAgentModel('astro-planner', T), 'p/opus-x');
  assert.equal(resolveAgentModel('astro-criteria-author', T), 'p/opus-x', 'criteria-author runs at the planner tier');
  assert.equal(resolveAgentModel('astro-executor', T), 'p/haiku-x');
  assert.equal(resolveAgentModel('astro-researcher', T), undefined, 'tier with no mapping → inherit');
  assert.equal(resolveAgentModel('astro-verifier', T), undefined, 'inherit → no model');
  writeUserConfig(T, { models: { executor: 'openrouter/x/y' } });
  assert.equal(resolveAgentModel('astro-executor', T), 'openrouter/x/y', 'a provider id is used verbatim');
});

// --- install / uninstall -------------------------------------------------------

test('OpenCode-only home: install publishes every command and agent as plain files', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-i-'));
  mkdirSync(join(T, '.config', 'opencode'), { recursive: true });
  const res = run(T, ['install']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /OpenCode/);
  for (const kind of ['commands', 'agents']) {
    const dir = join(T, '.config', 'opencode', kind);
    assert.deepEqual(readdirSync(dir).sort(), sourceNames(kind));
    for (const f of readdirSync(dir)) assert.ok(!lstatSync(join(dir, f)).isSymbolicLink(), `${kind}/${f} must be a regular file`);
  }
  assert.ok(!existsSync(join(T, '.claude', 'commands')), 'no Claude dir invented when OpenCode is present');
});

test('install stamps agents with the user mapping; OPENCODE_CONFIG_DIR is honoured', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-c-'));
  const cfgDir = join(T, 'oc');
  mkdirSync(cfgDir, { recursive: true });
  writeUserConfig(T, { models: { executor: 'haiku' }, opencode: { models: { haiku: 'prov/haiku-9' } } });
  const res = run(T, ['install'], { OPENCODE_CONFIG_DIR: cfgDir });
  assert.equal(res.status, 0, res.stderr);
  const exec = parseFrontmatter(readFileSync(join(cfgDir, 'agents', 'astro-executor.md'), 'utf8')).frontmatter;
  assert.equal(exec.model, 'prov/haiku-9');
  const plan = parseFrontmatter(readFileSync(join(cfgDir, 'agents', 'astro-planner.md'), 'utf8')).frontmatter;
  assert.equal(plan.model, undefined);
});

test('uninstall removes only astro-* entries and leaves the user\'s own files', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-u-'));
  const oc = join(T, '.config', 'opencode');
  mkdirSync(join(oc, 'commands'), { recursive: true });
  writeFileSync(join(oc, 'commands', 'mine.md'), 'keep me');
  assert.equal(run(T, ['install']).status, 0);
  const res = run(T, ['uninstall']);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(readdirSync(join(oc, 'commands')), ['mine.md']);
  assert.deepEqual(readdirSync(join(oc, 'agents')), []);
});
