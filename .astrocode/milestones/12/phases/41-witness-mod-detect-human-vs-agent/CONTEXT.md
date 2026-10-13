<!-- astro-discuss: captured -->
# Phase 41 — witness mod: detect human vs agent acceptance provenance (amends ADR-033)

A mod feature (`kind: 'mod'`) following the astro-mods convention:
`hooks/features/witness.js`, the `isOn('witness')` guard, and one
`on(...).catch(failOpen)` line per hook. **ADR-074** (recorded in this discussion) is the
rule. It amends ADR-033's "never detected" to "declared everywhere, witnessed where the host
allows".

## Decisions

1. **The human signal is strict.** A human-gate command counts as human only when **the
   current turn began with the human typing the matching command at the composer**
   (`prompt.submit` / `command.run` with `origin.kind === "composer"`, per PROBE.md from phase
   36). Typed means the slash command or a `!`-prefixed `ac` command.

   | Gate | Matching typed command |
   |---|---|
   | `ac phase accept <n>` | `/astro-accept <n>` (or `! ac phase accept <n>`) |
   | `ac phase reject <n>` | `/astro-accept <n>` (the reject path of the same flow) |
   | `ac fix accept <id>` | `/astro-fix-accept <id>` (or `! ac fix accept`) |
   | discuss marker (decision 4) | `/astro-discuss <n>` |

   - **Same phase, fix or id.** The number in the typed command must match the gate it guards.
   - **Excluded:** any other human-started turn (e.g. a typed `/astro-autonomous` that later
     accepts), `sdk` (`-p`), `task-notification`, and anything a mod submitted. ADR-033 feared
     exactly this false-confidence case.
   - "Current turn" means since the last composer-origin prompt. A later non-composer prompt
     (a task notification) does not carry the earlier human signal forward.
2. **The UAT answer: probe, else the typed command only.** Task 1 is a live probe on ≥ 2.1.292.
   - Can a mod observe the AskUserQuestion answer and that a human gave it? For example on
     the tool's result via `tool.call` `next(e)`, or another event.
   - **If yes:** also require that, in the same turn, the human answered the UAT question
     with accept (or reject for the reject path) before the `ac` command ran.
   - **If no:** the signal is the typed command alone, and PROBE.md + the ADR text say so
     plainly.
   - Record the findings in this phase dir as `PROBE.md`.
3. **No signal and no `--agent`: rewrite, never block.** Rewrite the Bash call to append
   `--agent claude`, using the agent name the session would honestly declare (planning picks
   it, e.g. `claude` or the subagent type), and notify once.
   - Unattended and autonomous runs still close phases (ADR-033 allows that); they are just
     recorded as agent.
   - A call that already has `--agent` is never touched.
4. **The discuss marker.** When a Write/Edit puts the human marker
   `<!-- astro-discuss: captured -->` as line 1 of a `.astrocode/phases/*/CONTEXT.md`
   without the decision-1 signal (`/astro-discuss <n>` typed for that phase), rewrite that
   line to `<!-- astro-discuss: captured by agent: claude -->` and notify once.
   - The agent marker is never rewritten to human.
   - Debt `2026-09-24-a-in-the-agent-name-in-a-context-marker` (a `>` in the agent name)
     means the agent name must contain no `>`.
5. **Record the evidence when the signal is present.**
   - witness appends `--witnessed composer` to the `ac` call, and `ac` records
     `accepted_evidence: "composer"` next to `accepted_kind`. The rejection record and the
     fix record get the equivalent field.
   - **Small `ac` change in scope:** the flag on `phase accept`, `phase reject` and
     `fix accept`. It is stored and shown in `ac phase show` / the accept output. It is
     rejected together with `--agent` (contradictory).
   - Absent means "declared": Codex, Cursor, mod off, or older records. Never back-fill old
     records (ADR-033: don't cast doubt on historical human sign-offs).
   - `ac` itself never detects anything; the flag is set only by the mod (ADR-071 c).
6. **Fail open** (ADR-071 e). If the turn origin can't be determined (the mod reloaded
   mid-turn, missing events), do nothing: no rewrite, no evidence flag. The record stays
   "declared", exactly as without the mod, and a notice is shown once.
7. **Switch / host.** `mods.witness`, plugin floor 2.1.292, Claude only. Flip it to
   `built: true`.

## Out of scope

- bin/ac.mjs debt items (backlog sort order, convention promote leak, double 'convention',
  uninstall wording): explicitly left out.
- Any detection inside `ac` itself.
- Back-filling evidence on existing records.
- Cursor/Codex equivalents.

## Open questions / assumptions

- Decision 2's probe: whether a mod can see the AskUserQuestion answer and its origin.
- Whether the `ac phase accept` Bash call can be rewritten via `tool.call` `next({...e, input})`.
  PROBE (36) observed tool events, but not input rewriting on Bash. Confirm it live.
- Interplay with canon-guard: the marker rewrite is a Write to a phase CONTEXT.md, which is
  not protected, so there is no conflict.
