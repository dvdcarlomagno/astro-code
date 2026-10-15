// The phase-band autocomplete matcher and row builder (ADR-071): plain values in, plain values
// out, no `$` (F5: the validator follows `$` only inside features/phase-band.js) and no file or
// `ac` access -- rows are built from data the feature already holds in session memory, so a
// keystroke never costs an `ac` call (C6).
//
// Never throws (F6): malformed data reads as "no rows", because a bad row set must not switch
// off sibling features through failOpen.

// The command must be the WHOLE text before the token: no leading prose, no earlier argument.
// An optional `<ns>:` prefix covers a plugin-namespaced command (PROBE.md records which form
// the host actually delivers).
const PHASES = /^\s*\/(?:[\w-]+:)?astro-(?:discuss|plan|execute|verify|accept)\s+$/
const DEBT = /^\s*\/(?:[\w-]+:)?astro-debt-pay\s+$/
const BACKLOG = /^\s*\/(?:[\w-]+:)?astro-backlog-promote\s+$/
const FIX = /^\s*\/(?:[\w-]+:)?astro-fix-accept\s+$/

/** Which id list the cursor is completing: 'phases' | 'debt' | 'backlog' | 'fix' | null. */
export function commandSource(text, start) {
  if (typeof text !== 'string' || !Number.isInteger(start) || start < 0) return null
  const before = text.slice(0, start)
  if (PHASES.test(before)) return 'phases'
  if (DEBT.test(before)) return 'debt'
  if (BACKLOG.test(before)) return 'backlog'
  if (FIX.test(before)) return 'fix'
  return null
}

const cut = (s, n) => String(s ?? '').slice(0, n)

const ROW = {
  phases: p => {
    if (!Number.isInteger(p.number)) return null
    const tag = p.planned ? ' · planned' : p.discussed ? ' · discussed' : ''
    return { number: p.number, row: { text: String(p.number), label: cut(p.name, 40), description: `${p.status ?? ''}${tag}` } }
  },
  debt: d => (d.id ? { row: { text: String(d.id), label: cut(d.title, 48), ...(d.cost != null ? { description: String(d.cost) } : {}) } } : null),
  backlog: b => (b.id ? { row: { text: String(b.id), label: cut(b.title, 48) } } : null),
  fix: f => (f.id ? { row: { text: String(f.id), label: cut(f.title, 48), ...(f.status != null ? { description: String(f.status) } : {}) } } : null),
}

/** Suggestion rows for `source`, filtered by `token` as an id prefix. `[]` on anything odd. */
export function completionRows(source, data, token) {
  try {
    const build = ROW[source]
    if (!build || !Array.isArray(data)) return []
    const prefix = typeof token === 'string' ? token : ''
    const built = data.filter(x => x && typeof x === 'object').map(build).filter(Boolean)
    if (source === 'phases') built.sort((a, b) => a.number - b.number)
    return built.map(b => b.row).filter(r => r.text && r.text.startsWith(prefix))
  } catch {
    return []
  }
}
