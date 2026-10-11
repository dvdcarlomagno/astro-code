// astro-mods -- the optional, Claude-only enforcement layer (ADR-071). This skeleton ENFORCES
// NOTHING: its one hook reads the switches from `ac` and passes the event through.
//
// The feature convention (phases 39-44 each add "one file + one line"):
//   - feature `<name>` lives in `hooks/features/<name>.js` and exports named hook functions;
//   - every such function opens with `if (!isOn('<name>')) return next(e)`, so a switched-off
//     feature costs nothing and a mod holds no state of its own (rule c, switches.js);
//   - register.js then gains ONE line per hook:
//         on('<event>', <fn>).catch(failOpen)
//     The `.catch(failOpen)` is the fail-open (rule e): the engine routes a throw, a wrong
//     answer or an overrun there, the action goes through, and the user is told once.
// A mod only enforces a rule the canon already states and its deny message quotes that ADR
// or convention (rule a); no command or agent depends on any of this (rule b).
//
// register() starts a clean slate -- every switch off, the once-per-session notice re-armed --
// so a reload of the plugin never carries over what an earlier `ac` answer said.
import { SWITCHES_ARGV, SWITCHES_TIMEOUT_MS, setSwitches, resetSwitches } from './lib/switches.js'
import { failOpen, resetNotice } from './lib/failopen.js'

// session.start fires at session start and again on each /reload-plugins; it reads NO field
// of `e` (PROBE.md: the event carries cwd, surface and isInteractive, none of which is needed).
async function sessionStart($, e, next) {
  setSwitches(await $.process.run(SWITCHES_ARGV, { timeoutMs: SWITCHES_TIMEOUT_MS }))
  return next(e)
}

export function register(on, options) {
  resetSwitches()
  resetNotice()
  on('session.start', sessionStart).catch(failOpen)
}
