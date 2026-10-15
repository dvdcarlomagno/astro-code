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
// Phase 46 closed three holes in this file (the debts are named where each rule lives): a gate verb
// held in a shell variable (`V=accept; ac phase $V 41`) is now VAR_VERB and is signed; a quoted
// mention behind an `ac` head (`ac decision add "… \"phase accept 41\" …"`) is left alone; and a
// Bash write of the human CONTEXT.md marker is rewritten like a Write/Edit (`bashMarkerRewrite`).
// Still gaps, and the safe direction: a CONTEXT.md path held in a variable, a `cd` followed by a
// bare `CONTEXT.md`, a marker split across quoting, and a quoted runner word (`"bash" -c …`).
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
  // A verb held in a variable (`ac phase $V 41`, `ac $X accept 41`) cannot be read: ambiguous, so the
  // caller signs it as the agent (debt 2026-10-12-witness-assigning-the-gate-verb-to-a). `ac phase show $N`
  // has a plain verb and stays a non-gate.
  const dyn = (w) => /[$`]/.test(w ?? '')
  if (((a === 'phase' || a === 'fix') && dyn(b)) || (dyn(a) && (b === 'accept' || b === 'reject'))) return { bad: true }
  const gate = a === 'phase' && (b === 'accept' || b === 'reject') ? `phase ${b}` : a === 'fix' && b === 'accept' ? 'fix accept' : null
  if (!gate) return null
  // flags may come before the ref (`ac phase accept --evidence "DEC-1" 41`): a value flag eats its value
  let r = at + 2
  // (only the known value flags: any other flag before the ref, `--force` included, stays unreadable)
  while (words[r] && (VALUE_FLAGS.has(words[r].text) || VALUE_FLAGS.has(words[r].text.split('=')[0]))) r += words[r].text.includes('=') ? 1 : 2
  const ref = words[r]
  if (!ref) return null
  const ok = (GATES.kinds[gate] === 'phase' ? PHASE_REF : FIX_REF).test(ref.text)
  if (!ok || ref.text.startsWith('-') || /[$`]/.test(ref.text)) return { bad: true }
  return { gate, ref: ref.text, refIndex: r, verbIndex: at + 1 }
}

// The gate flags that take a separate value word; ac's own parser reads them the same way.
const VALUE_FLAGS = new Set(['--evidence', '--reason', '--agent', '--witnessed'])

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
    words: f.words.map((w, ix) => ({ ...w, ref: ix === f.refIndex, verb: ix === f.verbIndex })),
  }
}

/**
 * Splice one gate call: strip some flags (each with the one space before it, plus a following
 * value word that is not itself a flag), then insert ` <add>` right after the ref. Every other
 * byte of the command is returned unchanged.
 */
export function rewriteGate(command, hit, { add, strip = [] } = {}) {
  // flags are stripped wherever they stand after the verb, before or after the ref
  const verbAt = hit.words.findIndex((w) => w.verb)
  const from = verbAt >= 0 ? verbAt + 1 : hit.words.findIndex((w) => w.ref) + 1
  const edits = add ? [[hit.refEnd, hit.refEnd, ` ${add}`]] : []
  for (let i = from; i < hit.words.length; i++) {
    const w = hit.words[i]
    if (w.ref) continue
    const name = strip.find((s) => w.text === s || w.text.startsWith(`${s}=`))
    if (!name) continue
    let end = w.end
    const next = hit.words[i + 1]
    if (w.text === name && next && !next.ref && !next.text.startsWith('-')) { end = next.end; i++ }
    edits.push([w.start - 1, end, ''])
  }
  let out = command
  for (const [a, b, text] of edits.sort((x, y) => y[0] - x[0] || y[1] - x[1])) out = out.slice(0, a) + text + out.slice(b)
  return out
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
    // A slug-shaped ref (`41-x`) is safe to read by its leading number: ac's findPhase never resolves
    // a `<digits>-…` ref by phase NAME (phase 41 verify, C2 d), so it can only be phase 41's slug.
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
  // `phases//41-x`, `/./`, `/../` and a case-insensitive filesystem all reach the same file (phase 41 C6)
  const out = []
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') { if (out.length === 0) out.push(''); continue }
    if (seg === '..') { if (out.length > 1 || (out.length === 1 && out[0] !== '')) out.pop(); continue }
    out.push(seg)
  }
  const m = /(?:^|\/)\.astrocode\/phases\/(\d+)-[^/]+\/CONTEXT\.md$/i.exec(out.join('/'))
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
// The gate's flag words: everything after the verb except the ref, so a flag before the ref counts too.
function flagWords(hit) {
  const verbAt = hit.words.findIndex((w) => w.verb)
  const from = verbAt >= 0 ? verbAt + 1 : hit.words.findIndex((w) => w.ref) + 1
  return hit.words.slice(from).filter((w) => !w.ref)
}

export function segmentHas(hit, prefix) {
  return flagWords(hit).some((w) => w.text.startsWith(prefix))
}

/** The value word after `flag` in the gate segment, or undefined. */
export function segmentValue(hit, flag) {
  const rest = flagWords(hit)
  const i = rest.findIndex((w) => w.text === flag)
  return i === -1 ? undefined : rest[i + 1]?.text
}

/** Does the gate segment declare an agent with a real name (`--agent claude`, `--agent=claude`)? */
export function segmentDeclaresAgent(hit) {
  const rest = flagWords(hit)
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
export const RAW_SEES = /\b(?:phase\s+(?:accept|reject)|fix\s+accept)\s+[^\s'"`;&|()<>]/
export const GATE_VERBS = /\b(?:phase\s+(?:accept|reject)|fix\s+accept)\b/
// What the shell will see once quotes and line continuations are gone: `phase "accept" 41` and
// `phase \\<newline>accept` are the same gate (phase 41 verify, C2/C3).
// A gate verb held in a shell variable: `ac phase $V 41`, `ac fix "$G" id`, `ac $X accept 41`, an expansion
// anywhere in the verb word (`ac phase acc$V 41`), an xargs slot (`ac phase {} 41`), or the same inside a
// quoted `eval "…"` body. witness cannot know which verb runs, so such a call is signed as the agent
// (phase 46, ADR-081 hole closed).
export const VAR_VERB = /(?:^|[\s;&|("'])(?:\S*\/)?(?:ac|ac\.mjs)\s+(?:(?:phase|fix)\s+[^\s;&|()]*[$`{]|["']?[$`])/
export const shellText = (s) => String(s).replace(/\\\r?\n/g, ' ').replace(/["'\\]/g, '')

// Anything that can run text it was handed: a shell or interpreter, eval, a remote or deferred
// runner, a substitution. With none of these in the command, quoted text is only ever data.
const RUNS_TEXT = /(?:^|[\s;&|(])(?:\S*\/)?(?:sh|bash|zsh|dash|ksh|fish|eval|exec|source|\.|xargs|env|ssh|host|node|deno|bun|python3?|perl|ruby|php|osascript|watch|timeout|nohup|sudo|parallel)(?=[\s;&|)]|$)|\$\(|`|<<<|<\(/

/**
 * A command that names a gate only inside quoted text, and holds nothing that could run that
 * text (`echo "… phase accept 12 --agent claude"`, `grep "phase accept" docs`, `git commit -m "… phase accept … --agent claude"`):
 * a mention, not a gate call, so witness leaves it as written. A gate word outside quotes, or any
 * runner (`bash -c "…"`, `ssh host "…"`, `$(…)`), keeps it unreadable.
 */
export function onlyQuotedMention(command) {
  const s = String(command)
  if (RUNS_TEXT.test(s)) return false
  // Quoted spans become a placeholder TOKEN, not a space, so `ac "phase" "accept" 4` still reads as an
  // `ac` followed by something that is not a plain subcommand word.
  const unquoted = s.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ' \u0001 ')
  // An unquoted `ac` is a mention only when the word right after it is a plain subcommand other than
  // `phase`/`fix` (`ac decision add "… \"phase accept 41\" …"`): the ADR-080 corruption was witness
  // splicing `--agent` into such a title. `ac $X accept 41`, `ac "phase" …`, a bare trailing `ac` stay
  // unreadable.
  const head = /(?:^|[\s;&|(])(?:\S*\/)?(?:ac|astrocode|ac\.mjs)(?=[\s;&|)]|$)\s*(\S*)/g
  for (const m of unquoted.matchAll(head)) {
    if (!/^[a-z][a-z-]*$/.test(m[1]) || m[1] === 'phase' || m[1] === 'fix') return false
  }
  return !GATE_VERBS.test(shellText(unquoted))
}

/**
 * Last resort for a gate witness cannot parse even on the raw text: drop any --witnessed (quoted or
 * not) and append ` --agent <name>` to every top-level segment whose shell text names a gate and
 * declares no agent. Never a human sign-off by default.
 */
/**
 * The command with every `--witnessed[=v| v]` removed (the value may be quoted), or null when it held
 * none. The ONE place that regex lives: a `--witnessed` witness did not put there is a forged human
 * claim. A following word is eaten only when it is a value, never the next flag.
 */
export function dropWitnessed(command) {
  if (typeof command !== 'string') return null
  const out = command.replace(/\s--witnessed(?:=(?:"[^"]*"|'[^']*'|[^\s;&|)]+)|\s+(?:"[^"]*"|'[^']*'|[^\s'"`;&|)-][^\s'"`;&|)]*))?/g, '')
  return out === command ? null : out
}

// Every `<shell> … -c '<body>'` in a command, wherever the shell stands (`/bin/bash`, `env bash`,
// `x=1 sh -lc`) and whatever follows the string: [{ start, end }] of the body, quotes excluded.
const SHELL_C = /(?:^|[\s;&|(])(?:\S*\/)?(?:bash|sh|zsh|dash|ksh)((?:\s+-[A-Za-z]+)+)\s+(["'])/g
function shellBodies(command) {
  const out = []
  for (const m of command.matchAll(SHELL_C)) {
    if (!/c/.test(m[1].replace(/\s+-/g, ''))) continue
    const q = m[2]
    const start = m.index + m[0].length
    let i = start
    while (i < command.length && command[i] !== q) i += q === '"' && command[i] === '\\' ? 2 : 1
    if (i >= command.length || out.some((b) => start < b.end)) continue
    out.push({ start, end: i })
  }
  return out
}

export function signSegments(command, name = AGENT_NAME) {
  // A shell `-c` string first: the signature goes inside it (after it, it is the inner shell's $0),
  // and the string is kept whole while the outer command is split (`bash -c "cd . && ac phase $V 1"`).
  let text = String(command)
  let changed = false
  const held = []
  for (const b of shellBodies(text).reverse()) {
    const body = text.slice(b.start, b.end)
    const signed = signSegments(body, name)
    if (signed !== null) changed = true
    held.unshift(signed ?? body)
    text = text.slice(0, b.start) + `\u0000${held.length - 1}\u0000` + text.slice(b.end)
  }
  // placeholders were numbered back to front; renumber them front to back to match `held`
  let k = 0
  text = text.replace(/\u0000\d+\u0000/g, () => `\u0000${k++}\u0000`)
  const restore = (s) => s.replace(/\u0000(\d+)\u0000/g, (_, j) => held[Number(j)])
  const parts = text.split(/(&&|\|\||;|\||(?<!\\)\n)/) // a backslash-newline continues the segment
  const out = parts.map((p, i) => {
    if (i % 2 === 1) return p
    // a pure assignment (`export V="phase accept"`) runs nothing: the `ac $V` segment carries the signature --agent claude
    if (/^\s*(?:(?:export|declare|typeset|local|readonly)\s+(?:-\w+\s+)*)?\w+=\S*(?:"[^"]*"|'[^']*')?\s*$/.test(p) && !/(?:^|[\s"'=])(?:\S*\/)?(?:ac|ac\.mjs)\s/.test(p)) return p
    const t = shellText(p)
    if (!GATE_VERBS.test(t) && !VAR_VERB.test(p)) return p
    const dropped = dropWitnessed(p)
    if (dropped !== null) changed = true
    const q = dropped ?? p
    if (/(^|\s)--agent(=|\s|$)/.test(shellText(q))) return q
    changed = true
    // `(ac phase $V 41)`, `(cd x; ac phase $V 41)`: the signature goes inside the subshell, before the
    // closing parens that belong to a leading `(` or to one opened in an earlier segment
    const n = (re) => (q.match(re) || []).length
    const lead = n(/^\s*\(+/g) && /^\s*(\(+)/.exec(q)[1].length
    const move = Math.min(n(/(?:\)\s*)+$/g) && /((?:\)\s*)+)$/.exec(q)[1].split(')').length - 1, lead + Math.max(0, n(/\)/g) - n(/\(/g)))
    let tail = /\s*$/.exec(q)[0]
    if (move) { let k = 0, at = q.length; while (k < move) if (q[--at] === ')') k++; tail = q.slice(at) }
    return q.slice(0, q.length - tail.length) + ` --agent ${name}` + tail
  })
  return changed ? restore(out.join('')) : null
}
const RAW_GATE = /\b(?:phase\s+(?:accept|reject)|fix\s+accept)(?:\s+--(?:evidence|reason|agent|witnessed)(?:=(?:"[^"]*"|'[^']*'|[^\s;&|)]+)|\s+(?:"[^"]*"|'[^']*'|[^\s'"`;&|()<>-][^\s;&|)]*))|\s+--?[A-Za-z][\w-]*(?:=[^\s;&|)]*)?)*\s+(?:\$\{?\w+\}?|[^\s'"`;&|()$<>-][^\s'"`;&|()$<>]*)/g

/**
 * For a call findGates cannot read (`bash -c`, two gates, a variable ref): splice
 * ` --agent <name>` after every gate ref found in the raw text, unless that call already names an
 * agent. Used only when the turn is known not to be the human's typed gate. Null when nothing
 * was spliced.
 */
export function rewriteRaw(command, name = AGENT_NAME, keep = () => false) {
  if (typeof command !== 'string') return null
  // A --witnessed in a call witness cannot read was not put there by witness: drop it, so a chained
  // or wrapped gate can never carry a forged human sign-off (phase 41 verify, C2).
  const dropped = dropWitnessed(command)
  let changed = dropped !== null
  const bare = dropped ?? command
  const out = bare.replace(RAW_GATE, (m, at) => {
    if (keep(m.trim().split(/\s+/).pop())) return m
    const after = bare.slice(at + m.length).split(/[;&|\n"')]/)[0]
    if (/(^|\s)--agent(=|\s|$)/.test(after) || /\s--agent(=|\s|$)/.test(m)) return m // any declared --agent, even bare or empty, is left alone
    changed = true
    return `${m} --agent ${name}`
  })
  return changed ? out : null
}

/**
 * A Bash command that writes the human CONTEXT.md marker into a phase's CONTEXT.md (`printf '…' > ctx`,
 * `sed -i '1s/^.*$/<marker>/' ctx`, `cat > ctx <<'EOF'`), as `{ command, phases }` with every inline
 * human marker replaced by the agent marker, or null. Write/Edit were witnessed already; a Bash
 * write was not (debt 2026-10-12-witness-a-bash-write-of-the-human). Both must hold: the raw text
 * carries the marker AND some token (split on whitespace, quotes and `;&|<>()`) is a phase CONTEXT.md
 * path. A `grep` that merely reads the marker is a false positive that writes no file. The agent
 * marker has no `/ & ' " % \`, so it stays valid inside `sed s///`, `printf` and a heredoc. Gaps (safe
 * direction): a path in a variable, `cd` then a bare `CONTEXT.md`, a marker split across quoting.
 */
export function bashMarkerRewrite(command) {
  if (typeof command !== 'string') return null
  const inline = new RegExp(HUMAN_INLINE.source, 'i').test(command)
  // the marker split by printf's format (`printf '<!-- astro-discuss: %s -->\n' captured`): the word is the claim
  const split = !inline && /astro-discuss:/i.test(command) && /(^|[^\w-])captured(?![\w-]| by agent)/i.test(command)
  if (!inline && !split) return null
  const phases = new Set()
  let unknown = false
  for (const tok of command.split(/[\s'"`;&|<>()=]+/)) {
    const n = isPhaseContextPath(tok)
    if (n !== null) phases.add(n)
    // `cd <phase dir> && … > CONTEXT.md`, `> "$F/CONTEXT.md"`: the file cannot be told, so it is never the human's
    else if (/^(?:\.\/)?CONTEXT\.md$/i.test(tok) || (/\$/.test(tok) && /CONTEXT\.md$/i.test(tok))) unknown = true
  }
  if (!phases.size && !unknown) return null
  const out = inline ? command.replace(HUMAN_INLINE, AGENT_MARKER) : signCapturedWord(command)
  return { command: out, phases: [...phases].sort((x, y) => x - y), unknown }
}

// The bare word `captured` (printf's format split) turned into the agent claim, quoted for where it
// stands: inside quotes the spaces are literal; outside them they are escaped, so the claim stays ONE
// shell word. `printf "<!-- astro-discuss: "captured" -->\nbody\n"`: the inner quotes close and reopen
// the outer string, and an unescaped space there used to split the format and lose the body.
function signCapturedWord(command) {
  const re = /\bcaptured\b(?! by agent)/gi
  let m
  while ((m = re.exec(command)) !== null) {
    let q = null
    for (let i = 0; i < m.index; i++) {
      const c = command[i]
      if (q === "'") { if (c === "'") q = null }
      else if (c === '\\') i++
      else if (q === '"') { if (c === '"') q = null }
      else if (c === "'" || c === '"') q = c
    }
    const claim = q ? `captured by agent: ${AGENT_NAME}` : `captured\\ by\\ agent:\\ ${AGENT_NAME}`
    return command.slice(0, m.index) + claim + command.slice(m.index + m[0].length)
  }
  return command
}

/** Every phase CONTEXT.md path a Bash command names (split on whitespace, quotes and `;&|<>()=`). */
export function contextPathsIn(command) {
  const out = new Set()
  for (const tok of String(command).split(/[\s'"`;&|<>()=]+/)) if (isPhaseContextPath(tok) !== null) out.add(tok)
  return [...out]
}

// A command that can change a file: a redirect, an in-place editor, a copier, an interpreter, git.
const MAY_WRITE = /(?:^|[^<0-9&])>|\b(?:sed|perl|ruby)\b[^;&|\n]*\s(?:-[a-zA-Z]*i|--in-place)|\b(?:tee|cp|mv|install|dd|rsync|ln|truncate|ed|ex|vim?|node|deno|bun|python3?|php|git|patch|awk|gawk)\b/

/**
 * A Bash call judged by its EFFECT on line 1 of each phase CONTEXT.md it names (phase 46 C8): line 1 is
 * read before the command runs; if the command leaves the human marker there and it was not there
 * before, line 1 becomes the agent marker. Text matching cannot see `sed -i '1d'`, `capt\x75red` or a
 * file copied in from /tmp; the effect check can. The command's own exit status is kept. Null when
 * the command names no such path or cannot write.
 */
export function effectGuard(command) {
  if (typeof command !== 'string' || !MAY_WRITE.test(command)) return null
  const paths = contextPathsIn(command)
  if (!paths.length) return null
  const at = (p) => (p.startsWith('/') ? `'${p}'` : `"$__ww"/'${p}'`)
  const before = paths.map((p, i) => `__w${i}=$(head -n 1 ${at(p)} 2>/dev/null)`).join('; ')
  const js = `const fs=require("fs");const H=/^<!--\\s*astro-discuss:\\s*captured\\s*-->$/i;const a=process.argv.slice(1);` +
    `for(let i=0;i<a.length;i+=2){try{const t=fs.readFileSync(a[i],"utf8");const n=t.search(/\\r?\\n/);const l=n<0?t:t.slice(0,n);` +
    `if(H.test(l.trim())&&!H.test(String(a[i+1]).trim()))fs.writeFileSync(a[i],${JSON.stringify(AGENT_MARKER)}+(n<0?"":t.slice(n)))}catch{}}`
  const args = paths.map((p, i) => `${at(p)} "$__w${i}"`).join(' ')
  return `__ww=$PWD; ${before}\n${command}\n__ws=$?; node -e '${js}' ${args} 2>/dev/null; (exit $__ws)`
}
