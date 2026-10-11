// astro-mods API probe (phase 36, D7). Dev-only, committed, NEVER shipped: `scripts/` is
// outside package.json `files`.
//
// Why it exists: the astro-mods skeleton's typed assumptions (and phases 39-41's, which
// key on agentId / isTeammate / workflow / origin) must come from OBSERVATION of a real
// run, not from the docs. This plugin watches and records; it never alters anything --
// every hook returns `next(e)` untouched.
//
// How to run (it is OFF unless the log path is set, so loading it by accident is inert):
//   ASTRO_MODS_PROBE_LOG=/abs/x.jsonl claude --plugin-dir <abs>/scripts/mods-probe
// then drive a real session (e.g. `/astro-execute <n>` for Workflow-spawned agents).
//
// One JSONL line per event: { event, at, keys: Object.keys(e), fields } (+ `result` on
// tool.check: the verdict next(e) answered, i.e. the decision).
// Redaction (the log is never committed, but it must still never hold secrets):
//   - scalars and short strings are copied in full;
//   - `prompt`, `text`, `content`, `description` are cut to 80 chars plus the length;
//   - `input` of tool.check, and every argument key of tool.call (which spreads the tool's
//     arguments onto the event beside tool / tool_use_id / agentId), is reduced to
//     { key: { type, length } } -- file contents and commands never reach the log;
//   - nested objects (origin, workflow, provider) are kept to depth 2, same truncation.
//
// Phase 39 additions (still observe-only unless the deny env is set):
//   - agent.spawn also logs what `next(e)` settled with ({ agentId, model, teammateId });
//   - the FIRST tool.check of each agent loop logs `$.agent.list()` (id, type, name, status,
//     parentId, description cut to 80), its duration, `next.origin` and a depth-4 key walk of
//     `e` and `next`;
//   - tool.check input logs key names for every tool plus the VALUES of file_path,
//     notebook_path, path, pattern, glob and type (cut to 200); `command` stays 40 chars+length;
//   - ASTRO_MODS_PROBE_DENY_AGENT=<subagentType>: that type's first Bash or Read call is
//     answered { decision: 'deny', reason: 'probe deny' } (to see whether a deny is honoured
//     inside a bypassPermissions subagent). The spawn-result map is the probe's own.
//
// Phase 40 additions (spawn-time isolation / liveness / refusal):
//   - agent.spawn logs cwd and parentAgentId in full, next.origin, what next(e) answered as
//     { model, agentId, deny }, and a $.agent.list() snapshot taken at that moment
//     ({ id, type, status, parentId, name } rows, or { listError });
//   - turn.complete logs agentId and keys, its answer reduced to shape() (is a workflow
//     executor's end observable?);
//   - ASTRO_MODS_PROBE_DENY_INDEX=<n>: the workflow agent whose agentIndex is n is answered
//     { deny: 'astro-mods probe: refused on purpose' } (what stops, what the workflow does
//     next). Unset, the probe stays a pure observer.
//
// The log is appended through $.fs, which only has read/write: read the file, add the
// line, write it back, serialised on one promise chain so concurrent events never lose a
// line. Fine for a probe; not a pattern for the shipped plugin.

const CUT = new Set(['prompt', 'text', 'content', 'description'])
const SHORT = 200

function shape(value) {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  const length = typeof value === 'string' || Array.isArray(value) ? value.length : undefined
  return length === undefined ? { type } : { type, length }
}

function clean(key, value, depth) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    if (CUT.has(key)) return { head: value.slice(0, 80), length: value.length }
    return value.length > SHORT ? { head: value.slice(0, SHORT), length: value.length } : value
  }
  if (typeof value !== 'object') return value
  if (depth >= 2) return shape(value)
  if (Array.isArray(value)) return value.slice(0, 5).map((v, i) => clean(String(i), v, depth + 1))
  const out = {}
  for (const k of Object.keys(value)) out[k] = clean(k, value[k], depth + 1)
  return out
}

const VALUE_KEYS = new Set(['file_path', 'notebook_path', 'path', 'pattern', 'glob', 'type'])

function inputFields(input) {
  if (!input || typeof input !== 'object') return shape(input)
  const out = {}
  for (const key of Object.keys(input)) {
    const v = input[key]
    if (VALUE_KEYS.has(key) && typeof v === 'string') out[key] = v.length > SHORT ? { head: v.slice(0, SHORT), length: v.length } : v
    else if (key === 'command' && typeof v === 'string') out[key] = { head: v.slice(0, 40), length: v.length }
    else out[key] = shape(v)
  }
  return out
}

function walk(v, depth) {
  if (depth <= 0 || v === null || (typeof v !== 'object' && typeof v !== 'function')) return typeof v
  const out = {}
  for (const k of Object.keys(v)) out[k] = walk(v[k], depth - 1)
  return out
}

const CALL_META = new Set(['tool', 'tool_use_id', 'agentId'])

function fieldsOf(event, e) {
  const fields = {}
  for (const k of Object.keys(e ?? {})) {
    if (event === 'tool.call' && !CALL_META.has(k)) fields[k] = shape(e[k])
    else if (k === 'input' && event === 'tool.check') {
      fields[k] = inputFields(e[k])
    } else fields[k] = clean(k, e[k], 0)
  }
  return fields
}

let chain = Promise.resolve()

async function record($, event, e, result, raw) {
  try {
    const path = await $.env.get('ASTRO_MODS_PROBE_LOG')
    if (!path) return
    const line = JSON.stringify({ event, at: new Date().toISOString(), keys: Object.keys(e ?? {}), fields: fieldsOf(event, e), ...(result === undefined ? {} : { result: raw ? result : clean('result', result, 0) }) })
    chain = chain.then(async () => {
      const prior = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
      await $.fs.write(path, prior + line + '\n')
    }).catch(() => {})
    await chain
  } catch {
    // an observer that fails is silent: it must never change the session it watches
  }
}

async function onSessionStart($, e, next) {
  await record($, 'session.start', e)
  return next(e)
}
async function onToolCall($, e, next) {
  await record($, 'tool.call', e)
  return next(e)
}
const spawned = new Map() // agentId -> subagentType, from agent.spawn results (probe-own)
const seen = new Set()
const denied = new Set()

async function onToolCheck($, e, next) {
  if (e.agentId && !seen.has(e.agentId)) {
    seen.add(e.agentId)
    const t0 = Date.now()
    let list
    try {
      list = (await $.agent.list()).map(a => ({ id: a.id, type: a.type, name: a.name, status: a.status, parentId: a.parentId, description: typeof a.description === 'string' ? a.description.slice(0, 80) : a.description }))
    } catch (err) {
      list = { error: String(err) }
    }
    await record($, 'tool.check.first', e, { agentId: e.agentId, tool: e.tool, listMs: Date.now() - t0, list, spawnType: spawned.get(e.agentId) ?? null, origin: next.origin, walkE: walk(e, 4), walkNext: walk(next, 4) }, true)
  }
  const deny = await $.env.get('ASTRO_MODS_PROBE_DENY_AGENT')
  if (deny && e.agentId && spawned.get(e.agentId) === deny && !denied.has(e.agentId) && (e.tool === 'Bash' || e.tool === 'Read')) {
    denied.add(e.agentId)
    const answer = { decision: 'deny', reason: 'probe deny' }
    await record($, 'tool.check', e, { denied: answer })
    return answer
  }
  // the verdict is what next(e) answered -- logged beside the event, returned untouched
  const verdict = await next(e)
  await record($, 'tool.check', e, verdict)
  return verdict
}
async function onAgentSpawn($, e, next) {
  await record($, 'agent.spawn', e)
  let list
  try {
    list = (await $.agent.list()).map(a => ({ id: a.id, type: a.type, status: a.status, parentId: a.parentId, name: a.name }))
  } catch (err) {
    list = { listError: String(err) }
  }
  const idx = await $.env.get('ASTRO_MODS_PROBE_DENY_INDEX')
  if (idx && e.workflow && String(e.workflow.agentIndex) === String(idx)) {
    const answer = { deny: 'astro-mods probe: refused on purpose' }
    await record($, 'agent.spawn.denied', e, { cwd: e.cwd, parentAgentId: e.parentAgentId, origin: next.origin, list, answer }, true)
    return answer
  }
  const r = await next(e)
  if (r && r.agentId) spawned.set(r.agentId, e.subagentType)
  await record($, 'agent.spawn.result', e, { cwd: e.cwd, parentAgentId: e.parentAgentId, origin: next.origin, answer: { model: r?.model, agentId: r?.agentId, deny: r?.deny }, list, raw: r }, true)
  return r
}
async function onTurnComplete($, e, next) {
  const r = await next(e)
  await record($, 'turn.complete', { agentId: e?.agentId }, { agentId: e?.agentId, keys: Object.keys(e ?? {}), answer: shape(r) }, true)
  return r
}
async function onPromptSubmit($, e, next) {
  await record($, 'prompt.submit', e)
  return next(e)
}
async function onCommandRun($, e, next) {
  await record($, 'command.run', e)
  return next(e)
}

// a probe that breaks lets the action through: it observes, it never gates
function pass($, e, next) {
  return next(e)
}

export function register(on) {
  on('session.start', onSessionStart).catch(pass)
  on('tool.call', onToolCall).catch(pass)
  on('tool.check', onToolCheck).catch(pass)
  on('agent.spawn', onAgentSpawn).catch(pass)
  on('turn.complete', onTurnComplete).catch(pass)
  on('prompt.submit', onPromptSubmit).catch(pass)
  on('command.run', onCommandRun).catch(pass)
}
