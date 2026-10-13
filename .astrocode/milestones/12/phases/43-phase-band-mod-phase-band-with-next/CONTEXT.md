<!-- astro-discuss: captured -->
# Phase 43 — phase-band mod: phase band with next-command buttons and id autocomplete

A mod feature (`kind: 'mod'`) following the astro-mods convention:
`hooks/features/phase-band.js`, the `isOn('phase-band')` guard, and `on(...).catch(failOpen)`.
It draws a band above the prompt (see the mods interface docs: band, `Button`, `Text`).
It is UX only and enforces no rule, so ADR-071 (a) is trivially met: it states nothing the
canon doesn't.

## Decisions

1. **Band and statusline split the job.** The astro statusline (`hooks/astro-statusline.mjs`)
   is **unchanged**. It keeps the position gauge and also serves Cursor. The band adds only
   what a statusline can't:
   - **Next-command buttons**: the recommended next action from `ac status` (by phase
     number), plus at most one or two sensible siblings (e.g. `Discuss 44` next to
     `Execute 43`). The button rules are in decision 2.
   - **The live wave.** While an `/astro-execute` run is live, show each executor/verifier
     agent's state from `$.agent.list()`. Note: phase 40's planning found that the
     2.1.292 types say `$.agent.list()` leaves out **workflow** agents. Planning must
     confirm what is actually visible. If workflow agents are invisible, show what is
     visible (Agent-tool agents), or fall back to `ac activity` and the workflow's own
     progress, and say so. Don't fake it.
   - **One quiet line when idle**, expanded only while a run is live.
   - **Quiet indicators, no toasts.** A personal principle already settled this: prefer a
     quiet badge count over toasts or popovers.
   - Shown only inside an astro-code project (cwd under a `.astrocode/` root). Nothing is
     drawn elsewhere.
2. **Buttons fill the prompt; they never submit.** A press calls `$.prompt.fill` with the
   command (e.g. `/astro-verify 37`), and the human presses Enter.
   - The command stays composer-typed, so witness (phase 41, ADR-074) counts an accept made
     this way as human. A button can never sign off on its own, and nothing runs by surprise.
   - Commands always reference phases by **number**.
3. **Prompt autocomplete** (`prompt.autocomplete`) offers ids with a short label, all read
   via `ac … --json` (ADR-071 c):
   - after `/astro-discuss|plan|execute|verify|accept`: phase numbers with their state;
   - after `/astro-debt-pay`: debt ids with titles;
   - after `/astro-backlog-promote`: backlog ids with titles;
   - after `/astro-fix-accept`: fix ids.

   Data is cached per turn at most, never persisted. It refreshes when `.astrocode/` state
   changes (mtime check), not on every keystroke.
4. **Fail open** (ADR-071 e). If `ac` fails, times out or returns bad JSON, draw nothing (or
   a dim one-liner saying astro-code status is unavailable) and add no autocomplete rows.
   Never throw into the render path: per 2.1.29x, a mod's failing `ui.render` is contained,
   but keep it clean anyway.
5. **Switch / host.** `mods.phase-band`, plugin floor 2.1.292, Claude only (terminal and
   Desktop Code tab; headless `-p` draws nothing). Flip it to `built: true`.

## Out of scope

- Statusline changes, including debt `2026-09-22-the-statusline-hook-crashes-with-an`
  (EPIPE): explicitly left out.
- Submitting commands from buttons.
- Replacing the statusline gauge.
- Cursor/Codex UI.

## Open questions / assumptions

- What `$.agent.list()` shows for Workflow-spawned agents on ≥ 2.1.292 (decision 1). Probe it
  during planning or as the first task.
- The band API changed across 2.1.288–2.1.296. Pin to what 2.1.292 supports, and test with
  `claude plugin test`.
