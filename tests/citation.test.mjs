// Phase 46 (ADR-081): a citation is stored beside the record and never makes the signer human.
// New symbols are reached through dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initPlanning } from '../lib/planning.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'ac-cite-'));
  initPlanning(root, { name: 'citedemo' });
  return root;
}
const NOW = new Date('2026-10-01T08:00:00.000Z');

test('checkCitation refuses a bare flag, an empty value, a newline and an over-long value in one line', async () => {
  const { checkCitation } = await import('../lib/util.mjs');
  for (const bad of [true, '', '   ', 'a\nb', 'a\rb', 'x'.repeat(201)]) {
    assert.throws(() => checkCitation(bad), (e) => /--evidence/.test(e.message) && !/\n/.test(e.message), JSON.stringify(bad));
  }
});

test('checkCitation accepts exactly 200 characters and trims the value', async () => {
  const { checkCitation } = await import('../lib/util.mjs');
  assert.equal(checkCitation('x'.repeat(200)), 'x'.repeat(200));
  assert.equal(checkCitation('  DEC-7  '), 'DEC-7');
});

test('acceptFix stores a citation beside an agent signer without the evidence/agent contradiction', async () => {
  const { addFix, acceptFix } = await import('../lib/fixes.mjs');
  const root = project();
  const f = await addFix(root, { title: 'foo', now: NOW });
  const r = await acceptFix(root, f.id, { agent: 'claude', cite: 'https://board.example/f/3' });
  assert.equal(r.cited_evidence, 'https://board.example/f/3');
  assert.equal(r.accepted_kind, 'agent');
  assert.equal('accepted_evidence' in r, false);
});

test('acceptFix keeps both the witness evidence and the citation', async () => {
  const { addFix, acceptFix } = await import('../lib/fixes.mjs');
  const root = project();
  const f = await addFix(root, { title: 'foo', now: NOW });
  const r = await acceptFix(root, f.id, { evidence: 'composer', cite: 'DEC-1' });
  assert.equal(r.accepted_evidence, 'composer');
  assert.equal(r.cited_evidence, 'DEC-1');
});

test('acceptFix without a citation writes no cited_evidence key', async () => {
  const { addFix, acceptFix } = await import('../lib/fixes.mjs');
  const root = project();
  const f = await addFix(root, { title: 'foo', now: NOW });
  const r = await acceptFix(root, f.id, {});
  assert.equal('cited_evidence' in r, false);
});

test('acceptFix with a multi-line citation throws and the fix stays open', async () => {
  const { addFix, acceptFix, loadFixes } = await import('../lib/fixes.mjs');
  const root = project();
  const f = await addFix(root, { title: 'foo', now: NOW });
  await assert.rejects(() => acceptFix(root, f.id, { cite: 'a\nb' }), /--evidence/);
  assert.equal(loadFixes(root).fixes[0].status, 'open');
});

test('rejectPhase records a citation on the rejection and never an evidence key', async () => {
  const { rejectPhase, addPhase, loadRoadmap } = await import('../lib/roadmap.mjs');
  const root = project();
  await addPhase(root, { number: 1, name: 'alpha', milestone: 1 });
  const slug = loadRoadmap(root).phases[0].slug;
  await rejectPhase(root, slug, { reason: 'x', agent: 'claude', cite: 'DEC-9' });
  const entry = loadRoadmap(root).phases[0].rejections.at(-1);
  assert.equal(entry.cited_evidence, 'DEC-9');
  assert.equal(entry.kind, 'agent');
  assert.equal('evidence' in entry, false);
});

test('rejectPhase with a bad citation throws before the write', async () => {
  const { rejectPhase, addPhase, loadRoadmap } = await import('../lib/roadmap.mjs');
  const root = project();
  await addPhase(root, { number: 1, name: 'alpha', milestone: 1 });
  const slug = loadRoadmap(root).phases[0].slug;
  const before = loadRoadmap(root).phases[0].status;
  await assert.rejects(() => rejectPhase(root, slug, { reason: 'x', cite: 'a\nb' }), /--evidence/);
  assert.equal(loadRoadmap(root).phases[0].status, before);
});

test('resolveFix names one fix, the ambiguous candidates, or nothing', async () => {
  const { addFix, resolveFix } = await import('../lib/fixes.mjs');
  const root = project();
  const a = await addFix(root, { title: 'foo', now: new Date('2026-10-01T08:00:00Z') });
  const b = await addFix(root, { title: 'foo', now: new Date('2026-10-02T08:00:00Z') });
  assert.equal(resolveFix(root, a.id).fix.id, a.id);
  assert.deepEqual(resolveFix(root, 'foo').ambiguous.sort(), [a.id, b.id].sort());
  assert.deepEqual(resolveFix(root, 'no-such-slug'), {});
  assert.equal(resolveFix(root, '2026-10-02').fix.id, b.id, 'a unique fragment still resolves');
});
