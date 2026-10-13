// astro-mods -- the optional, Claude-only enforcement layer (ADR-071). Features so far:
// blindfold (phase 39: tool.check + agent.spawn), witness (phase 41: command.run, prompt.submit,
// tool.call), brief-section (phase 42: classic.SessionStart, prompt.compose, session.append),
// phase-band (phase 43: session.start and agent.spawn under a matcher, turn.start, turn.complete,
// ui.render, prompt.autocomplete), live-capture (phase 44: session.start under a matcher,
// command.run, prompt.submit, turn.complete).
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
// Exception (phase 43): phase-band's session.start hook opens with `await next(e)` and only then
// asks `isOn`, because the order two same-plugin session.start hooks are chained in is not
// observable. Every other hook still opens with the guard.
// A mod only enforces a rule the canon already states and its deny message quotes that ADR
// or convention (rule a); no command or agent depends on any of this (rule b).
//
// register() starts a clean slate -- every switch off, the once-per-session notice re-armed --
// so a reload of the plugin never carries over what an earlier `ac` answer said.
import { resetSwitches } from './lib/switches.js'
import { failOpen, resetNotice } from './lib/failopen.js'
import { toolCheck, agentSpawn, resetBlindfold } from './features/blindfold.js'
import { sessionStart, briefSessionStart, briefCompose, briefAppend, resetBriefSection } from './features/brief-section.js'
import { phaseBandStart, phaseBandTurn, phaseBandDone, phaseBandSpawn, phaseBandRender, phaseBandComplete, resetPhaseBand } from './features/phase-band.js'
import { liveSessionStart, liveCommandRun, livePromptSubmit, liveTurnComplete } from './features/live-capture.js'
import { resetBadges } from './lib/badges.js'
import { witnessCommand, witnessPrompt, witnessTool, resetWitness } from './features/witness.js'

export function register(on, options) {
  resetSwitches()
  resetNotice()
  resetBlindfold()
  resetWitness()
  resetBriefSection()
  resetPhaseBand()
  resetBadges()
  on('session.start', sessionStart).catch(failOpen)
  on('classic.SessionStart', briefSessionStart).catch(failOpen)
  on('prompt.compose', briefCompose).catch(failOpen)
  on('session.append', briefAppend).catch(failOpen)
  on('tool.check', toolCheck).catch(failOpen)
  on('agent.spawn', agentSpawn).catch(failOpen)
  on('command.run', witnessCommand).catch(failOpen)
  on('prompt.submit', witnessPrompt).catch(failOpen)
  on('tool.call', witnessTool).catch(failOpen)
  // phase-band (phase 43). session.start and agent.spawn already have an unmatched hook above and a
  // plugin may register only one per event (F22), so these two carry a matcher.
  on('session.start', { isInteractive: true }, phaseBandStart).catch(failOpen)
  on('turn.start', phaseBandTurn).catch(failOpen)
  on('turn.complete', phaseBandDone).catch(failOpen)
  on('agent.spawn', { subagentType: /^astro-(executor|verifier)$/ }, phaseBandSpawn).catch(failOpen)
  on('ui.render', { component: 'AbovePrompt' }, phaseBandRender).catch(failOpen)
  on('prompt.autocomplete', phaseBandComplete).catch(failOpen)
  // live-capture (phase 44). A plugin may register only ONE unmatched hook per event (F22), and the
  // earlier features hold those, so each of these carries a matcher. Its session.start only forgets
  // the session and reads no switch; command.run and prompt.submit see composer origins only (the
  // gate is also checked in the hook); turn.complete is the end of an answered turn.
  on('session.start', { isInteractive: true }, liveSessionStart).catch(failOpen)
  on('command.run', { origin: { kind: 'composer' } }, liveCommandRun).catch(failOpen)
  on('prompt.submit', { origin: { kind: 'composer' } }, livePromptSubmit).catch(failOpen)
  on('turn.complete', { reason: 'answer' }, liveTurnComplete).catch(failOpen)
}
