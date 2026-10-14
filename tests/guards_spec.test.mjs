// The guard registration spec and the one ownership rule (phase 37 t3).
import { nodeBin } from '../lib/nodebin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_HOOKS, GUARD_SCRIPTS, guardCommand, ownsCommand } from '../lib/hosts/guards.mjs';

const S = 'astro-canon-guard.mjs';
const G = 'astro-git-guard.mjs';

test('canon-guard spec names its script, events and matchers', () => {
  const g = GUARD_HOOKS['canon-guard'];
  assert.equal(g.script, S);
  assert.equal(g.claude.event, 'PreToolUse');
  for (const t of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']) assert.ok(g.claude.matcher.split('|').includes(t), t);
  assert.equal(g.cursor.event, 'preToolUse');
  assert.equal(g.cursor.arg, 'cursor');
  assert.equal(g.claude.verdict, 'deny');
  assert.equal(g.cursor.verdict, 'deny');
  assert.ok(Object.isFrozen(GUARD_HOOKS));
});

test('guardCommand quotes both paths and appends the arg', () => {
  const spec = GUARD_HOOKS['canon-guard'];
  const c = guardCommand('/h/with space', spec);
  assert.equal(c, `"${nodeBin()}" "/h/with space/hooks/${S}"`);
  assert.ok(guardCommand('/h', spec, 'cursor').endsWith(`${S}" cursor`));
});

test('ownsCommand matches by script filename, not install path', () => {
  assert.ok(ownsCommand(`"/usr/bin/node" "/a/b/hooks/${S}"`, S));
  assert.ok(ownsCommand(`node /old/place/hooks/${S}`, S));
  assert.ok(ownsCommand(`'node' '/x y/hooks/${S}'`, S));
  assert.ok(!ownsCommand(`node /h/hooks/my-${S}.bak`, S));
  assert.ok(!ownsCommand('echo mine', S));
  assert.ok(!ownsCommand(undefined, S));
});

test('ownsCommand with an arg requires the last token to equal it', () => {
  assert.ok(ownsCommand('node /h/hooks/astro-principles.mjs 2/3', 'astro-principles.mjs', '2/3'));
  assert.ok(!ownsCommand('node /h/hooks/astro-principles.mjs 3/3', 'astro-principles.mjs', '2/3'));
  assert.ok(ownsCommand(`node /h/hooks/${S} cursor`, S, 'cursor'));
  assert.ok(!ownsCommand(`node /h/hooks/${S}`, S, 'cursor'));
});

test('git-guard spec: script, events, matchers and the per-host verdict', () => {
  const g = GUARD_HOOKS['git-guard'];
  assert.equal(g.script, G);
  assert.equal(g.claude.event, 'PreToolUse');
  assert.equal(g.claude.matcher, 'Bash');
  assert.equal(g.claude.verdict, 'ask');
  assert.equal(g.cursor.event, 'preToolUse');
  assert.equal(g.cursor.matcher, 'Shell');
  assert.equal(g.cursor.arg, 'cursor');
  assert.equal(g.cursor.verdict, 'deny');
  assert.ok(Object.isFrozen(g) && Object.isFrozen(g.claude) && Object.isFrozen(g.cursor));
  assert.deepEqual([...GUARD_SCRIPTS], [S, G]);
});

test('ownsCommand never confuses the two guard scripts', () => {
  assert.ok(!ownsCommand(`node /h/hooks/${G}`, S));
  assert.ok(!ownsCommand(`node /h/hooks/${S}`, G));
  assert.ok(ownsCommand(`node /h/hooks/${G} cursor`, G, 'cursor'));
});
