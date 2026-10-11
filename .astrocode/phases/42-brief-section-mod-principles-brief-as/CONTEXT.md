<!-- astro-discuss: captured -->
# Phase 42 — brief-section mod: principles brief as one cached system-prompt section

A mod feature (`kind: 'mod'`) following the astro-mods convention:
`hooks/features/brief-section.js`, the `isOn('brief-section')` guard, and
`on(...).catch(failOpen)`.

Today the brief is split across 4 SessionStart settings hooks to stay under the 10k
additionalContext cap (#116):
- `astro-update.mjs` (banner + part 1);
- `astro-principles.mjs K/N` (parts 2..N).

`astro-precompact.mjs` re-injects the position before compaction. On Claude, this phase moves
both the brief and the position into one system-prompt section (`prompt.section` /
`prompt.compose`).

## Decisions

1. **One section, two parts.**
   - (a) The **principles brief**, from `ac principles brief` (the same scope and packing the
     hooks use today, but unsplit; the 10k additionalContext cap doesn't apply to a section).
   - (b) A **one-line position**: milestone, active phase, lifecycle state and next command,
     the same facts the PreCompact hook emits.
   - Reads go through `ac` only (ADR-071 c); the mod formats nothing it could get from `ac`.
2. **Freshness.**
   - The brief is computed **once per session**, at `session.start` (and on reload).
   - The position line is refreshed **only when it changes**. At `turn.start`, compare a cheap
     fingerprint (e.g. `.astrocode/state.json` + `roadmap.json` mtimes, or `ac state get` only
     when the mtimes moved) and regenerate the section only on a real change.
   - The cache breaks only on a real phase change, and the section survives compaction.
3. **No duplicates, without touching settings.json.**
   - Inside Claude, with the feature on, the mod **suppresses the brief parts** of the
     SessionStart hooks' output and the **PreCompact hook's output**. It intercepts
     settings-hook output through a `classic.*` hook event, or whatever the probe finds.
   - **The banner / update nudge from `astro-update.mjs` stays.** Only its brief part 1 is
     dropped.
   - settings.json is unchanged, so **Cursor (which imports Claude's hooks) and Codex keep
     their brief exactly as today**.
4. **Probe first, else stop.** Task 1 is a live probe on ≥ 2.1.292 to establish:
   - (a) whether a mod can see and rewrite or drop a settings hook's SessionStart
     `additionalContext` and PreCompact output, and can tell astro-code's own hooks apart
     (by command/script name);
   - (b) that `prompt.section` / `prompt.compose` can add a custom section, how it's
     cached, and whether it survives `/compact`.

   Record the findings in this phase dir as `PROBE.md`.
   - **If (a) is impossible:** stop and report. Don't ship a duplicate brief, and don't
     unregister hooks (that would break Cursor's import).
   - **If (b) is impossible:** stop as well.
5. **Fail open** (ADR-071 e). If `ac principles brief` fails or times out at session start,
   add no section and **don't suppress** the hooks' output, so the session gets today's
   brief. Show a notice once. Partial state is never possible: suppress only when the section
   was actually added.
6. **Switch / host.** `mods.brief-section`, plugin floor 2.1.292, Claude only. Flip it to
   `built: true`.

## Out of scope

- Changing what the brief contains, its scoping or `packBrief` (ADR-057 lineage).
- The banner.
- Cursor/Codex delivery.
- Removing or unregistering the SessionStart/PreCompact settings hooks.

## Open questions / assumptions

- Decision 4 (a): can mods intercept settings-hook output, and by which event? This is the crux.
- Does a custom `prompt.section` count toward the cached system prompt (good), or is it sent
  uncached each turn?
- The section's size: the full unsplit brief may be large. Report its token size in PROBE.md.
  If it's over ~10k tokens, flag it rather than trimming silently.
