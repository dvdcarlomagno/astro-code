// blindfold -- keeps `astro-verifier` and `astro-criteria-author` plan-blind, enforced per agent
// (phase 39, ADR-071 kind `mod`).
//
// The rule is not new, it is enforced here: ADR-021 makes CRITERIA.md the bar and the plan
// off-limits to whoever grades or authors it, and the two agent files already say so in prose
// (`agents/astro-verifier.md` "Do NOT read `PLAN.md`. Do NOT read `SPEC.md`.";
// `agents/astro-criteria-author.md` "Do NOT read `PLAN.md`, `ACCEPTANCE.md`, or `SPEC.md`").
// RULE quotes those two lines verbatim and a test ties it to the files, so the prose stays the
// doctrine and this module is its guardrail. FORBIDDEN is the one table of forbidden files.
//
// Who is who: the join. `tool.check` carries only the calling loop's `agentId`; the agent TYPE
// is on `agent.spawn` (`subagentType`). PROBE.md (phase 39) observed on Claude Code 2.1.292 that
// `$.agent.list()` names an Agent-tool agent but NOT a Workflow-spawned one (the list is empty on
// its first tool call), whereas the value `next(e)` settles with on `agent.spawn` carries the
// SAME `agentId` that agent's later `tool.check` events carry, on both spawn paths. So the join
// is the spawn result: `agentSpawn` pairs `r.agentId` with `e.subagentType` in a Map. The Map is
// in memory only, never persisted (ADR-071 c), and register() clears it. Only the two plan-blind
// types are stored, so every other agent (executors, planners, researchers, workflow-subagent,
// general-purpose) and the main loop (no `agentId`) fall through untouched.
//
// Fail open (ADR-071 e): an agent this module cannot identify -- spawned before the plugin
// loaded, or after a /reload-plugins -- is allowed, silently, because that is the normal case
// for every agent that is not plan-blind. A spawn hook that throws or overruns goes to the
// registered `.catch(failOpen)`, which lets the action through, says so once and turns every
// switch off until the next session. Nothing here ever answers its own `allow`: ALLOWED means
// what `next(e)` resolved to, so a user's own permission rules still apply.
//
// A hit is a `deny`, not an `ask`: a subagent cannot answer a prompt. The reason quotes ADR-021
// and the agent's own line, names the refused file, and points at CRITERIA.md. It never names the
// way to switch the guard off -- that is for the human, not for the agent being held back.
//
// This is a mistake-catcher, not a sandbox. It reads the tool input as text: Read/Edit/notebook
// paths, Grep and Glob arguments, and a Bash command through its OWN quote-aware tokenizer (not
// imported from hooks/astro-canon-guard.mjs: the plugin ships separately from the hooks, and mods
// are plain .js). It does NOT see: `$(...)`, backticks, `eval`, `xargs`, or reads from
// `python -c` / `node -e`; symlinks; a search rooted at a path that neither contains
// `.astrocode` nor exists as the plugin can tell; MCP search tools with no `path`/`command`.
//
// All matching is string logic -- no Node module -- so every case is a table row in the tests.
// The `$.session.cwd()` and `$.fs.exists()` calls are spelled in this file; `$` is never handed
// to an imported helper (the plugin validator follows `$` only through functions declared here).
import { isOn } from '../lib/switches.js'

/** The one table of forbidden files, per role, lowercase (matching is case-insensitive). */
export const FORBIDDEN = Object.freeze({
  'astro-verifier': Object.freeze(['plan.md', 'spec.md']),
  'astro-criteria-author': Object.freeze(['plan.md', 'acceptance.md', 'spec.md']),
})

/** Each role's own "Do NOT read" line, verbatim from its agent file. */
export const RULE = Object.freeze({
  'astro-verifier': 'Do NOT read `PLAN.md`. Do NOT read `SPEC.md`.',
  'astro-criteria-author': 'Do NOT read `PLAN.md`, `ACCEPTANCE.md`, or `SPEC.md`',
})

const UNION = Object.freeze(['plan.md', 'acceptance.md', 'spec.md'])
const GLOB_CHARS = /[*?[{]/

// agentId -> plan-blind agent type, filled by agentSpawn. In memory only.
const spawned = new Map()

/** register() starts a clean slate. */
export function resetBlindfold() {
  spawned.clear()
}

// ── paths ───────────────────────────────────────────────────────────────────

// Lexical normalisation: `\` is `/`, runs of `/` collapse, `.` and `..` resolve, a trailing `/`
// goes. `segs` keeps the case as written, `low` is lowercase for comparing.
function norm(path) {
  const s = String(path).replace(/\\/g, '/')
  const abs = s.startsWith('/') || /^[a-zA-Z]:\//.test(s)
  const segs = []
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (segs.length && segs[segs.length - 1] !== '..') segs.pop()
      else if (!abs) segs.push('..')
    } else segs.push(seg)
  }
  return { abs, segs, low: segs.map((x) => x.toLowerCase()) }
}

// A tiny glob -> RegExp: `**`, `*`, `?`, `[...]`, `{a,b}`; case-insensitive; dots match.
function globRe(glob) {
  let out = ''
  let depth = 0
  const g = String(glob)
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++
        if (g[i + 1] === '/') { i++; out += '(?:.*/)?' } else out += '.*'
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else if (c === '[') {
      const j = g.indexOf(']', i + 2)
      if (j < 0) out += '\\['
      else { out += '[' + (g[i + 1] === '!' ? '^' + g.slice(i + 2, j) : g.slice(i + 1, j)).replace(/\\/g, '\\\\') + ']'; i = j }
    } else if (c === '{') { depth++; out += '(?:' } else if (c === '}' && depth) { depth--; out += ')' } else if (c === ',' && depth) out += '|'
    else out += c.replace(/[.+^$()|\\/-]/g, '\\$&')
  }
  try { return new RegExp('^' + out + '$', 'i') } catch { return /^$/ }
}

// Could this glob select one of the forbidden names (at any depth)?
function canMatchName(glob, names) {
  const re = globRe(glob)
  return names.some((n) => re.test(n) || re.test('d/' + n) || re.test('d/d/' + n))
}

// A glob list (`-g`, `--include`, the Grep tool's `glob`) narrows a search when it excludes the
// phases tree, or when every positive pattern is unable to select a forbidden file.
function narrowsByGlob(list, names) {
  const parts = String(list).split(/\s+/).filter(Boolean)
  if (!parts.length) return false
  const re = (p) => globRe(p)
  for (const p of parts) {
    if (!p.startsWith('!')) continue
    const body = p.slice(1)
    if (/(^|\/)(\.astrocode|phases)(\/|$)/.test(body) || names.every((n) => re(body).test(n))) return true
  }
  const positive = parts.filter((p) => !p.startsWith('!'))
  return positive.length > 0 && positive.every((p) => !canMatchName(p, names))
}

// `<...>/.astrocode/phases/<dir>/<...>/<file>` with a forbidden basename (or a glob that selects one).
function fileHit(path, names) {
  if (typeof path !== 'string' || !path) return null
  const { segs, low } = norm(path)
  let inPhase = false
  for (let i = 0; i + 3 < low.length; i++) if (low[i] === '.astrocode' && low[i + 1] === 'phases') { inPhase = true; break }
  if (!inPhase) return null
  const base = low[low.length - 1]
  const forbidden = names.includes(base) || (GLOB_CHARS.test(base) && names.some((n) => globRe(base).test(n)))
  return forbidden ? segs[segs.length - 1] : null
}

function namesPhaseDir(word) {
  const { low } = norm(word)
  for (let i = 0; i + 2 < low.length; i++) if (low[i] === '.astrocode' && low[i + 1] === 'phases') return true
  return false
}

// How a search root relates to the phases tree, decidable from the text alone:
// astrocode | phases | phasedir | file | other | null (cannot tell without the cwd).
function classify(root) {
  const { abs, low } = norm(root)
  const i = low.indexOf('.astrocode')
  if (i >= 0) {
    if (i === low.length - 1) return 'astrocode'
    if (low[i + 1] !== 'phases') return 'other'
    if (low.length === i + 2) return 'phases'
    if (low.length === i + 3) return 'phasedir'
    return /\.[^/]+$/.test(low[low.length - 1]) ? 'file' : 'phasedir'
  }
  if (!abs && low.every((x) => x === '..')) return 'cwd'
  return null
}

// Does a search rooted at `root` reach the phases tree? One of the kinds above, 'cwd',
// 'ancestor', 'exists', or null. A failing cwd/exists lookup reads as "unknown", never as an error:
// only the join is fail-open-with-notice.
async function reaches($, root) {
  const kind = classify(root)
  if (kind === 'file' || kind === 'other') return null
  if (kind) return kind
  let cwd
  try { cwd = await $.session.cwd() } catch { return null }
  if (typeof cwd !== 'string' || !cwd) return null
  const here = norm(cwd)
  const r = norm(root)
  const full = r.abs ? r : norm(cwd + '/' + root)
  const again = classify('/' + full.segs.join('/'))
  if (again === 'file' || again === 'other') return null
  if (again) return again
  const prefix = full.low.every((x, i) => here.low[i] === x)
  if (prefix) return 'ancestor'
  try {
    if (await $.fs.exists('/' + full.segs.join('/') + '/.astrocode/phases')) return 'exists'
  } catch {
    return null
  }
  return null
}

// ── Bash ────────────────────────────────────────────────────────────────────

// Quote-aware split of a command line into segments of words. Unquoted `; & | ( ) newline` end a
// segment; `< >` only end a word, so a redirect target is a word of its own.
function tokenize(cmd) {
  const segs = [[]]
  let word = null
  const push = () => { if (word !== null) { segs[segs.length - 1].push(word); word = null } }
  const cut = () => { push(); if (segs[segs.length - 1].length) segs.push([]) }
  const s = String(cmd)
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'") {
      const j = s.indexOf("'", i + 1)
      const end = j < 0 ? s.length : j
      word = (word ?? '') + s.slice(i + 1, end)
      i = end
    } else if (c === '"') {
      word = word ?? ''
      i++
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) { word += s[i + 1]; i += 2 } else { word += s[i]; i++ }
      }
    } else if (c === '\\') {
      if (i + 1 < s.length) { word = (word ?? '') + s[i + 1]; i++ }
    } else if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')') cut()
    else if (c === ' ' || c === '\t' || c === '<' || c === '>') push()
    else word = (word ?? '') + c
  }
  push()
  return segs.filter((x) => x.length)
}

const base = (word) => String(word).replace(/\\/g, '/').split('/').pop()
const WRAPPERS = new Set(['env', 'command', 'exec', 'time', 'nohup', 'sudo'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash'])
const RAW_PLAN = /\.astrocode\/phases\/[^/\s'"]+\/(?:[^\s'"]*\/)?(?:plan|spec|acceptance)\.md/i

// Flags that take the next word as their value, per search tool.
const VALUE_FLAGS = {
  grep: new Set(['-e', '-f', '-m', '-A', '-B', '-C', '-d', '-D', '--include', '--exclude', '--exclude-dir', '--regexp', '--file', '--max-count', '--directories']),
  rg: new Set(['-e', '-f', '-g', '-t', '-T', '-m', '-A', '-B', '-C', '-j', '-M', '-E', '-r', '-d', '--glob', '--iglob', '--type', '--type-not', '--regexp', '--file', '--max-count', '--max-depth', '--threads', '--context', '--after-context', '--before-context', '--replace', '--encoding', '--sort', '--sortr']),
  ag: new Set(['-A', '-B', '-C', '-G', '-m', '--depth', '--ignore', '--ignore-dir']),
  fd: new Set(['-e', '-E', '-t', '-d', '-x', '-X', '-S', '-c', '-j', '--extension', '--exclude', '--type', '--max-depth', '--size', '--color', '--threads']),
}
const PATTERN_FLAGS = new Set(['-e', '-f', '--regexp', '--file'])
const SEARCHERS = { grep: 'grep', egrep: 'grep', fgrep: 'grep', rg: 'rg', ag: 'ag', ack: 'ag', fd: 'fd', fdfind: 'fd' }
const RECURSIVE_GREP = /^(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive|--directories=recurse)$/

// Split a search command's arguments into operands and filters. A filter is `{ name, value }`.
function parseArgs(args, flags) {
  const operands = []
  const filters = []
  let patternFlag = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') { operands.push(...args.slice(i + 1)); break }
    if (a.length > 1 && a.startsWith('-')) {
      const eq = a.startsWith('--') ? a.indexOf('=') : -1
      let name = a
      let value
      if (eq > 0) { name = a.slice(0, eq); value = a.slice(eq + 1) } else if (flags.has(a)) value = args[++i]
      else if (/^-[a-zA-Z]+$/.test(a) && flags.has('-' + a[a.length - 1])) { name = '-' + a[a.length - 1]; value = args[++i] }
      if (PATTERN_FLAGS.has(name)) patternFlag = true
      filters.push({ name, value })
    } else operands.push(a)
  }
  return { operands, filters, patternFlag }
}

// Decide a recursive search: returns its roots when nothing narrows it, else [].
function searchRoots(kind, cmd, args, names) {
  if (kind === 'find') {
    const roots = []
    let i = 0
    while (i < args.length && !/^(-|\(|!)/.test(args[i])) roots.push(args[i++])
    for (; i < args.length; i++) {
      if ((args[i] === '-name' || args[i] === '-iname') && args[i + 1] !== undefined && !canMatchName(args[i + 1], names)) return []
    }
    return roots.length ? roots : ['.']
  }
  const flagSet = VALUE_FLAGS[kind === 'git' ? 'grep' : kind] || new Set()
  const { operands, filters, patternFlag } = parseArgs(args, flagSet)
  for (const { name, value } of filters) {
    if (value === undefined) continue
    if (kind === 'grep' || kind === 'git') {
      if (name === '--include' && !canMatchName(value, names)) return []
      if (name === '--exclude-dir' && (globRe(value).test('.astrocode') || globRe(value).test('phases'))) return []
    } else if (kind === 'rg') {
      if ((name === '-g' || name === '--glob' || name === '--iglob') && narrowsByGlob(value, names)) return []
      if ((name === '-t' || name === '--type') && !/^(md|markdown)$/i.test(value)) return []
    } else if (kind === 'fd') {
      if ((name === '-e' || name === '--extension') && !/^md$/i.test(value)) return []
      if ((name === '-E' || name === '--exclude') && (globRe(value).test('.astrocode') || globRe(value).test('phases'))) return []
    } else if (kind === 'ag' && (name === '--ignore-dir' || name === '--ignore') && /astrocode|phases/.test(value)) return []
  }
  const paths = patternFlag ? operands : operands.slice(1)
  return paths.length ? paths : ['.']
}

// One command line (and, to depth 3, the `bash -c` / `lean-ctx -c` strings inside it).
function bashScan(command, names, out, phaseNamed, depth) {
  const segments = tokenize(command)
  const named = phaseNamed || segments.some((seg) => seg.some(namesPhaseDir))
  for (const words of segments) {
    for (const w of words) {
      const tail = (ch) => (w.includes(ch) ? w.slice(w.lastIndexOf(ch) + 1) : '')
      for (const cand of [w, tail(':'), tail('=')]) {
        if (!cand) continue
        const hit = fileHit(cand, names)
        if (hit) { out.hits.push(hit); continue }
        if (named && !cand.includes('/') && !cand.includes('\\') && (names.includes(cand.toLowerCase()) || (GLOB_CHARS.test(cand) && names.some((n) => globRe(cand).test(n))))) out.hits.push(cand)
      }
    }
    let i = 0
    while (i < words.length) {
      const w = words[i]
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue }
      if (WRAPPERS.has(base(w))) {
        i++
        while (i < words.length && words[i].startsWith('-')) i++
        continue
      }
      break
    }
    if (i >= words.length) continue
    const cmd = base(words[i])
    const args = words.slice(i + 1)
    if (SHELLS.has(cmd) || cmd === 'lean-ctx') {
      const ci = args.findIndex((a) => (cmd === 'lean-ctx' ? a === '-c' : /^-[a-z]*c[a-z]*$/.test(a)))
      if (ci >= 0 && args[ci + 1] !== undefined) {
        if (depth < 3) bashScan(args[ci + 1], names, out, named, depth + 1)
        else if (RAW_PLAN.test(args[ci + 1])) out.hits.push('PLAN.md')
      }
      continue
    }
    let kind = SEARCHERS[cmd]
    if (kind === 'grep' && !args.some((a) => RECURSIVE_GREP.test(a)) && args[args.indexOf('-d') + 1] !== 'recurse') kind = undefined
    if (cmd === 'find') kind = 'find'
    if (cmd === 'git') {
      let j = 0
      while (j < args.length && args[j].startsWith('-')) j += /^(-C|-c|--git-dir|--work-tree|--exec-path)$/.test(args[j]) ? 2 : 1
      if (args[j] === 'grep') { kind = 'git'; out.roots.push(...searchRoots('git', cmd, args.slice(j + 1), names).map((root) => ({ root }))); continue }
    }
    if (kind) out.roots.push(...searchRoots(kind, cmd, args, names).map((root) => ({ root })))
  }
}

// ── what a tool call touches ────────────────────────────────────────────────

// Sync half of the judgement: `hits` are forbidden file names already named; `roots` are
// unnarrowed searches whose reach still has to be asked of the session (see `firstReach`).
function scan(e, names) {
  const input = e && e.input && typeof e.input === 'object' ? e.input : {}
  const out = { hits: [], roots: [] }
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const hit = fileHit(input[key], names)
    if (hit) out.hits.push(hit)
  }
  const root = typeof input.path === 'string' && input.path ? input.path : '.'
  if (e.tool === 'Grep') {
    const narrowed = (typeof input.glob === 'string' && narrowsByGlob(input.glob, names))
      || (typeof input.type === 'string' && !/^(md|markdown)$/i.test(input.type))
    if (!narrowed) out.roots.push({ root })
  } else if (e.tool === 'Glob' && typeof input.pattern === 'string') {
    const hit = fileHit(input.pattern.replace(/^\.\//, ''), names)
    if (hit) out.hits.push(hit)
    out.roots.push({ root, glob: input.pattern.replace(/^\.\//, ''), names })
  }
  if (typeof input.command === 'string') bashScan(input.command, names, out, false, 0)
  return out
}

// Candidate paths, relative to a root of each kind, that a Glob could return.
function candidates(kind, names) {
  const f = (prefix) => names.map((n) => prefix + n)
  if (kind === 'phasedir') return f('')
  if (kind === 'phases') return f('x/')
  if (kind === 'astrocode') return f('phases/x/')
  return [...f('.astrocode/phases/x/'), ...f('y/.astrocode/phases/x/'), ...f('y/z/.astrocode/phases/x/')]
}

// The first unnarrowed search that can reach the phases tree, or null.
async function firstReach($, roots) {
  for (const r of roots) {
    if (r.glob !== undefined && /^([/]|[a-zA-Z]:[/\\])/.test(r.glob)) {
      let cwd
      try { cwd = await $.session.cwd() } catch { cwd = null }
      if (typeof cwd !== 'string') continue
      const re = globRe(r.glob.replace(/\\/g, '/'))
      if (r.names.some((n) => re.test('/' + norm(cwd).segs.join('/') + '/.astrocode/phases/x/' + n))) return r.root
      continue
    }
    const kind = await reaches($, r.root)
    if (!kind) continue
    if (r.glob === undefined) return r.root
    const re = globRe(r.glob)
    if (candidates(kind, r.names).some((c) => re.test(c))) return r.root
  }
  return null
}

function reason(tool, what, role) {
  const lines = [
    `blindfold: ${tool} refused — ${what} is closed to ${role} (ADR-021: the bar is the goal and CRITERIA.md, never the plan).`,
    `Your own rule: "${RULE[role]}"`,
    role === 'astro-verifier'
      ? 'Grade against CRITERIA.md in the phase dir, with evidence you gather yourself.'
      : 'Derive the criteria from the goal, CONTEXT.md and the canon; CRITERIA.md is what you write.',
  ]
  if (what.startsWith('a search')) lines.push('Narrow it: a path outside .astrocode/phases, or a glob such as *.mjs.')
  return lines.join('\n')
}

// ── hooks ───────────────────────────────────────────────────────────────────

/** `agent.spawn`: remember which agentId is a plan-blind type. Never denies, never rewrites. */
export async function agentSpawn($, e, next) {
  if (!isOn('blindfold')) return next(e)
  const result = await next(e)
  const type = e.subagentType
  if (typeof type === 'string' && Object.hasOwn(FORBIDDEN, type) && result && typeof result.agentId === 'string') {
    spawned.set(result.agentId, type)
  }
  return result
}

/** `tool.check`: deny a plan-blind agent's reach for the plan; everything else passes through. */
export async function toolCheck($, e, next) {
  if (!isOn('blindfold')) return next(e)
  if (!e.agentId) return next(e)
  const wide = scan(e, UNION)
  if (!wide.hits.length && !wide.roots.length) return next(e)
  const role = spawned.get(e.agentId)
  if (!role || !Object.hasOwn(FORBIDDEN, role)) return next(e)
  const found = scan(e, FORBIDDEN[role])
  if (found.hits.length) return { decision: 'deny', reason: reason(e.tool, found.hits[0], role) }
  const root = await firstReach($, found.roots)
  if (root !== null) return { decision: 'deny', reason: reason(e.tool, `a search that reaches .astrocode/phases (${root})`, role) }
  return next(e)
}
