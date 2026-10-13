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

/** The band's lines and buttons. `live` is liveFrom's result (or null). */
export function bandView(status, live, { unavailable } = {}) {
  if (unavailable) {
    return { lines: [`astro-code status unavailable (${String(unavailable).slice(0, REASON_MAX)})`], buttons: [] }
  }
  if (status == null) return { lines: [], buttons: [] }
  let first = `M${status.milestone} · ${status.phase ? `P${status.phase.number} ${status.phase.status}` : 'no current phase'}`
  if (status.activity) first += ` · ${status.activity}`
  const lines = [first]
  if (live && live.live) {
    if (live.agents === null) {
      lines.push('workflow agents are not individually visible')
      if (status.activity) lines.push(`${status.activity} (source: ${live.source})`)
    } else {
      for (const a of live.agents) lines.push(`${a.name} — ${a.state}`)
    }
  }
  return { lines, buttons: buttonsOf(status) }
}

function stateOf(status) {
  const s = String(status || '').toLowerCase()
  if (/^(completed?|done|succeeded|success|finished)$/.test(s)) return 'done'
  if (/^(failed|error|errored|killed|cancelled|canceled|aborted)$/.test(s)) return 'failed'
  return 'running'
}

/** Normalise `$.agent.list()` rows to `{live, agents, source}`; never invents rows. */
export function liveFrom(agentRows, activity, workflowAgentsListed, spawnedRecently = false) {
  const agents = (Array.isArray(agentRows) ? agentRows : [])
    .filter(r => r && AGENT_TYPES.has(r.type))
    .map(r => ({ name: r.name || r.type, state: stateOf(r.status) }))
  const live = agents.some(a => a.state === 'running') || activity != null || spawnedRecently
  if (workflowAgentsListed) return { live, agents, source: 'agent.list' }
  return { live, agents: agents.length ? agents : null, source: 'activity' }
}
