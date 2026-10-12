// Phase 41 — the witness mod's pure helpers (ADR-074 amends ADR-033).
// RED first (ADR-018): hooks/lib/gates.js does not exist yet, so every symbol arrives through
// `await import(...)` inside an async body and a missing module fails each test on its own.
//
// gates.js is plain values in, plain values out: no `$`, no event, no imports. The pure rules
// pinned here are the gate table (which typed command unlocks which `ac` gate), the Bash
// parser/rewriter (catching mistakes, not a sandbox) and the CONTEXT.md marker rewrite.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyContext } from '../lib/planning.mjs';

const GATES_URL = '../mods/astro-mods/hooks/lib/gates.js';
const gates = () => import(GATES_URL);

// ── parseTyped: the slash form, from `command.run` { command, args } ────────

test('parseTyped: /astro-accept unlocks phase accept and phase reject for that phase', async () => {
  const { parseTyped, idsMatch } = await gates();
  for (const args of ['41', '41-witness-mod-x']) {
    const t = parseTyped('astro-accept', args);
    assert.deepStrictEqual(t.gates, ['phase accept', 'phase reject']);
    assert.strictEqual(t.kind, 'phase');
    assert.ok(idsMatch('phase', t.id, '41'), `${args} must mean phase 41`);
  }
});

test('parseTyped: /astro-fix-accept unlocks fix accept; /astro-discuss unlocks the discuss marker', async () => {
  const { parseTyped } = await gates();
  const fix = parseTyped('astro-fix-accept', '2026-10-11-foo');
  assert.deepStrictEqual(fix.gates, ['fix accept']);
  assert.strictEqual(fix.kind, 'fix');
  assert.strictEqual(fix.id, '2026-10-11-foo');
  const discuss = parseTyped('astro-discuss', '41 --challenge');
  assert.deepStrictEqual(discuss.gates, ['discuss marker']);
  assert.strictEqual(discuss.kind, 'phase');
  assert.strictEqual(discuss.id, '41');
});

test('parseTyped: a typed gate command with no id has an undetermined id, never a guess', async () => {
  const { parseTyped } = await gates();
  for (const c of ['astro-accept', 'astro-fix-accept', 'astro-discuss']) {
    const t = parseTyped(c, '');
    assert.ok(t, `${c} is still a gate command`);
    assert.strictEqual(t.id, null);
  }
});

test('parseTyped: every other command unlocks nothing', async () => {
  const { parseTyped } = await gates();
  assert.strictEqual(parseTyped('astro-autonomous', ''), null);
  assert.strictEqual(parseTyped('astro-status', ''), null);
  assert.strictEqual(parseTyped('compact', ''), null);
});

// ── parseBang: the `!` form, from a composer `prompt.submit` { text } ───────

test('parseBang: a ! gate command unlocks exactly that gate and id', async () => {
  const { parseBang, idsMatch } = await gates();
  const a = parseBang('! ac phase accept 41');
  assert.deepStrictEqual(a.gates, ['phase accept']);
  assert.ok(idsMatch('phase', a.id, '41'));
  const r = parseBang('!ac phase reject 41');
  assert.deepStrictEqual(r.gates, ['phase reject']);
  const f = parseBang('! ac fix accept foo');
  assert.deepStrictEqual(f.gates, ['fix accept']);
  assert.strictEqual(f.id, 'foo');
});

test('parseBang: anything else is null', async () => {
  const { parseBang } = await gates();
  for (const text of ['hello', '! ls', '/astro-accept 41', '', 'ac phase accept 41']) {
    assert.strictEqual(parseBang(text), null, JSON.stringify(text));
  }
});

// ── findGates: the Bash parser ──────────────────────────────────────────────

test('findGates: one clean gate segment is found, with the ref and its end offset', async () => {
  const { findGates } = await gates();
  const table = [
    ['ac phase accept 41', 'phase accept', '41'],
    ['ac phase accept 41-witness-mod-detect-human-vs-agent --by me', 'phase accept', '41-witness-mod-detect-human-vs-agent'],
    ['cd /x && ac phase accept 41', 'phase accept', '41'],
    ['FOO=1 ac phase reject 41 --reason "it\'s broken; really"', 'phase reject', '41'],
    ['node /abs/bin/ac.mjs fix accept 2026-10-11-foo', 'fix accept', '2026-10-11-foo'],
    ['/abs/ac phase accept 41 # note', 'phase accept', '41'],
    ['ac phase accept 41 2>&1 | tail -1', 'phase accept', '41'],
  ];
  for (const [cmd, gate, ref] of table) {
    const hit = findGates(cmd);
    assert.strictEqual(hit.kind, 'one', cmd);
    assert.strictEqual(hit.gate, gate, cmd);
    assert.strictEqual(hit.ref, ref, cmd);
    assert.ok(cmd.slice(0, hit.refEnd).endsWith(ref), `${cmd}: refEnd must sit right after the ref`);
  }
});

test('findGates: a command that merely mentions a gate is none', async () => {
  const { findGates } = await gates();
  for (const cmd of ['git commit -m "ac phase accept 41"', 'ac phase verify 41', 'ac fix show x', 'echo phase accept']) {
    assert.strictEqual(findGates(cmd).kind, 'none', cmd);
  }
});

test('findGates: what it cannot read with confidence is ambiguous, never guessed', async () => {
  const { findGates } = await gates();
  for (const cmd of [
    'ac phase accept 41 && ac fix accept foo',
    'ac phase accept --force 41',
    'ac phase accept $N',
    "bash -c 'ac phase accept 41'",
    "lean-ctx -c 'ac phase accept 41'",
    'echo $(ac phase accept 41)',
  ]) {
    assert.strictEqual(findGates(cmd).kind, 'ambiguous', cmd);
  }
});

// ── rewriteGate: a pure splice by offsets ───────────────────────────────────

test('rewriteGate: adds a flag right after the ref and touches nothing else', async () => {
  const { findGates, rewriteGate } = await gates();
  const cases = [
    ['ac phase accept 41 --by me', '--witnessed composer', 'ac phase accept 41 --witnessed composer --by me'],
    ['cd x && ac phase accept 41 2>&1 | tail -1', '--agent claude', 'cd x && ac phase accept 41 --agent claude 2>&1 | tail -1'],
  ];
  for (const [cmd, add, want] of cases) {
    const out = rewriteGate(cmd, findGates(cmd), { add });
    assert.strictEqual(out, want);
    assert.strictEqual(out.replace(` ${add}`, ''), cmd, 'the output differs from the input only at the splice');
  }
});

test('rewriteGate: strips a model-supplied --witnessed and its value before adding --agent', async () => {
  const { findGates, rewriteGate } = await gates();
  const cmd = 'ac phase accept 41 --witnessed composer --by me';
  const out = rewriteGate(cmd, findGates(cmd), { add: '--agent claude', strip: ['--witnessed'] });
  assert.strictEqual(out, 'ac phase accept 41 --agent claude --by me');
});

// ── idsMatch ────────────────────────────────────────────────────────────────

test('idsMatch: phases compare by their leading integer', async () => {
  const { idsMatch } = await gates();
  assert.ok(idsMatch('phase', '41', '041'));
  assert.ok(idsMatch('phase', '41', '41-x'));
  assert.ok(idsMatch('phase', '41-witness-mod', '41'));
  assert.ok(!idsMatch('phase', '41', '14'));
  assert.ok(!idsMatch('phase', '41', '4'));
});

test('idsMatch: a fix matches the exact id, or <date>-<typed slug>; never a longer slug or a bare ref', async () => {
  const { idsMatch } = await gates();
  // phase 41 verify C3: `ac fix accept sample-bug` can resolve to 2026-10-12-other-sample-bug
  assert.ok(idsMatch('fix', '2026-10-11-foo', '2026-10-11-foo'));
  assert.ok(idsMatch('fix', 'foo', 'foo'));
  assert.ok(idsMatch('fix', 'foo', '2026-10-11-foo'), 'the slug /astro-fix-accept documents, run with its date');
  assert.ok(idsMatch('fix', 'sample-bug', '2026-10-12-sample-bug'));
  assert.ok(!idsMatch('fix', 'sample-bug', '2026-10-12-other-sample-bug'), 'a longer slug that ends with it is another fix');
  assert.ok(!idsMatch('fix', '2026-10-11-foo', 'foo'), 'the dated id is not a bare ref');
  assert.ok(!idsMatch('fix', '2026-10-12-sample-bug', 'sample-bug'));
  assert.ok(!idsMatch('fix', 'fo', '2026-10-11-foo'), 'a fragment is not the slug');
  assert.ok(!idsMatch('fix', 'foo-bar', 'foo'));
});

test('idsMatch: an undetermined id never matches', async () => {
  const { idsMatch } = await gates();
  assert.ok(!idsMatch('phase', null, '41'));
  assert.ok(!idsMatch('fix', null, 'foo'));
});

// ── the CONTEXT.md marker ───────────────────────────────────────────────────

test('markerRewrite: a Write whose first line is the human marker becomes the agent marker', async () => {
  const { markerRewrite, AGENT_MARKER } = await gates();
  const out = markerRewrite({ tool: 'Write', content: '<!-- astro-discuss: captured -->\n# T\nbody\n' });
  assert.strictEqual(out, `${AGENT_MARKER}\n# T\nbody\n`);
});

test('markerRewrite: CRLF and leading blank lines are kept', async () => {
  const { markerRewrite, AGENT_MARKER } = await gates();
  assert.strictEqual(
    markerRewrite({ tool: 'Write', content: '<!-- astro-discuss: captured -->\r\n# T\r\n' }),
    `${AGENT_MARKER}\r\n# T\r\n`,
  );
  assert.strictEqual(
    markerRewrite({ tool: 'Write', content: '\n\n<!-- astro-discuss: captured -->\n# T\n' }),
    `\n\n${AGENT_MARKER}\n# T\n`,
    'classifyContext counts the first NON-BLANK line, so witness does too',
  );
});

test('markerRewrite: an agent marker is never upgraded, and a Write marker on any line is rewritten', async () => {
  const { markerRewrite, AGENT_MARKER } = await gates();
  assert.strictEqual(markerRewrite({ tool: 'Write', content: `${AGENT_MARKER}\n# T\n` }), null);
  assert.strictEqual(markerRewrite({ tool: 'Write', content: '<!-- astro-discuss: captured by agent: bob -->\n' }), null);
  assert.strictEqual(markerRewrite({ tool: 'Write', content: '# T\nx\n<!-- astro-discuss: captured by agent: bob -->\n' }), null);
});

test('markerRewrite: an Edit reads new_string, and only its first line counts', async () => {
  const { markerRewrite, AGENT_MARKER } = await gates();
  assert.strictEqual(
    markerRewrite({ tool: 'Edit', new_string: '<!-- astro-discuss: captured -->\nmore\n' }),
    `${AGENT_MARKER}\nmore\n`,
  );
  assert.strictEqual(markerRewrite({ tool: 'Edit', new_string: 'intro\n<!-- astro-discuss: captured -->\n' }), null);
  assert.strictEqual(markerRewrite({ tool: 'Read', content: '<!-- astro-discuss: captured -->\n' }), null);
});

test('drift: the plugin copy of the human-marker rule agrees with lib/planning.mjs on every variant', async () => {
  const { isHumanMarkerLine, markerRewrite, AGENT_MARKER } = await gates();
  const variants = [
    '<!-- astro-discuss: captured -->',
    '<!--astro-discuss:captured-->',
    '<!--   astro-discuss:   captured   -->',
    '<!-- ASTRO-DISCUSS: CAPTURED -->',
    '  <!-- astro-discuss: captured -->  ',
    '<!-- astro-discuss: captured by agent: claude -->',
    '<!-- astro-discuss: captured by agent claude -->',
    '<!-- astro-discuss: captured by claude -->',
    '<!-- astro-discuss: captured extra -->',
    '<!-- astro-discuss: captured --> trailing',
    '# heading',
    '',
  ];
  for (const line of variants) {
    assert.strictEqual(isHumanMarkerLine(line), classifyContext(line).kind === 'human', JSON.stringify(line));
  }
  const rewritten = markerRewrite({ tool: 'Write', content: '<!-- astro-discuss: captured -->\n# T\n' });
  assert.deepStrictEqual(classifyContext(rewritten), { kind: 'agent', author: 'claude' });
  assert.strictEqual(classifyContext(AGENT_MARKER).kind, 'agent');
});

test('AGENT_NAME carries no > (debt 2026-09-24-a-in-the-agent-name-in-a-context-marker)', async () => {
  const { AGENT_NAME, AGENT_MARKER } = await gates();
  assert.ok(AGENT_NAME && !AGENT_NAME.includes('>'));
  assert.ok(AGENT_MARKER.includes(AGENT_NAME));
});

test('GATES is frozen: the one table', async () => {
  const { GATES } = await gates();
  assert.ok(Object.isFrozen(GATES));
});

// ── isPhaseContextPath ──────────────────────────────────────────────────────

test('isPhaseContextPath: only a phase directory CONTEXT.md names a phase', async () => {
  const { isPhaseContextPath } = await gates();
  assert.strictEqual(isPhaseContextPath('/a/.astrocode/phases/41-x/CONTEXT.md'), 41);
  assert.strictEqual(isPhaseContextPath('C:\\a\\.astrocode\\phases\\41-x\\CONTEXT.md'), 41);
  for (const p of ['/a/.astrocode/CONTEXT.md', '/a/phases/41-x/CONTEXT.md', '/a/.astrocode/phases/41-x/PLAN.md', undefined, 42]) {
    assert.strictEqual(isPhaseContextPath(p), null, String(p));
  }
});

test('markerRewrite: only the first non-blank line is a provenance claim; a marker later in the body is left alone (C6 d)', async () => {
  const { markerRewrite, AGENT_MARKER } = await gates();
  assert.strictEqual(markerRewrite({ tool: 'Write', content: '# T\n<!-- astro-discuss: captured -->\nbody\n' }), null);
  // line 1 is rewritten, a marker quoted in the body stays byte-identical (phase 41 verify C6)
  const body = 'The human marker `<!-- astro-discuss: captured -->` means a human captured it.';
  assert.strictEqual(
    markerRewrite({ tool: 'Write', content: `<!-- astro-discuss: captured -->\n# T\n\n${body}\n` }),
    `${AGENT_MARKER}\n# T\n\n${body}\n`);
});

test('idsMatch: two dated fixes match only on the same date', async () => {
  const { idsMatch } = await gates();
  assert.ok(!idsMatch('fix', '2026-10-01-foo-bar', '2026-09-01-foo-bar'));
  assert.ok(idsMatch('fix', '2026-10-01-foo-bar', '2026-10-01-foo-bar'));
});

test('rewriteRaw / segmentDeclaresAgent: unreadable gate calls and empty --agent values', async () => {
  const { rewriteRaw, findGates, segmentDeclaresAgent } = await gates();
  assert.strictEqual(rewriteRaw('ac phase accept 41 && ac phase accept 42'), 'ac phase accept 41 --agent claude && ac phase accept 42 --agent claude');
  assert.strictEqual(rewriteRaw('bash -c "ac phase accept 41"'), 'bash -c "ac phase accept 41 --agent claude"');
  assert.strictEqual(rewriteRaw('N=41; ac phase accept $N'), 'N=41; ac phase accept $N --agent claude');
  assert.strictEqual(rewriteRaw('ac phase accept 41 --agent bob && ls'), null);
  assert.ok(!segmentDeclaresAgent(findGates('ac phase accept 45 --agent')));
  assert.ok(!segmentDeclaresAgent(findGates('ac phase accept 41 --agent ""')));
  assert.ok(segmentDeclaresAgent(findGates('ac phase accept 41 --agent bob')));
});

test('editRewrite: an Edit that leaves line 1 claiming human provenance becomes a whole-file replacement (phase 41 C6)', async () => {
  const { editRewrite, AGENT_MARKER } = await gates();
  const file = `${AGENT_MARKER}\n# C\n`;
  assert.deepStrictEqual(editRewrite(file, { old_string: ' by agent: claude', new_string: '' }), { old_string: file, new_string: file, replace_all: false });
  assert.deepStrictEqual(editRewrite(file, { old_string: AGENT_MARKER, new_string: '\n<!-- astro-discuss: captured -->' }), { old_string: file, new_string: `\n${AGENT_MARKER}\n# C\n`, replace_all: false });
  assert.strictEqual(editRewrite(file, { old_string: '# C', new_string: '# Context' }), null, 'an ordinary edit is left alone');
  assert.strictEqual(editRewrite(file, { old_string: 'missing', new_string: 'x' }), null, 'an Edit that does not apply is left alone');
  assert.strictEqual(editRewrite('<!-- astro-discuss: captured -->\n# C\n', { old_string: '# C', new_string: '# D' }), null, 'already human: not this Edit\'s claim');
});
