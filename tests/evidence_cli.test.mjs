// Phase 46 (ADR-081): `--evidence "<id or URL>"` on the three human gates cites a decision made
// elsewhere. It is stored beside the record in its own field and never changes who signed.
// These run the real `ac` against a real temp project (HOME pointed at a temp dir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, setPhaseStatus, loadRoadmap } from '../lib/roadmap.mjs';
import { addFix } from '../lib/fixes.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const HOME = mkdtempSync(join(tmpdir(), 'ac-evhome-'));
const run = (args, cwd) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME } });
const NOW = new Date('2026-10-01T08:00:00.000Z');

async function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-evcli-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  initPlanning(dir, { name: 'evproj' });
  await addPhase(dir, { number: 1, name: 'alpha', milestone: 1 });
  const slug = loadRoadmap(dir).phases[0].slug;
  await setPhaseStatus(dir, slug, 'verified');
  const fix = await addFix(dir, { title: 'foo', now: NOW });
  return { dir, fix };
}
const show = (dir) => JSON.parse(run(['phase', 'show', '1', '--json'], dir).stdout);
const oneLineError = (r) => {
  assert.notEqual(r.status, 0);
  const lines = r.stderr.trim().split('\n');
  assert.equal(lines.length, 1, r.stderr);
  assert.ok(lines[0].startsWith('✖'), r.stderr);
};

test('C1: phase accept --agent --evidence stores the citation beside an agent signer', async () => {
  const { dir } = await project();
  const r = run(['phase', 'accept', '1', '--agent', 'claude', '--evidence', 'https://board.example/d/42'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(cites: https:\/\/board\.example\/d\/42\)/);
  assert.match(r.stdout, /AGENT — machine-signed/);
  const ph = show(dir);
  assert.equal(ph.cited_evidence, 'https://board.example/d/42');
  assert.equal(ph.accepted_kind, 'agent');
  assert.equal('accepted_evidence' in ph, false);
  assert.match(run(['phase', 'show', '1'], dir).stdout, /cited_evidence/);
  assert.doesNotMatch(r.stdout, /witnessed/);
});

test('C1: --witnessed composer with --evidence keeps both, in their own fields', async () => {
  const { dir } = await project();
  const r = run(['phase', 'accept', '1', '--witnessed', 'composer', '--evidence', 'DEC-7'], dir);
  assert.equal(r.status, 0, r.stderr);
  const ph = show(dir);
  assert.equal(ph.accepted_evidence, 'composer');
  assert.equal(ph.cited_evidence, 'DEC-7');
  assert.match(r.stdout, /witnessed: typed at the composer/);
  assert.match(r.stdout, /\(cites: DEC-7\)/);
});

test('C2: phase reject takes a citation and keeps the agent signer', async () => {
  const { dir } = await project();
  const r = run(['phase', 'reject', '1', '--reason', 'x', '--agent', 'claude', '--evidence', 'DEC-9'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(cites: DEC-9\)/);
  const entry = show(dir).rejections.at(-1);
  assert.equal(entry.cited_evidence, 'DEC-9');
  assert.equal(entry.kind, 'agent');
});

test('C2: fix accept takes a citation, fix list --all and fix show print it, plain list omits the fix', async () => {
  const { dir, fix } = await project();
  const r = run(['fix', 'accept', fix.id, '--agent', 'claude', '--evidence', 'https://board.example/f/3'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(cites: https:\/\/board\.example\/f\/3\)/);
  const all = run(['fix', 'list', '--all'], dir).stdout;
  assert.match(all, /accepted/);
  assert.match(all, /\(agent\)/);
  assert.match(all, /cites https:\/\/board\.example\/f\/3/);
  assert.equal(JSON.parse(run(['fix', 'show', fix.id], dir).stdout).cited_evidence, 'https://board.example/f/3');
  assert.doesNotMatch(run(['fix', 'list'], dir).stdout, new RegExp(fix.id));
  assert.ok(JSON.parse(run(['fix', 'list', '--all', '--json'], dir).stdout).some((f) => f.id === fix.id));
});

test('C3: a malformed citation is refused in one line on all three gates and changes nothing', async () => {
  const { dir, fix } = await project();
  const bads = ['x'.repeat(201), 'a\nb', ''];
  const gates = [['phase', 'accept', '1'], ['phase', 'reject', '1', '--reason', 'x'], ['fix', 'accept', fix.id]];
  for (const g of gates) {
    for (const bad of bads) oneLineError(run([...g, '--evidence', bad], dir));
    oneLineError(run([...g, '--evidence'], dir));
  }
  const ph = show(dir);
  assert.equal(ph.status, 'verified');
  assert.equal('rejections' in ph, false);
  assert.equal('accepted_kind' in ph, false);
  assert.equal(JSON.parse(run(['fix', 'show', fix.id], dir).stdout).status, 'open');
});

test('C3: a citation of exactly 200 characters is accepted', async () => {
  const { dir } = await project();
  const r = run(['phase', 'accept', '1', '--evidence', 'x'.repeat(200)], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(show(dir).cited_evidence, 'x'.repeat(200));
});

// Phase 46 C10: ASTRO_SIGNER_AGENT, exported by witness in front of a gate call it cannot read fully,
// signs every nested ac as the agent; an explicit --agent or --witnessed on the call wins.
const runEnv = (args, cwd, extra) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME, ...extra } });

test('C10: ASTRO_SIGNER_AGENT signs phase accept, phase reject and fix accept as the agent', async () => {
  const env = { ASTRO_SIGNER_AGENT: 'claude' };
  const a = await project();
  assert.equal(runEnv(['phase', 'accept', '1'], a.dir, env).status, 0);
  assert.equal(show(a.dir).accepted_kind, 'agent');
  assert.equal(show(a.dir).accepted_by, 'claude');
  const b = await project();
  assert.equal(runEnv(['phase', 'reject', '1', '--reason', 'x'], b.dir, env).status, 0);
  assert.match(run(['phase', 'show', '1', '--json'], b.dir).stdout, /"kind": "agent"/);
  const c = await project();
  assert.equal(runEnv(['fix', 'accept', c.fix.id], c.dir, env).status, 0);
  assert.match(run(['fix', 'list', '--all'], c.dir).stdout, /\(agent\)/);
  // an explicit flag wins; an empty variable is no signer
  const d = await project();
  assert.equal(runEnv(['phase', 'accept', '1', '--witnessed', 'composer'], d.dir, env).status, 0);
  assert.equal(show(d.dir).accepted_kind, 'human');
  const e = await project();
  assert.equal(runEnv(['phase', 'accept', '1'], e.dir, { ASTRO_SIGNER_AGENT: ' ' }).status, 0);
  assert.equal(show(e.dir).accepted_kind, 'human');
});

test('C10: run 5 forms, as witness rewrites them, record the agent when executed', async () => {
  const gates = await import('../mods/astro-mods/hooks/lib/gates.js');
  const forms = [
    'V=accept; bash --norc -c "ac phase $V 1"',
    'V=accept; bash -c -- "ac phase $V 1"',
    "V=accept; bash -c 'ac phase '\"$V\"' 1'",
    'V=accept; /bin/bash -c "ac phase $V 1"',
  ];
  for (const form of forms) {
    const { dir } = await project();
    const out = gates.withSignerEnv(gates.signSegments(form) ?? form);
    const shim = `ac() { "${process.execPath}" "${AC}" "$@"; }; export -f ac; `;
    const r = spawnSync('bash', ['-c', shim + out], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME } });
    assert.equal(r.status, 0, `${form}: ${r.stderr}`);
    assert.equal(show(dir).accepted_kind, 'agent', form);
  }
});
