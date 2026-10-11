// Guard-hook registration spec and the ONE ownership rule.
//
// A guard (ADR-071) is a PreToolUse settings hook that is off by default; its switch in
// ~/.astro/config.json IS its registration (ADR-072). This module is the single place that says
// which script a guard is, which event and matcher each host registers it under, and how an
// entry in a host's hooks file is recognised as ours.
//
// It is data-only on purpose: `lib/mods.mjs` drives registration through the host adapters and
// the adapters need the spec, so a spec living in either would make an import cycle.
//
// Ownership is by SCRIPT FILENAME, never by full path (phase 35 decision 2). An entry written
// under another home or install location is still ours, so re-sync and removal find it instead
// of duplicating it. The always-on hooks and the guards share this one rule.
import { basename, join } from 'node:path';

export const GUARD_HOOKS = Object.freeze({
  'canon-guard': Object.freeze({
    script: 'astro-canon-guard.mjs',
    claude: Object.freeze({ event: 'PreToolUse', matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash', timeout: 10 }),
    cursor: Object.freeze({ event: 'preToolUse', matcher: 'Write|Delete|Shell', arg: 'cursor', timeout: 10 }),
  }),
});

export const GUARD_SCRIPTS = Object.freeze(Object.values(GUARD_HOOKS).map((s) => s.script));

const quote = (s) => `"${s}"`;

/** `"<node>" "<home>/hooks/<script>"[ <arg>]` — both paths quoted. */
export function guardCommand(home, spec, arg) {
  return `${quote(process.execPath)} ${quote(join(home, 'hooks', spec.script))}${arg ? ` ${arg}` : ''}`;
}

// Split a command line into tokens, honouring single and double quotes.
function tokens(command) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(command)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * Is `command` ours? True iff some token's basename equals `script`. With `arg`, the last token
 * must also equal it. The install location is never compared.
 */
export function ownsCommand(command, script, arg) {
  if (typeof command !== 'string') return false;
  const t = tokens(command);
  if (!t.some((x) => basename(x) === script)) return false;
  return arg == null || t[t.length - 1] === arg;
}
