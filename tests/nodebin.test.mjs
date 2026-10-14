// #126 — hook commands pinned a versioned Homebrew node (`.../Cellar/node/<v>/bin/node`) that
// `brew upgrade node` deletes, and `ac update` never repaired them (entries matched by script name).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeBin, repairNodeCommand } from '../lib/nodebin.mjs';
import { registerHooks } from '../lib/hosts/claude.mjs';

const scratch = (t) => { const d = mkdtempSync(join(tmpdir(), 'ac-nodebin-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('nodeBin prefers a PATH entry that is the same binary, else keeps execPath', (t) => {
  const d = scratch(t);
  const stable = join(d, 'stable');
  const other = join(d, 'other');
  mkdirSync(stable); mkdirSync(other);
  symlinkSync(process.execPath, join(stable, 'node'));
  writeFileSync(join(other, 'node'), '#!/bin/sh\n');
  assert.equal(nodeBin({ env: { PATH: `${other}:${stable}` } }), join(stable, 'node'));
  assert.equal(nodeBin({ env: { PATH: other } }), process.execPath);
  assert.equal(nodeBin({ env: {} }), process.execPath);
});

test('repairNodeCommand re-points only astro hook scripts run by a node binary', () => {
  const N = '/stable/bin/node';
  assert.equal(repairNodeCommand('"/old/Cellar/node/25.0.0/bin/node" "/h/hooks/astro-update.mjs"', N), `"${N}" "/h/hooks/astro-update.mjs"`);
  assert.equal(repairNodeCommand('/old/node /h/hooks/astro-principles.mjs 2/4', N), `"${N}" /h/hooks/astro-principles.mjs 2/4`);
  assert.equal(repairNodeCommand('"/old/node" "/f/hooks/astro-fleet-hook.mjs" --astro-fleet', N), `"${N}" "/f/hooks/astro-fleet-hook.mjs" --astro-fleet`);
  for (const mine of ['"/x/node" "/h/hooks/my-hook.mjs"', '"/usr/bin/python3" "/h/hooks/astro-x.mjs"', 'echo hi', `"${N}" "/h/hooks/astro-update.mjs"`]) {
    assert.equal(repairNodeCommand(mine, N), mine);
  }
});

test('registerHooks (what ac install/update run) repairs a dead node path in astro entries and leaves user entries alone', (t) => {
  const d = scratch(t);
  const dir = join(d, 'cfg');
  const home = join(d, 'astro');
  mkdirSync(dir); mkdirSync(join(home, 'hooks'), { recursive: true });
  const dead = '/home/linuxbrew/.linuxbrew/Cellar/node/25.0.0/bin/node';
  const userCmd = '"/opt/mine/node" "/opt/mine/hook.mjs"';
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [
    { hooks: [{ type: 'command', command: `"${dead}" "${join(home, 'hooks', 'astro-update.mjs')}"` }] },
    { hooks: [{ type: 'command', command: userCmd }] },
  ] } }));
  registerHooks(dir, home);
  registerHooks(dir, home);
  const text = readFileSync(join(dir, 'settings.json'), 'utf8');
  assert.ok(!text.includes(dead), 'no astro entry keeps the dead node');
  const cmds = JSON.parse(text).hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(cmds.includes(userCmd), 'the user entry is untouched');
  for (const c of cmds.filter((x) => x.includes(join(home, 'hooks')))) assert.ok(c.startsWith(`"${nodeBin()}" `), c);
  assert.equal(cmds.filter((c) => c.includes('astro-update.mjs')).length, 1, 'no duplicate entry');
});
