// witness -- records whether a human or an agent made an acceptance, from where the turn began
// (phase 41, ADR-074 amends ADR-033, ADR-071 kind `mod`).
//
// The rule. ADR-033 says a phase or fix is accepted by a human, and `ac` could only take the
// caller's word for it (`--agent`). ADR-074 makes the evidence a fact the harness can see: the
// "current turn" is the stretch since the last prompt event, and a gate call (`ac phase
// accept|reject`, `ac fix accept`, or a CONTEXT.md human marker) is a human's own act only when
// that turn started in the composer with the matching typed command (`/astro-accept 41`,
// `/astro-fix-accept <f>`, `/astro-discuss 41`, or a `! ac ...` line) AND the call is in the main
// loop. Anything else is recorded as the agent. GATES (lib/gates.js) is the one table of which
// typed command unlocks which gate; this file only runs it.
//
// Why REWRITE and never deny. A deny would stall unattended runs (an executor or autonomous loop
// that accepts on its own is legitimate; it is just not a human). So the call goes through with
// the truth written into it: `--witnessed composer` when a human typed it, `--agent claude` when
// not, and a human marker line becomes the agent marker. PROBE.md observed that the rewritten
// `command` is the one that executes. Every hook computes its rewrite first and returns
// `next(...)` as its LAST act, so the fail-open `next(e)` can never run after a rewrite.
//
// Why the state is module-level and lost on reload. The turn lives in this file's memory only
// (ADR-071 c: a mod keeps no state of its own). A /reload-plugins re-runs register() and
// session.start, both of which forget it, so the next gate call finds no turn and fails open
// (ADR-071 e): the call is left as declared and the user is told once.
//
// Why subagent calls are never witnessed. A call with an `agentId` descends from the typed turn
// but is not the human's act, so it is recorded as the agent. That is also why the agent name is
// fixed: PROBE.md (phase 36) found no field joining an `agentId` to a subagent type, so every
// agent, main loop included, is `claude`.
//
// UAT. PROBE.md's verdict is not-observable: nothing on an AskUserQuestion event or result says
// who answered, so witness registers nothing for it and the typed command alone is the signal.
//
// `$.ui.toast` is spelled here, in this file's own hooks, and `$` is never handed to an imported
// helper (the plugin validator follows `$` only through functions declared in the file).
import { isOn } from '../lib/switches.js'
import { AGENT_NAME, findGates, rewriteGate, parseTyped, parseBang, idsMatch, segmentHas, segmentDeclaresAgent, rewriteRaw, markerRewrite, isPhaseContextPath } from '../lib/gates.js'

const NOTICE = {
  agent: 'witness: no typed /astro-accept|/astro-fix-accept for this id this turn — recorded as agent (--agent claude). ADR-074, ADR-033.',
  marker: 'witness: CONTEXT.md marker written outside a typed /astro-discuss <n> — recorded as captured by agent: claude. ADR-074.',
  undetermined: 'witness: could not tell who started this turn — left as declared. ADR-074, ADR-071(e).',
}

// null (unknown) | { origin, typed, expansion }
let turn = null
const told = { agent: false, marker: false, undetermined: false }

/** register() starts clean: no turn, every notice re-armed. */
export function resetWitness() {
  turn = null
  told.agent = told.marker = told.undetermined = false
}

/** session.start (and so every /reload-plugins): the turn is lost, the next gate fails open. */
export function forgetTurn() {
  turn = null
}

const kindOf = (e) => (e && e.origin && typeof e.origin.kind === 'string' ? e.origin.kind : null)

// a typed command that names no id unlocks nothing it can be matched to
const undeterminedFor = (gate) => !!(turn && turn.typed && turn.typed.gates.includes(gate) && turn.typed.id === null)

// is this gate call (kind, ref) the human's own act? the turn must be a composer turn that typed it
function witnessed(gate, ref, e) {
  return !!(turn && turn.origin === 'composer' && turn.typed && turn.typed.gates.includes(gate) &&
    idsMatch(turn.typed.kind, turn.typed.id, ref) && e.agentId === undefined)
}

export async function witnessCommand($, e, next) {
  if (!isOn('witness')) return next(e)
  const kind = kindOf(e)
  if (kind === null) turn = null
  else if (kind === 'composer') turn = { origin: 'composer', typed: parseTyped(e.command, e.args), expansion: true }
  else turn = { origin: kind, typed: null, expansion: false }
  return next(e)
}

export async function witnessPrompt($, e, next) {
  if (!isOn('witness')) return next(e)
  const kind = kindOf(e)
  if (kind === null) turn = null
  else if (kind !== 'composer') turn = { origin: kind, typed: null, expansion: false }
  else if (turn && turn.expansion) turn.expansion = false // the slash expansion keeps the typed signal
  else turn = { origin: 'composer', typed: parseBang(e.text), expansion: false }
  return next(e)
}

export async function witnessTool($, e, next) {
  if (!isOn('witness')) return next(e)
  let out = e
  let say = null
  if (e.tool === 'Bash') ({ out, say } = decideBash(e))
  else if (e.tool === 'Write' || e.tool === 'Edit') ({ out, say } = decideFile(e))
  if (say && !told[say]) {
    // set first: a toast that throws (no UI under -p) must not earn a second notice
    told[say] = true
    try {
      $.ui.toast(NOTICE[say])
    } catch {
      // -p has no UI: the call still goes through
    }
  }
  return next(out)
}

function decideBash(e) {
  if (typeof e.command !== 'string') return { out: e, say: null }
  const hit = findGates(e.command)
  if (hit.kind === 'none') return { out: e, say: null }
  if (hit.kind === 'ambiguous') {
    // unreadable: it is the agent's unless the human typed a gate command this turn
    if (turn === null || (turn.origin === 'composer' && turn.typed)) return { out: e, say: 'undetermined' }
    const command = rewriteRaw(e.command)
    return command === null ? { out: e, say: 'undetermined' } : { out: { ...e, command }, say: 'agent' }
  }
  if (segmentDeclaresAgent(hit)) return { out: e, say: null }
  if (turn === null || undeterminedFor(hit.gate)) return { out: e, say: 'undetermined' }
  if (witnessed(hit.gate, hit.ref, e)) {
    const command = segmentHas(hit, '--witnessed') ? e.command : rewriteGate(e.command, hit, { add: '--witnessed composer' })
    return { out: command === e.command ? e : { ...e, command }, say: null }
  }
  const command = rewriteGate(e.command, hit, { add: `--agent ${AGENT_NAME}`, strip: ['--witnessed', '--agent'] })
  return { out: { ...e, command }, say: 'agent' }
}

function decideFile(e) {
  const phase = isPhaseContextPath(e.file_path)
  if (phase === null) return { out: e, say: null }
  const text = markerRewrite({ tool: e.tool, content: e.content, new_string: e.new_string })
  if (text === null) return { out: e, say: null }
  if (turn === null || undeterminedFor('discuss marker')) return { out: e, say: 'undetermined' }
  if (witnessed('discuss marker', String(phase), e)) return { out: e, say: null }
  return { out: { ...e, [e.tool === 'Write' ? 'content' : 'new_string']: text }, say: 'marker' }
}
