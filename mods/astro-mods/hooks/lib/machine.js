// The one machine-typed check, shared by every composer-gated mod (witness, live-capture), so the
// rule is stated once (ADR-081): a prompt a TOOL of the user's own typed into the session is not
// the human's, and never counts as the human's word or act. Plain values in, plain values out --
// no `$`, no imports -- so the plugin validator never sees a helper holding the engine handle.
//
// The prefix list comes from `ac` (`mods.machinePrefixes` in ~/.astro/config.json, validated in
// lib/mods.mjs and handed over at session.start through switches.js `getPrefixes`). This file
// does not validate it; it only matches. The match is a plain, case-sensitive `startsWith` on the
// trimmed prompt: no regex, no judgement (deterministic tooling, principle 333f). A `.*` entry is
// therefore the literal two characters, never "everything".

/** Does this prompt (trimmed at the start) begin with one of the user's machine-typed prefixes? */
export function isMachineTyped(text, prefixes) {
  if (typeof text !== 'string' || !Array.isArray(prefixes)) return false
  const head = text.trimStart()
  return prefixes.some((p) => typeof p === 'string' && p !== '' && head.startsWith(p))
}

/**
 * The text a typed slash command was, rebuilt from the engine's `command.run` { command, args }
 * (`('astro-accept', '41')` -> `/astro-accept 41`), so a tool that types `/astro-accept 46` through
 * tmux matches a prefix like any other prompt.
 */
export function commandText(command, args) {
  return '/' + String(command).replace(/^\//, '') + (args ? ' ' + args : '')
}
