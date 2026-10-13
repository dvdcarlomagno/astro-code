// phase-band -- a band above the prompt with next-command buttons, and id autocomplete (phase 43).
//
// UX only: it enforces no rule (ADR-071 a, trivially), and nothing depends on it (b). It READS
// astro-code state through `ac ... --json` (c) -- never a file of its own, never a write -- and
// fails open (e): when `ac` fails the band says so in one dim line, or draws nothing.
//
// A button only FILLS the composer (ADR-033, ADR-074). The human presses Enter, so a sign-off
// typed this way stays a composer act that witness can count as human, and the band adds no
// provenance flag to what it fills.
//
// Why the pure work is in lib/: the validator follows `$` only into functions declared in this
// file (F5), so every `$.` call is spelled here, and lib/band.js and lib/complete.js take results.
//
// Session memory only: the one module variable below is rebuilt on every register(), never
// persisted (c). Data is fetched OUTSIDE render (a render hook never writes) and refreshed when
// the mtimes under `.astrocode/` change at a turn boundary, not per keystroke or per render.
//
// Failures. failOpen resets EVERY switch (F6), so a flaky `ac` read for the band must not switch
// off witness or blindfold: refreshes catch their own errors and set an `unavailable` reason.
// The `.catch(failOpen)` in register.js stays as the backstop for a genuine hook bug.
import { isOn } from '../lib/switches.js'
import { readJsonResult, rootCandidates, signature, stalePaths, bandView, liveFrom } from '../lib/band.js'
import { commandSource, completionRows } from '../lib/complete.js'

export const FEATURE = 'phase-band'
// PROBE.md (phase 43, R1): `$.agent.list()` was `[]` at every workflow spawn and mid-run, so a
// workflow's executors and verifiers are NOT individually visible. The band then shows `ac`'s
// activity text and says so; it never invents rows.
export const WORKFLOW_AGENTS_LISTED = false
export const ACTIVE_TIMEOUT_MS = 5000
// Mirrors ACTIVITY_TTL_SECONDS in hooks/_astro-ctx.mjs (ac drops a verb that old), so a spawn keeps
// the band expanded for a run whose activity verb has aged out of `ac status`.
export const SPAWN_LIVE_MS = 20 * 60 * 1000

let st = fresh()

function fresh() {
  return {
    cwd: null, // the project dir holding .astrocode, once found
    interactive: false,
    status: null, // `ac status --json`
    lists: { debt: null, backlog: null, fix: null },
    sig: null, // signature of the .astrocode mtimes the data was read at
    unavailable: null, // why `ac` could not be read, or null
    agentRows: [], // `$.agent.list()` rows
    busy: null, // the refresh in flight
    again: false, // a change arrived while one was in flight
    spawnedAt: null, // ms of the last astro-executor/verifier spawn: a run is live for SPAWN_LIVE_MS after
  }
}

export function resetPhaseBand() {
  st = fresh()
}

/** Resolves when the refresh in flight (if any) is done. Lets a test wait without a timer. */
export function phaseBandSettled() {
  return st.busy ?? Promise.resolve()
}

const active = () => st.interactive && st.cwd !== null

async function statOf($, path) {
  try {
    return { path, mtimeMs: (await $.fs.stat(path)).mtimeMs }
  } catch {
    return { path, mtimeMs: null }
  }
}

async function stats($, paths) {
  return Promise.all(paths.map((p) => statOf($, p)))
}

async function findProject($, cwd) {
  for (const candidate of rootCandidates(cwd)) {
    try {
      if ((await $.fs.stat(candidate)).kind === 'dir') return candidate.slice(0, -'/.astrocode'.length) || '/'
    } catch {
      // not here: keep walking up
    }
  }
  return null
}

function reasonOf(err) {
  const m = String((err && err.message) || err || '')
  if (/ENOENT|not found/i.test(m)) return 'ac not found'
  if (/time/i.test(m)) return 'ac timed out'
  return m.slice(0, 40) || 'ac failed'
}

async function ask($, argv) {
  try {
    return { ran: await $.process.run(argv, { cwd: st.cwd, timeoutMs: ACTIVE_TIMEOUT_MS }) }
  } catch (err) {
    return { error: reasonOf(err) }
  }
}

async function load($) {
  const before = await stats($, stalePaths(st.cwd, st.status))
  const [s, debt, backlog, fix] = await Promise.all([
    ask($, ['ac', 'status', '--json']),
    ask($, ['ac', 'debt', 'list', '--json']),
    ask($, ['ac', 'backlog', 'list', '--json']),
    ask($, ['ac', 'fix', 'list', '--json']),
  ])
  const status = s.ran ? readJsonResult(s.ran) : null
  if (!status) {
    // nothing stale survives a failure: no buttons, no rows
    st.status = null
    st.lists = { debt: null, backlog: null, fix: null }
    st.unavailable = s.error ?? (s.ran.exitCode !== 0 ? `ac exited ${s.ran.exitCode}` : 'ac printed no JSON')
    st.sig = null
    return
  }
  const list = (r) => (r.ran ? readJsonResult(r.ran) : null)
  st.status = status
  st.lists = { debt: list(debt), backlog: list(backlog), fix: list(fix) }
  st.unavailable = null
  const paths = stalePaths(st.cwd, status)
  st.sig = paths.join('|') === before.map((b) => b.path).join('|') ? signature(before) : signature(await stats($, paths))
}

async function readAgents($) {
  try {
    const rows = await $.agent.list()
    st.agentRows = Array.isArray(rows) ? rows : []
  } catch {
    st.agentRows = []
  }
}

function redraw($) {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // no UI to redraw
  }
}

/** One refresh; never rejects, never raises a notice, never writes. */
function refresh($) {
  if (st.busy) {
    st.again = true
    return st.busy
  }
  st.busy = (async () => {
    try {
      await load($)
      await readAgents($)
    } catch (err) {
      st.status = null
      st.unavailable = reasonOf(err)
      st.sig = null
    }
    st.busy = null
    redraw($)
    if (st.again) {
      st.again = false
      void refresh($)
    }
  })()
  return st.busy
}

/** Refresh only if `.astrocode` changed since the last read, or the last read failed. */
async function tick($, withAgents) {
  try {
    if (!active()) return
    const sig = signature(await stats($, stalePaths(st.cwd, st.status)))
    // a live verb can age out in `ac` with no file change: while one shows, re-read at each boundary
    if (sig !== st.sig || st.unavailable || (st.status && st.status.activity)) {
      void refresh($)
    } else if (withAgents) {
      await readAgents($)
      redraw($)
    }
  } catch {
    // a failed freshness check is not a failure of the session
  }
}

/** session.start (interactive only, by its matcher): find the project, start the first read. */
export async function phaseBandStart($, e, next) {
  // The one deliberate exception to "open with isOn": the switches are read by the plugin's other
  // session.start, and the order the engine chains two same-plugin hooks in is not observable
  // (F22), so let the rest of the chain run first and only then ask.
  const r = await next(e)
  if (!isOn(FEATURE)) return r
  st = fresh()
  if (e.isInteractive !== true) return r
  const cwd = await findProject($, e.cwd).catch(() => null)
  if (!cwd) return r // outside an astro-code project: nothing, and no `ac` call (C8a)
  st.cwd = cwd
  st.interactive = true
  void refresh($)
  return r
}

export async function phaseBandTurn($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  void tick($, false)
  return next(e)
}

export async function phaseBandDone($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  void tick($, true)
  return next(e)
}

/** agent.spawn (astro-executor and astro-verifier only, by its matcher). */
export async function phaseBandSpawn($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  if (active()) st.spawnedAt = Date.now()
  void tick($, true)
  return next(e)
}

/** ui.render AbovePrompt: draw from memory. Makes no `ac` call and no write. */
export async function phaseBandRender($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  if (e.props.hasSurvey || !active()) return next(e) // a survey holds the band: yield
  const live = liveFrom(st.agentRows, st.status ? st.status.activity ?? null : null, WORKFLOW_AGENTS_LISTED,
    st.spawnedAt !== null && Date.now() - st.spawnedAt <= SPAWN_LIVE_MS)
  const view = bandView(st.status, live, { unavailable: st.unavailable })
  if (!view.lines.length && !view.buttons.length) return next(e)
  const { Box, Text, Button } = $.ui.resolve(e)
  const lines = view.lines.map((line) => h(Text, { dimColor: true }, line))
  const buttons = view.buttons.map((b, i) =>
    h(Button, {
      key: b.key,
      label: b.label,
      variant: i === 0 ? 'primary' : 'secondary',
      // fills the composer and nothing else; a refused fill leaves it as it was
      onPress: () => {
        $.prompt.fill({ text: b.command, mode: 'replace' }).catch(() => {})
      },
    }),
  )
  return h(Box, { flexDirection: 'column' }, ...lines, ...(buttons.length ? [h(Box, { flexDirection: 'row', gap: 1 }, ...buttons)] : []))
}

/** prompt.autocomplete: rows after the listed commands, from memory. Never calls `ac` (C6). */
export async function phaseBandComplete($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  const source = commandSource(e.text, e.start)
  if (source === null || !active() || !st.status) return next(e)
  const data = source === 'phases' ? st.status.phases : st.lists[source]
  const rows = completionRows(source, data, e.token)
  const base = await next(e)
  if (!rows.length) return base
  return { suggestions: [...(base && Array.isArray(base.suggestions) ? base.suggestions : []), ...rows] }
}
