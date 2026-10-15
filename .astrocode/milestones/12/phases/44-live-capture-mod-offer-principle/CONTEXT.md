<!-- astro-discuss: captured -->
# Phase 44 — live-capture mod: offer principle capture from human-typed prompts

A mod feature (`kind: 'mod'`) following the astro-mods convention:
`hooks/features/live-capture.js`, the `isOn('live-capture')` guard, and
`on(...).catch(failOpen)`.

It adds a **new capture moment** to the principle system. The single spec stays
`templates/principle-capture.md` (personal principle: state each rule in exactly one place),
so this phase **adds "live capture" there as a §1 moment**, with its gate, `--from-ref` and
reporting bound. The mod references it and never restates its rules.

Settled by personal principles, not re-asked:
- quiet badge count over toasts;
- no word list judges meaning (a model does);
- automation only proposes.

## Decisions

1. **Gate: composer-typed prompts only.** Use `prompt.submit` with `origin.kind === "composer"`
   (PROBE.md, phase 36).
   - **Never:** slash-command bodies or expanded command text, `-p`/`sdk`,
     `task-notification`, mod-submitted prompts, assistant text, tool output.
   - This mirrors §1's "only what the human typed" and ADR-064's transcript-sweep filter.
   - Off-project sessions (no `.astrocode/` root) still count. The store is personal
     (ADR-057), with `--from-project` set when inside a project.
2. **Judge with Haiku, no word list.**
   - `$.model.classify` with Haiku (ADR-073) on each qualifying prompt: does it state a
     standing rule, preference, pattern or antipattern of the user's own?
   - On a hit, the same small model **lifts** it per §2: strip project nouns, filenames,
     numbers and proper names. **If what survives is vacuous or untrue as a general rule,
     propose nothing.**
   - It picks the kind per §4 and writes a non-empty `--why` (§3). No why means no proposal.
3. **Propose now.** Consult `ac principles match "<lifted>" --json` first (§5).
   - **exact:** run add anyway, so the engine records a sighting.
   - **overlap that is the same principle:** `ac principles sight <id>`.
   - **otherwise:**
     `ac principles add "<lifted>" --kind … --why "…" --propose --from-project "<project>" --from-ref "live <session-id>" --excerpt "<the user's own words>"`.
   - The exact `--from-ref` shape is decided in planning and stated in the template.
   - The engine redacts the excerpt. Never call accept/amend/reject, never write the store
     directly (ADR-058).
   - **Run it after the turn's primary effect** (§6): fire-and-forget after `prompt.submit`
     passes the prompt through unchanged. Never delay or alter the prompt.
4. **Quiet surfacing.** No toast. Show a quiet count of this session's proposals (e.g. "2
   proposed") in the band when phase-band (43) is on, otherwise as a dim one-line notice once
   at turn end (`turn.complete` `{ text }`). It points at `/astro-principles-review`.
5. **Volume: 3 per session**, strongest first, per the §3 cap treating a session as one moment.
   Sightings of existing principles don't count toward the cap. Hitting the cap is silent.
6. **Dedup with the transcript sweep.** `/astro-principles-mine` may later see the same turn.
   The engine's `match` exact → sighting path absorbs that. No new dedup state in the mod
   (ADR-071 c: the mod holds no state; the per-session count may live in memory only).
7. **Fail open** (ADR-071 e). A model or `ac` failure or timeout means no proposal, at most
   one notice per session, and the prompt is never affected.
8. **Switch / cost / host.** `mods.live-capture`, off by default (one Haiku call per typed
   prompt). Plugin floor 2.1.292, Claude only. Flip it to `built: true`.

## Out of scope

- Changing review UX (`/astro-principles-review`), the store format, or the mine sweep.
- Capturing from Cursor/Codex.
- Capturing from assistant text.

## Open questions / assumptions

- ADR-073 lifted the haiku ban, but backlog `2026-10-11-implement-the-haiku-per-role-adr-let`
  isn't implemented. The mod calls Haiku directly via `$.model.classify`/`complete`, not
  through `ac models`, so it isn't blocked. Confirm `$.model.*` accepts a Haiku model id on
  2.1.292.
- Excerpt redaction happens in the engine. Confirm the redaction covers secrets typed in
  prompts before anything is written.
