// In-memory badge registry (ADR-071 c: memory only, no file). Two features in one plugin share a
// count through it: live-capture publishes "N proposed" with setBadge, and phase-band draws the
// texts and calls claimBadges() when it draws. The claim makes exactly one surface show the count:
// a feature that would otherwise print its own line stays quiet while badgesClaimed() is true.
// Pure: no `$`, no fs, no import (the validator follows `$` only within one file).
const entries = new Map()
let claimed = false

/** Set a named badge's text; an undefined or empty text removes it. */
export function setBadge(name, text) {
  if (text === undefined || text === null || text === '') entries.delete(name)
  else entries.set(name, String(text))
}

/** The badge texts, in insertion order. */
export function badges() {
  return [...entries.values()]
}

/** The band calls this when it draws, so badge owners do not also print a line. */
export function claimBadges() {
  claimed = true
}

/** A new session starts unclaimed: the band claims again only if it draws in this one. */
export function releaseBadges() {
  claimed = false
}

export function badgesClaimed() {
  return claimed
}

export function resetBadges() {
  entries.clear()
  claimed = false
}
