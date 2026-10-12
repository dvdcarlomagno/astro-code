// The witness mod's pure core (ADR-074 amends ADR-033): the ONE gate table, the Bash parser and
// rewriter, and the CONTEXT.md marker rule. Plain values in, plain values out -- no `$`, no
// event, no imports -- so the plugin validator never sees a helper holding the engine handle
// (phase 36 PROBE F1) and tests/witness.test.mjs can drive every rule without an engine.
//
// Why the table lives here once. "Which typed command unlocks which `ac` gate" is a rule, and a
// rule stated in two places drifts. `ac` carries only the evidence flag (`--witnessed`); the
// docs point at GATES instead of copying it.
//
// Why the human-marker regex is a COPY. The plugin ships apart from `lib/`, so it cannot import
// `lib/planning.mjs`. tests/witness.test.mjs feeds a table of variant lines to both and asserts
// they agree, which is what keeps the copy honest.
//
// The Bash parser is for catching mistakes, not a sandbox. It reads quotes, escapes, comments
// and the unquoted separators `&& || ; | &` and newline, and it recognises an `ac` (or
// `node .../ac.mjs`) word followed by `phase accept|reject` or `fix accept`. Anything it cannot
// read with confidence is `ambiguous`, and the caller leaves ambiguous calls alone: `bash -c`,
// `lean-ctx -c`, `eval`, `$(...)`, a subshell, two gates in one line, a ref that is a flag or a
// variable. Known gaps, by design: MCP shell tools (`ctx_shell`) are not the Bash tool; an `ac`
// alias or wrapper script is not recognised; Remote Control prompts (`bridge`) carry no human
// signal, so a human accepting from a phone is recorded as an agent.
//
// Why an EMPTY id is undetermined, not agent. `/astro-accept` with no number is still a gate
// command a human typed; the phase it means is unknown, so the id cannot be matched. Recording
// "agent" would be false, so the caller leaves it as declared (ADR-071 e).

/** Freeze a table all the way down: a rule that can be mutated at runtime is not a table. */
function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v)
  return Object.freeze(o)
}

export const GATES = deepFreeze({
  // a composer slash command -> the gates it unlocks, and what kind of id follows it
  typed: {
    'astro-accept': { unlocks: ['phase accept', 'phase reject'], kind: 'phase' },
    'astro-fix-accept': { unlocks: ['fix accept'], kind: 'fix' },
    'astro-discuss': { unlocks: ['discuss marker'], kind: 'phase' },
  },
  // a composer `! ac ...` unlocks exactly the gate it spells
  bang: ['phase accept', 'phase reject', 'fix accept'],
  // how an `ac` gate's ref is read
  kinds: { 'phase accept': 'phase', 'phase reject': 'phase', 'fix accept': 'fix', 'discuss marker': 'phase' },
})

// One fixed name for the main loop and every subagent: phase 36 PROBE found no field joining an
// agentId to a subagent type. No `>`: it lands inside an HTML comment (debt
// 2026-09-24-a-in-the-agent-name-in-a-context-marker).
export const AGENT_NAME = 'claude'
export const AGENT_MARKER = `<!-- astro-discuss: captured by agent: ${AGENT_NAME} -->`
export const HUMAN_MARKER = /^<!--\s*astro-discuss:\s*captured\s*-->$/i
const HUMAN_INLINE = /<!--\s*astro-discuss:\s*captured\s*-->/gi

const PHASE_REF = /^\d+(-[A-Za-z0-9._-]+)?$/
const FIX_REF = /^[A-Za-z0-9._-]+$/
const GATE_TEXT = /(?:^|[\s/'"`(])(?:ac|ac\.mjs)\s+(?:phase\s+(?:accept|reject)|fix\s+accept)\b/
const WRAPPERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'eval', 'lean-ctx', 'ctx_shell', 'env', 'sudo', 'xargs', 'time', 'nohup', 'exec', 'command', 'timeout', 'ssh', 'host', 'watch', 'npx', 'script'])

const base = (w) => w.slice(w.lastIndexOf('/') + 1)

// ── the Bash tokenizer: words with their byte offsets, split into segments ────

function tokenize(cmd) {
  const segs = [[]]
  let complex = false
  let word = null
  const flush = (end) => {
    if (!word) return
    word.end = end
    segs[segs.length - 1].push(word)
    word = null
  }
  const brk = (end) => {
    flush(end)
    if (segs[segs.length - 1].length) segs.push([])
  }
  const n = cmd.length
  let i = 0
  while (i < n) {
    const c = cmd[i]
    if (c === ' ' || c === '\t' || c === '\r') { flush(i); i++; continue }
    if (c === '\n') { brk(i); i++; continue }
    if (c === '#' && !word) { while (i < n && cmd[i] !== '\n') i++; continue }
    if (c === ';') { brk(i); i++; continue }
    if (c === '|' || (c === '&' && cmd[i - 1] !== '>' && cmd[i - 1] !== '<' && cmd[i + 1] !== '>')) {
      brk(i)
      i += cmd[i + 1] === c ? 2 : 1
      continue
    }
    if (!word) word = { text: '', start: i, end: i }
    if (c === "'") {
      const close = cmd.indexOf("'", i + 1)
      const stop = close === -1 ? n : close
      word.text += cmd.slice(i + 1, stop)
      i = stop + 1
    } else if (c === '"') {
      i++
      while (i < n && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < n) {
          word.text += '"\\$`'.includes(cmd[i + 1]) ? cmd[i + 1] : cmd[i] + cmd[i + 1]
          i += 2
          continue
        }
        if (cmd[i] === '`' || (cmd[i] === '$' && cmd[i + 1] === '(')) complex = true
        word.text += cmd[i++]
      }
      i++
    } else if (c === '\\') {
      if (cmd[i + 1] !== '\n') word.text += cmd[i + 1] ?? ''
      i += 2
    } else {
      if (c === '(' || c === ')' || c === '`') complex = true
      word.text += c
      i++
    }
  }
  flush(n)
  return { segs: segs.filter((s) => s.length), complex }
}

// one segment -> { gate, ref, refIndex } | { bad: true } | null
function readGate(words) {
  let i = 0
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].text)) i++
  const head = words[i]?.text
  if (head === undefined) return null
  let at = null
  if (base(head) === 'ac' || base(head) === 'ac.mjs') at = i + 1
  else if (head === 'node' && words[i + 1] && base(words[i + 1].text) === 'ac.mjs') at = i + 2
  if (at === null) return null
  const a = words[at]?.text
  const b = words[at + 1]?.text
  const gate = a === 'phase' && (b === 'accept' || b === 'reject') ? `phase ${b}` : a === 'fix' && b === 'accept' ? 'fix accept' : null
  if (!gate) return null
  const ref = words[at + 2]
  if (!ref) return null
  const ok = (GATES.kinds[gate] === 'phase' ? PHASE_REF : FIX_REF).test(ref.text)
  if (!ok || ref.text.startsWith('-') || /[$`]/.test(ref.text)) return { bad: true }
  return { gate, ref: ref.text, refIndex: at + 2 }
}

/**
 * Find the `ac` gate call in a Bash command.
 * @returns {{kind:'none'}|{kind:'ambiguous'}|{kind:'one',gate:string,ref:string,refEnd:number,segStart:number,segEnd:number,words:object[]}}
 */
export function findGates(command) {
  if (typeof command !== 'string') return { kind: 'none' }
  const { segs, complex } = tokenize(command)
  const found = []
  let ambiguous = false
  for (const words of segs) {
    const g = readGate(words)
    if (g?.bad) ambiguous = true
    else if (g) found.push({ ...g, words })
    else if (WRAPPERS.has(base(words.find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text))?.text ?? '')) &&
      GATE_TEXT.test(words.map((w) => w.text).join(' '))) ambiguous = true
  }
  if (complex && GATE_TEXT.test(command)) ambiguous = true
  if (ambiguous || found.length > 1) return { kind: 'ambiguous' }
  if (!found.length) return { kind: 'none' }
  const f = found[0]
  return {
    kind: 'one',
    gate: f.gate,
    ref: f.ref,
    refEnd: f.words[f.refIndex].end,
    segStart: f.words[0].start,
    segEnd: f.words[f.words.length - 1].end,
    words: f.words.map((w, ix) => ({ ...w, ref: ix === f.refIndex })),
  }
}

/**
 * Splice one gate call: strip some flags (each with the one space before it, plus a following
 * value word that is not itself a flag), then insert ` <add>` right after the ref. Every other
 * byte of the command is returned unchanged.
 */
export function rewriteGate(command, hit, { add, strip = [] } = {}) {
  const refAt = hit.words.findIndex((w) => w.ref)
  const tail = command.slice(hit.refEnd)
  const cuts = []
  for (let i = refAt + 1; i < hit.words.length; i++) {
    const w = hit.words[i]
    const name = strip.find((s) => w.text === s || w.text.startsWith(`${s}=`))
    if (!name) continue
    let end = w.end
    const next = hit.words[i + 1]
    if (w.text === name && next && !next.text.startsWith('-')) { end = next.end; i++ }
    cuts.push([w.start - 1 - hit.refEnd, end - hit.refEnd])
  }
  let kept = tail
  for (const [from, to] of cuts.reverse()) kept = kept.slice(0, from) + kept.slice(to)
  return command.slice(0, hit.refEnd) + (add ? ` ${add}` : '') + kept
}

// ── typed forms ───────────────────────────────────────────────────────────────

function typedId(kind, firstWord) {
  if (!firstWord) return null
  return (kind === 'phase' ? PHASE_REF : FIX_REF).test(firstWord) ? firstWord : null
}

/**
 * A `command.run` { command, args } -> what the human typed, or null when it unlocks nothing.
 * `id` is the raw ref, or null when the id cannot be determined (empty or unreadable args).
 */
export function parseTyped(command, args) {
  if (typeof command !== 'string') return null
  const name = command.slice(command.lastIndexOf(':') + 1).replace(/^\//, '')
  const row = GATES.typed[name]
  if (!row) return null
  const first = typeof args === 'string' ? args.trim().split(/\s+/)[0] : ''
  return { gates: [...row.unlocks], kind: row.kind, id: typedId(row.kind, first) }
}

/** A composer `prompt.submit` { text } that starts with `!` and is exactly one `ac` gate call. */
export function parseBang(text) {
  if (typeof text !== 'string') return null
  const m = /^\s*!\s*([\s\S]*)$/.exec(text)
  if (!m) return null
  const hit = findGates(m[1])
  if (hit.kind !== 'one' || !GATES.bang.includes(hit.gate)) return null
  return { gates: [hit.gate], kind: GATES.kinds[hit.gate], id: hit.ref }
}

/**
 * Do a typed id and a gate's ref name the same thing? Phases compare by leading integer, fixes
 * compare whole (the date is dropped only when one side is bare). An undetermined (null) side never matches.
 */
export function idsMatch(kind, typed, ref) {
  if (typeof typed !== 'string' || typeof ref !== 'string') return false
  if (kind === 'phase') {
    if (!PHASE_REF.test(typed) || !PHASE_REF.test(ref)) return false
    const lead = (s) => Number(/^0*(\d+)/.exec(s)[1])
    return lead(typed) === lead(ref)
  }
  // A fix is witnessed only for the exact id the human typed: `ac fix accept` resolves suffixes and
  // partial ids, so `sample-bug` can land on `2026-10-12-other-sample-bug` (phase 41 verify, C3).
  if (!FIX_REF.test(typed) || !FIX_REF.test(ref)) return false
  if (typed === ref) return true
  // /astro-fix-accept takes the bare slug and the agent runs `ac fix accept <date>-<slug>`: the same
  // fix when the ref is exactly a date prefix plus what was typed (never a longer slug that merely ends with it)
  return /^\d{4}-\d{2}-\d{2}-/.test(ref) && !/^\d{4}-\d{2}-\d{2}-/.test(typed) && ref.slice(11) === typed
}

// ── the CONTEXT.md marker ─────────────────────────────────────────────────────

/** Mirrors lib/planning.mjs `classifyContext` for one line: is it a human provenance claim? */
export function isHumanMarkerLine(line) {
  // ac counts a human claim only when the whole first non-blank line IS the marker (phase 41)
  return HUMAN_MARKER.test(String(line).trim())
}

/** `<digits>-<slug>/CONTEXT.md` under `.astrocode/phases/` -> the phase number, else null. */
export function isPhaseContextPath(path) {
  if (typeof path !== 'string') return null
  const m = /(?:^|\/)\.astrocode\/phases\/(\d+)-[^/]+\/CONTEXT\.md$/.exec(path.replace(/\\/g, '/'))
  return m ? Number(m[1]) : null
}

// the first line (or first non-blank line) with its offsets; line endings stay outside it
function targetLine(text, skipBlank) {
  let pos = 0
  while (pos <= text.length) {
    const m = /^([^\r\n]*)(\r\n|\n|\r)?/.exec(text.slice(pos))
    if (!skipBlank || m[1].trim() !== '') return { start: pos, end: pos + m[1].length, line: m[1] }
    if (!m[2]) return null
    pos += m[0].length
  }
  return null
}

/**
 * The text with its human marker line rewritten to the agent marker, or null when nothing needs
 * rewriting. Write reads `content` (first NON-BLANK line, as classifyContext does); Edit reads
 * `new_string` (its first line: an Edit that opens with the marker is a provenance claim wherever
 * it lands). An agent marker is never touched, so it is never upgraded.
 */
export function markerRewrite({ tool, content, new_string } = {}) {
  const text = tool === 'Write' ? content : tool === 'Edit' ? new_string : undefined
  if (typeof text !== 'string') return null
  // Only the provenance line is rewritten: `ac phase context --author` reads the first non-blank
  // line, and a marker quoted later in the body is prose, not a claim (phase 41 verify, C6).
  const t = targetLine(text, tool === 'Write')
  if (!t || !isHumanMarkerLine(t.line)) return null
  const next = HUMAN_MARKER.test(t.line.trim()) ? AGENT_MARKER : t.line.replace(HUMAN_INLINE, AGENT_MARKER)
  return text.slice(0, t.start) + next + text.slice(t.end)
}

/**
 * An Edit's effect on the provenance line, which its own new_string can hide (deleting just
 * ` by agent: claude`, or inserting the human marker above line 1). Given the file as it is now,
 * returns the Edit rewritten to a whole-file replacement whose first non-blank line is the agent
 * marker, or null when the result does not claim human provenance or the Edit doesn't apply.
 */
export function editRewrite(current, { old_string, new_string, replace_all } = {}) {
  if (typeof current !== 'string' || typeof old_string !== 'string' || typeof new_string !== 'string' || !old_string) return null
  if (!current.includes(old_string)) return null
  const after = replace_all ? current.split(old_string).join(new_string) : current.replace(old_string, () => new_string)
  const t = targetLine(after, true)
  if (!t || !isHumanMarkerLine(t.line)) return null
  const before = targetLine(current, true)
  if (before && isHumanMarkerLine(before.line)) return null // already human: not this Edit's claim
  return { old_string: current, new_string: after.slice(0, t.start) + AGENT_MARKER + after.slice(t.end), replace_all: false }
}

/** Does the gate segment already carry a word starting with `prefix` (e.g. `--agent`)? */
export function segmentHas(hit, prefix) {
  const refAt = hit.words.findIndex((w) => w.ref)
  return hit.words.slice(refAt + 1).some((w) => w.text.startsWith(prefix))
}

/** The value word after `flag` in the gate segment, or undefined. */
export function segmentValue(hit, flag) {
  const refAt = hit.words.findIndex((w) => w.ref)
  const rest = hit.words.slice(refAt + 1)
  const i = rest.findIndex((w) => w.text === flag)
  return i === -1 ? undefined : rest[i + 1]?.text
}

/** Does the gate segment declare an agent with a real name (`--agent claude`, `--agent=claude`)? */
export function segmentDeclaresAgent(hit) {
  const refAt = hit.words.findIndex((w) => w.ref)
  const rest = hit.words.slice(refAt + 1)
  return rest.some((w, i) => {
    if (w.text.startsWith('--agent=')) return w.text.length > 8
    if (w.text !== '--agent') return false
    const v = rest[i + 1]?.text
    return typeof v === 'string' && v !== '' && !v.startsWith('-')
  })
}

// The gate verbs, whatever runs them: `ac`, `node … ac.mjs`, `$(which ac)`, a wrapper. Matching the
// verbs alone is deliberate (phase 41 verify, C2): a spelling witness can't parse is treated as
// unreadable, never as "not a gate".
export const GATE_VERBS = /\b(?:phase\s+(?:accept|reject)|fix\s+accept)\b/
const RAW_GATE = /\b(?:phase\s+(?:accept|reject)|fix\s+accept)\s+(?:\$\{?\w+\}?|[^\s'"`;&|()$<>]+)/g

/**
 * For a call findGates cannot read (`bash -c`, two gates, a variable ref): splice
 * ` --agent <name>` after every gate ref found in the raw text, unless that call already names an
 * agent. Used only when the turn is known not to be the human's typed gate. Null when nothing
 * was spliced.
 */
export function rewriteRaw(command, name = AGENT_NAME, keep = () => false) {
  if (typeof command !== 'string') return null
  let changed = false
  // A --witnessed in a call witness cannot read was not put there by witness: drop it, so a chained
  // or wrapped gate can never carry a forged human sign-off (phase 41 verify, C2).
  const bare = command.replace(/\s--witnessed(?:=[^\s'"]+|\s+[^\s'"`;&|)]+)?/g, () => { changed = true; return '' })
  const out = bare.replace(RAW_GATE, (m, at) => {
    if (keep(m.trim().split(/\s+/).pop())) return m
    const after = bare.slice(at + m.length).split(/[;&|\n"')]/)[0]
    if (/(^|\s)--agent(=|\s|$)/.test(after)) return m // any declared --agent, even bare or empty, is left alone
    changed = true
    return `${m} --agent ${name}`
  })
  return changed ? out : null
}
