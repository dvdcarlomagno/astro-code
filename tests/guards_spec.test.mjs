// The guard registration spec and the one ownership rule (phase 37 t3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_HOOKS, GUARD_SCRIPTS, guardCommand, ownsCommand } from '../lib/hosts/guards.mjs';

const S = 'astro-canon-guard.mjs';

test('canon-guard spec names its script, events and matchers', () => {
  const g = GUARD_HOOKS['canon-guard'];
  assert.equal(g.script, S);
  assert.equal(g.claude.event, 'PreToolUse');
  for (const t of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']) assert.ok(g.claude.matcher.split('|').includes(t), t);
  assert.equal(g.cursor.event, 'preToolUse');
  assert.equal(g.cursor.arg, 'cursor');
  assert.deepEqual([...GUARD_SCRIPTS], [S]);
  assert.ok(Object.isFrozen(GUARD_HOOKS));
});

test('guardCommand quotes both paths and appends the arg', () => {
  const spec = GUARD_HOOKS['canon-guard'];
  const c = guardCommand('/h/with space', spec);
  assert.equal(c, `"${process.execPath}" "/h/with space/hooks/${S}"`);
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
