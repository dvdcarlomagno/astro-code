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
// Machine-typed turns (phase 46, ADR-081). A composer prompt (or typed slash command) that STARTS with
// one of the user's machine-typed prefixes (`mods.machinePrefixes`, handed over by `ac` at session
// start; the one match is hooks/lib/machine.js) was typed by a tool, not the human. Its turn gets the
// origin 'machine', which is never 'composer', so no gate call in it is witnessed: it is signed
// `--agent claude`, and a human CONTEXT.md marker becomes the agent marker. A missing or malformed
// list is no prefixes (fail soft), so nothing changes without the config.
//
// A cold `--witnessed` (no known turn, or a typed gate with no id) is DROPPED but gets no `--agent`:
// witness cannot say who signed, so the call stays as declared (ADR-071 e) minus a claim only
// witness may make. Variable gate verbs (`V=accept; ac phase $V 41`) and Bash writes of the human
// CONTEXT.md marker (`printf … > CONTEXT.md`, `sed -i`, a heredoc) are judged like their direct forms.
//
// UAT. PROBE.md's verdict is not-observable: nothing on an AskUserQuestion event or result says
// who answered, so witness registers nothing for it and the typed command alone is the signal.
//
// `$.ui.toast` is spelled here, in this file's own hooks, and `$` is never handed to an imported
// helper (the plugin validator follows `$` only through functions declared in the file).
import { isOn, getPrefixes } from '../lib/switches.js'
import { isMachineTyped, commandText } from '../lib/machine.js'
import { AGENT_NAME, findGates, rewriteGate, parseTyped, parseBang, idsMatch, segmentHas, segmentDeclaresAgent, rewriteRaw, markerRewrite, editRewrite, isPhaseContextPath, GATE_VERBS, shellText, signSegments, RAW_SEES, onlyQuotedMention, VAR_VERB, dropWitnessed, bashMarkerRewrite, effectGuard, contextPathsIn, withSignerEnv, NESTS } from '../lib/gates.js'

const NOTICE = {
  agent: 'witness: no typed /astro-accept|/astro-fix-accept for this id this turn — recorded as agent (--agent claude). ADR-074, ADR-033.',
  marker: 'witness: CONTEXT.md marker written outside a typed /astro-discuss <n> — recorded as captured by agent: claude. ADR-074.',
  undetermined: 'witness: could not tell who started this turn — left as declared (a self-supplied --witnessed is dropped). ADR-074, ADR-071(e).',
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
  else if (kind === 'composer' && isMachineTyped(commandText(e.command, e.args), getPrefixes())) turn = { origin: 'machine', typed: null, expansion: true }
  else if (kind === 'composer') turn = { origin: 'composer', typed: parseTyped(e.command, e.args), expansion: true }
  else turn = { origin: kind, typed: null, expansion: false }
  return next(e)
}

export async function witnessPrompt($, e, next) {
  if (!isOn('witness')) return next(e)
  // A prompt delivered INTO the running turn (`turnId` set: a background task's notification, a
  // peer's message, text typed mid-turn) does not start a turn, so who started it stands. Before,
  // a task notification arriving during a typed /astro-discuss wiped the typed signal, and the
  // human's own CONTEXT.md was recorded as captured by agent.
  if (typeof e.turnId === 'string' && turn !== null) return next(e)
  const kind = kindOf(e)
  if (kind === null) turn = null
  else if (kind !== 'composer') turn = { origin: kind, typed: null, expansion: false }
  else if (turn && turn.expansion) turn.expansion = false // the slash expansion keeps the typed signal
  // checked BEFORE parseBang: `   [relay] ! ac phase accept 41` is a tool's line, not the human's bang
  else if (isMachineTyped(e.text, getPrefixes())) turn = { origin: 'machine', typed: null, expansion: false }
  else turn = { origin: 'composer', typed: parseBang(e.text), expansion: false }
  return next(e)
}

export async function witnessTool($, e, next) {
  if (!isOn('witness')) return next(e)
  let out = e
  let say = null
  if (e.tool === 'Bash') ({ out, say } = decideBash(e))
  else if (e.tool === 'Write' || e.tool === 'Edit') ({ out, say } = decideFile(e))
  if (e.tool === 'Edit' && out === e && say === null) ({ out, say } = await decideEditEffect($, e))
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
  // The marker pass first: a Bash write of the human CONTEXT.md marker is judged like a Write/Edit.
  // The gate pass then runs on whatever this left; the first notice wins.
  let cur = e
  let markSay = null
  const mk = bashMarkerRewrite(e.command)
  if (mk !== null) {
    if (turn === null || undeterminedFor('discuss marker')) markSay = 'undetermined'
    else if (mk.unknown || !mk.phases.every((n) => witnessed('discuss marker', String(n), e))) {
      cur = { ...e, command: mk.command }
      markSay = 'marker'
    }
  }
  const g = decideGateBash(cur)
  // Then the effect: whatever the text says, a call that leaves the human marker on line 1 of a phase
  // CONTEXT.md the human did not discuss in this turn ends with the agent marker there (phase 46 C8).
  let out = g.out
  if (turn !== null && !undeterminedFor('discuss marker')) {
    const phases = contextPathsIn(out.command).map(isPhaseContextPath)
    const guarded = phases.every((n) => witnessed('discuss marker', String(n), e)) ? null : effectGuard(out.command)
    if (guarded !== null) out = { ...out, command: guarded }
  }
  return { out, say: markSay ?? g.say }
}

function decideGateBash(e) {
  const hit = findGates(e.command)
  // findGates found no gate, yet the gate verbs are there (`node --no-warnings bin/ac.mjs phase accept`,
  // `$(which ac) phase accept`): unreadable, not innocent.
  if (hit.kind === 'none' && !GATE_VERBS.test(shellText(e.command)) && !VAR_VERB.test(e.command)) return { out: e, say: null }
  // Named only inside quoted text nothing can run (`echo "… phase accept 12 --agent claude"`, a grep pattern, a
  // commit message): a mention, left exactly as written.
  if (hit.kind === 'none' && onlyQuotedMention(e.command)) return { out: e, say: null }
  if (hit.kind === 'ambiguous' || hit.kind === 'none') {
    // unreadable: every gate the human did not type is the agent's, and no gate keeps a --witnessed
    // it did not get from witness (phase 41 verify, C2: `ac phase accept 41 && ac phase accept 55
    // --witnessed composer` after a typed /astro-accept 41). The typed gate itself stays declared.
    if (turn === null) return undetermined(e, dropWitnessed(e.command))
    const typed = turn.origin === 'composer' && turn.typed ? turn.typed : null
    const keep = (ref) => typed !== null && idsMatch(typed.kind, typed.id, ref)
    // the raw-text pass first; if a quoted verb or ref hides the gate from it, sign every segment
    let command = rewriteRaw(e.command, AGENT_NAME, keep)
    // a gate verb held in a variable cannot be read at all (VAR_VERB): sign it too, never leave it human
    const c = command ?? e.command
    if ((GATE_VERBS.test(shellText(c)) && !RAW_SEES.test(c)) || VAR_VERB.test(c)) command = signSegments(c) ?? command
    // and in the environment, which every nested ac inherits however the command is quoted (`bash
    // --norc -c`, `-c --`, adjacent quotes, xargs, a script): text splicing cannot reach all of those.
    // Only where splicing can miss: a variable verb, or a nested shell, eval or xargs. A typed gate in
    // the same command keeps its declared form unless a verb is held in a variable.
    if (VAR_VERB.test(e.command) || (typed === null && NESTS.test(e.command))) command = withSignerEnv(command ?? e.command)
    return command === null ? { out: e, say: 'undetermined' } : { out: { ...e, command }, say: 'agent' }
  }
  // Any --agent word, even bare or empty, already DECLARES agent provenance (ac's own reject code):
  // never add --witnessed to it, never rename it (phase 41 verify, C4).
  if (segmentHas(hit, '--agent')) return { out: e, say: null }
  if (turn === null || undeterminedFor(hit.gate)) {
    return undetermined(e, segmentHas(hit, '--witnessed') ? rewriteGate(e.command, hit, { strip: ['--witnessed'] }) : null)
  }
  if (witnessed(hit.gate, hit.ref, e)) {
    const command = segmentHas(hit, '--witnessed') ? e.command : rewriteGate(e.command, hit, { add: '--witnessed composer' })
    return { out: command === e.command ? e : { ...e, command }, say: null }
  }
  const command = rewriteGate(e.command, hit, { add: `--agent ${AGENT_NAME}`, strip: ['--witnessed', '--agent'] })
  return { out: { ...e, command }, say: 'agent' }
}

// Who started the turn is unknown: the call stays as declared, minus a self-supplied --witnessed (a
// claim only witness may make). `dropped` is the command without it, or null when it held none.
function undetermined(e, dropped) {
  return { out: dropped === null ? e : { ...e, command: dropped }, say: 'undetermined' }
}

// An Edit whose own text looks harmless can still make line 1 of the file the human marker
// (phase 41 verify, C6): read the file, apply the Edit in memory, and judge the result. Reading is
// a check, not state (ADR-071 c); a failed read leaves the call as declared.
async function decideEditEffect($, e) {
  if (isPhaseContextPath(e.file_path) === null) return { out: e, say: null }
  let current
  try { current = await $.fs.read(e.file_path) } catch { return { out: e, say: null } }
  const edit = editRewrite(typeof current === 'string' ? current : current?.text, e)
  if (edit === null) return { out: e, say: null }
  if (turn === null || undeterminedFor('discuss marker')) return { out: e, say: 'undetermined' }
  if (witnessed('discuss marker', String(isPhaseContextPath(e.file_path)), e)) return { out: e, say: null }
  return { out: { ...e, ...edit }, say: 'marker' }
}

function decideFile(e) {
  const phase = isPhaseContextPath(e.file_path)
  if (phase === null) return { out: e, say: null }
  // An Edit is judged by where its text LANDS (decideEditEffect reads the file): its own first line
  // says nothing about line 1 of the file, and C6(d) leaves a marker below line 1 alone (phase 41).
  if (e.tool === 'Edit') return { out: e, say: null }
  const text = markerRewrite({ tool: e.tool, content: e.content, new_string: e.new_string })
  if (text === null) return { out: e, say: null }
  if (turn === null || undeterminedFor('discuss marker')) return { out: e, say: 'undetermined' }
  if (witnessed('discuss marker', String(phase), e)) return { out: e, say: null }
  return { out: { ...e, [e.tool === 'Write' ? 'content' : 'new_string']: text }, say: 'marker' }
}
