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

const CALL_META = new Set(['tool', 'tool_use_id', 'agentId'])

function fieldsOf(event, e) {
  const fields = {}
  for (const k of Object.keys(e ?? {})) {
    if (event === 'tool.call' && !CALL_META.has(k)) fields[k] = shape(e[k])
    else if (k === 'input' && event === 'tool.check') {
      const input = e[k]
      fields[k] = input && typeof input === 'object'
        ? Object.fromEntries(Object.keys(input).map(key => [key, shape(input[key])]))
        : shape(input)
    } else fields[k] = clean(k, e[k], 0)
  }
  return fields
}

let chain = Promise.resolve()

async function record($, event, e, result) {
  try {
    const path = await $.env.get('ASTRO_MODS_PROBE_LOG')
    if (!path) return
    const line = JSON.stringify({ event, at: new Date().toISOString(), keys: Object.keys(e ?? {}), fields: fieldsOf(event, e), ...(result === undefined ? {} : { result: clean('result', result, 0) }) })
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
async function onToolCheck($, e, next) {
  // the verdict is what next(e) answered -- logged beside the event, returned untouched
  const verdict = await next(e)
  await record($, 'tool.check', e, verdict)
  return verdict
}
async function onAgentSpawn($, e, next) {
  await record($, 'agent.spawn', e)
  return next(e)
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
  on('prompt.submit', onPromptSubmit).catch(pass)
  on('command.run', onCommandRun).catch(pass)
}
