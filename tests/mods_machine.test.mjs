// Phase 46 (ADR-081): the shared machine-typed prefix check and the prefixes `ac` hands the plugin
// at session start. Every new symbol arrives through `await import` (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const machine = () => import('../mods/astro-mods/hooks/lib/machine.js');
const switches = () => import('../mods/astro-mods/hooks/lib/switches.js');
const LIST = ['[relay] ', '/astro-accept', '.*'];

test('isMachineTyped: a trimmed prompt starting with a listed prefix is machine-typed', async () => {
  const { isMachineTyped } = await machine();
  assert.equal(isMachineTyped('[relay] /astro-accept 41', LIST), true);
  assert.equal(isMachineTyped('   [relay] ! ac phase accept 41', LIST), true);
  assert.equal(isMachineTyped('/astro-accept 41', LIST), true);
});

test('isMachineTyped: case, position, regex meaning, non-strings and an empty list never match', async () => {
  const { isMachineTyped } = await machine();
  assert.equal(isMachineTyped('[RELAY] x', LIST), false);
  assert.equal(isMachineTyped('hi [relay] x', LIST), false);
  assert.equal(isMachineTyped('hello', ['.*']), false, 'an entry is a literal string, not a regex');
  assert.equal(isMachineTyped(42, LIST), false);
  assert.equal(isMachineTyped(undefined, LIST), false);
  assert.equal(isMachineTyped('[relay] x', []), false);
});

test('commandText rebuilds the typed slash command', async () => {
  const { commandText } = await machine();
  assert.equal(commandText('astro-accept', '41'), '/astro-accept 41');
  assert.equal(commandText('/astro-accept', ''), '/astro-accept');
});

const ran = (obj, exitCode = 0) => ({ exitCode, stdout: JSON.stringify(obj), stderr: '' });

test('setSwitches keeps the prefixes ac handed over, beside the switches', async () => {
  const { setSwitches, getPrefixes, isOn, resetSwitches } = await switches();
  resetSwitches();
  setSwitches(ran({ switches: { witness: true }, warnings: [], machinePrefixes: ['[relay] '] }));
  assert.deepEqual(getPrefixes(), ['[relay] ']);
  assert.equal(isOn('witness'), true);
});

test('setSwitches: a missing or malformed prefix field gives no prefixes and never touches the switches', async () => {
  const { setSwitches, getPrefixes, isOn } = await switches();
  for (const bad of [undefined, 'x', [1], ['ok', 2], [''], {}]) {
    const payload = { switches: { witness: true }, warnings: [] };
    if (bad !== undefined) payload.machinePrefixes = bad;
    assert.doesNotThrow(() => setSwitches(ran(payload)));
    assert.deepEqual(getPrefixes(), [], JSON.stringify(bad));
    assert.equal(isOn('witness'), true);
  }
});

test('resetSwitches and a failing setSwitches leave the prefixes empty', async () => {
  const { setSwitches, getPrefixes, resetSwitches } = await switches();
  setSwitches(ran({ switches: {}, machinePrefixes: ['[relay] '] }));
  resetSwitches();
  assert.deepEqual(getPrefixes(), []);
  setSwitches(ran({ switches: {}, machinePrefixes: ['[relay] '] }));
  assert.throws(() => setSwitches({ exitCode: 1, stdout: '', stderr: '' }));
  assert.deepEqual(getPrefixes(), []);
});
