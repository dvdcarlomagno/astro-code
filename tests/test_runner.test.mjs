// #131 — `npm test` (scripts/test.mjs) leaves nothing in TMPDIR, whatever the tests leak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('scripts/test.mjs runs node --test in a fresh TMPDIR and removes it, passing the exit code through', (t) => {
  const outer = mkdtempSync(join(tmpdir(), 'ac-runner-'));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  const env = { ...process.env, TMPDIR: outer };
  delete env.NODE_TEST_CONTEXT; // let the child run its own tests, not report into ours
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'test.mjs'), join(ROOT, 'tests', 'fixtures', 'leaky-tmp.mjs')], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /pass 1/);
  assert.deepEqual(readdirSync(outer), [], 'nothing is left in TMPDIR');
  const bad = spawnSync(process.execPath, [join(ROOT, 'scripts', 'test.mjs'), join(ROOT, 'tests', 'fixtures', 'no-such-file.mjs')], { cwd: ROOT, env, encoding: 'utf8' });
  assert.notEqual(bad.status, 0, 'a failing run fails');
  assert.deepEqual(readdirSync(outer), [], 'and still leaves nothing');
});
