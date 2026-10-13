// The phase-band mod's pure core (ADR-071): parsing `ac` output, the root walk, the freshness
// signature and the lines and buttons the band draws. Plain values in, plain values out.
//
// Why no `$` here (F5). The plugin validator follows `$` only into functions declared in the
// same file, never across an import, so every `$.…` call lives in features/phase-band.js and
// this module takes results as arguments. It reads no file either: phase-band.js does the stat.
//
// Why `null` and never a throw (F6). `failOpen` resets every switch, so a flaky `ac` read for
// the band must not reach it. Every parser here answers `null` for anything it cannot read, and
// the caller turns that into an `unavailable` reason.

const BUTTON = /^\/astro-(discuss|plan|execute|verify|accept) \d+$/
const MAX_BUTTONS = 3
const REASON_MAX = 60
const AGENT_TYPES = new Set(['astro-executor', 'astro-verifier'])

/** The parsed value of an `ac … --json` run, or `null`; never throws. */
export function readJsonResult(ran) {
  try {
    if (!ran || ran.exitCode !== 0 || ran.isStdoutTruncated) return null
    const v = JSON.parse(ran.stdout)
    return v !== null && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

/** `cwd/.astrocode`, then each parent's, up to `/`. Pure path math. */
export function rootCandidates(cwd) {
  const out = []
  let dir = String(cwd).replace(/\/+$/, '')
  for (;;) {
    out.push(`${dir}/.astrocode`)
    if (!dir) break
    dir = dir.slice(0, dir.lastIndexOf('/'))
  }
  return out
}

/** A stable string from `[{path, mtimeMs|null}]`: changes with any mtime, ignores order. */
export function signature(stats) {
  return stats.map(s => `${s.path}@${s.mtimeMs == null ? '-' : s.mtimeMs}`).sort().join('|')
}

/** What to stat for freshness: `.astrocode` state files and non-complete phase dirs only. */
export function stalePaths(root, status) {
  const base = `${String(root).replace(/\/+$/, '').replace(/\/\.astrocode$/, '')}/.astrocode`
  const paths = ['state', 'roadmap', 'debt', 'backlog', 'fixes'].map(f => `${base}/${f}.json`)
  for (const p of (status && Array.isArray(status.phases)) ? status.phases : []) {
    if (p && p.status !== 'complete' && p.slug) paths.push(`${base}/phases/${p.slug}`)
  }
  return paths
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1)

function buttonsOf(status) {
  const seen = new Set()
  const out = []
  for (const command of [status.next, ...(Array.isArray(status.siblings) ? status.siblings : [])]) {
    if (typeof command !== 'string' || !BUTTON.test(command) || seen.has(command)) continue
    seen.add(command)
    const [, verb, n] = command.match(/^\/astro-(\w+) (\d+)$/)
    out.push({ key: command, label: `${cap(verb)} ${n}`, command })
    if (out.length === MAX_BUTTONS) break
  }
  return out
}

/**
 * `status` with its activity verb dropped once `activityUntil` (epoch seconds) has passed: ac stops
 * reporting a verb that old, and the band must not keep one alive with no file change to re-read on.
 */
export function freshStatus(status, nowMs) {
  if (!status || !status.activity || typeof status.activityUntil !== 'number') return status
  return nowMs < status.activityUntil * 1000 ? status : { ...status, activity: null }
}

const METER_MAX = 10

/** `n` of `total` phases done as a bar at most METER_MAX cells wide, or null with no phases. */
export function meterOf(status) {
  const phases = status && Array.isArray(status.phases) ? status.phases : []
  if (!phases.length) return null
  const done = phases.filter(p => p && p.status === 'complete').length
  const cells = Math.min(phases.length, METER_MAX)
  const filled = Math.round((done / phases.length) * cells)
  return { done, total: phases.length, bar: '▰'.repeat(filled) + '▱'.repeat(cells - filled) }
}

/**
 * The band's lines and buttons. `live` is liveFrom's result (or null). Each line is also given as
 * `parts`, `[{text, tone}]` whose texts join to that line, so the drawing can colour a segment
 * without the line's words changing. `hint` is `ac`'s next command when it is not a phase button
 * (`/astro-milestone`, say), shown as text so the band still says what to do next.
 */
export function bandView(status, live, { unavailable } = {}) {
  if (unavailable) {
    const text = `astro-code status unavailable (${String(unavailable).slice(0, REASON_MAX)})`
    return view([[{ text, tone: 'unavailable' }]], [], null, null)
  }
  if (status == null) return view([], [], null, null)
  const first = [{ text: `M${status.milestone}`, tone: 'id' }, SEP]
  if (status.phase) {
    first.push({ text: `P${status.phase.number}`, tone: 'id' }, { text: ' ', tone: 'sep' }, { text: String(status.phase.status), tone: `state:${status.phase.status}` })
  } else {
    first.push({ text: 'no current phase', tone: 'note' })
  }
  if (status.activity) first.push(SEP, { text: status.activity, tone: 'activity' })
  const parts = [first]
  if (live && live.live) {
    if (live.agents === null) {
      parts.push([{ text: 'workflow agents are not individually visible', tone: 'note' }])
      if (status.activity) parts.push([{ text: `${status.activity} (source: ${live.source})`, tone: 'activity' }])
    } else {
      for (const a of live.agents) parts.push([{ text: a.name, tone: 'id' }, { text: ' — ', tone: 'sep' }, { text: a.state, tone: `agent:${a.state}` }])
    }
  }
  const buttons = buttonsOf(status)
  const hint = typeof status.next === 'string' && status.next && !buttons.some(b => b.command === status.next) ? status.next : null
  return view(parts, buttons, meterOf(status), hint)
}

const SEP = { text: ' · ', tone: 'sep' }

function view(parts, buttons, meter, hint) {
  return { lines: parts.map(p => p.map(t => t.text).join('')), parts, buttons, meter, hint }
}

function stateOf(status) {
  const s = String(status || '').toLowerCase()
  if (/^(completed?|done|succeeded|success|finished)$/.test(s)) return 'done'
  if (/^(failed|error|errored|killed|cancelled|canceled|aborted)$/.test(s)) return 'failed'
  return 'running'
}

/** Normalise `$.agent.list()` rows to `{live, agents, source}`; never invents rows. */
export function liveFrom(agentRows, activity, workflowAgentsListed) {
  const agents = (Array.isArray(agentRows) ? agentRows : [])
    .filter(r => r && AGENT_TYPES.has(r.type))
    .map(r => ({ name: r.name || r.type, state: stateOf(r.status) }))
  const live = agents.some(a => a.state === 'running') || activity != null
  if (workflowAgentsListed) return { live, agents, source: 'agent.list' }
  return { live, agents: agents.length ? agents : null, source: 'activity' }
}
