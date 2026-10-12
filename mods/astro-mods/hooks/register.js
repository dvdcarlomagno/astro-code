// astro-mods -- the optional, Claude-only enforcement layer (ADR-071). Features so far:
// blindfold (phase 39: tool.check + agent.spawn), witness (phase 41: command.run, prompt.submit,
// tool.call), brief-section (phase 42: classic.SessionStart, prompt.compose, session.append).
// session.start (brief-section.js: the validator follows `$` only within one file, and a plugin may
// register ONE session.start, PROBE phase 42 F22) reads the switches from `ac`, runs brief-section's
// one fetch, and passes the event through.
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
import { resetSwitches } from './lib/switches.js'
import { failOpen, resetNotice } from './lib/failopen.js'
import { toolCheck, agentSpawn, resetBlindfold } from './features/blindfold.js'
import { sessionStart, briefSessionStart, briefCompose, briefAppend, resetBriefSection } from './features/brief-section.js'
import { witnessCommand, witnessPrompt, witnessTool, resetWitness } from './features/witness.js'

export function register(on, options) {
  resetSwitches()
  resetNotice()
  resetBlindfold()
  resetWitness()
  resetBriefSection()
  on('session.start', sessionStart).catch(failOpen)
  on('classic.SessionStart', briefSessionStart).catch(failOpen)
  on('prompt.compose', briefCompose).catch(failOpen)
  on('session.append', briefAppend).catch(failOpen)
  on('tool.check', toolCheck).catch(failOpen)
  on('agent.spawn', agentSpawn).catch(failOpen)
  on('command.run', witnessCommand).catch(failOpen)
  on('prompt.submit', witnessPrompt).catch(failOpen)
  on('tool.call', witnessTool).catch(failOpen)
}
