// Fail open (ADR-071 rule e): a hook that throws, answers the wrong shape or overruns its
// budget must let the action through, and say so ONCE.
//
// The engine's own mechanism does the routing: every registration is
// `on('<event>', fn).catch(failOpen)`, and the engine sends a throw, a rejection, a wrong
// shape or an overrun to that `.catch`. (A wrapper such as `on('x', failOpen(fn))` fails
// `claude plugin validate`, which wants the literal `on("<event>", <function>)` form.) So
// this module is just the `.catch` handler: it passes the event through untouched, and it
// forgets what `ac` said, because "every mod is off until the next session" is the promise
// made in the notice below.
import { resetSwitches } from './switches.js'

let told = false

/** The notice is once per session: a re-armed flag is a fresh registration. */
export function resetNotice() {
  told = false
}

/** The `.catch` handler of every hook. Always returns `next(e)`. */
export function failOpen($, e, next) {
  resetSwitches()
  if (!told) {
    // set first: a toast that throws (no UI under -p) must not earn a second notice
    told = true
    try {
      const why = String((next && next.error && (next.error.message || next.error)) || 'unknown error').slice(0, 80)
      $.ui.toast(`astro-mods: a hook failed (${why}) — letting the action through; every mod is off until the next session`)
    } catch {
      // -p has no UI: the action still goes through
    }
  }
  return next(e)
}
