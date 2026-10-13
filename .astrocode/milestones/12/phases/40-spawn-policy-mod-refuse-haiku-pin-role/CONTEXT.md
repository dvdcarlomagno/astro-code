<!-- astro-discuss: captured -->
# Phase 40 — spawn-policy mod (re-scoped): require worktree isolation for parallel executor waves

**The roadmap name is stale.** It still says "refuse haiku, pin role models, require worktree
isolation for parallel waves". There is no `ac phase rename` verb, and hand-editing
roadmap.json is refused (canon-guard, ADR-004), so the name stays. This file is the scope.

## Decisions

1. **No haiku refusal.** Superseded by **ADR-073** (2026-10-11): haiku is the user's choice per
   role, and ADR-035's haiku ban is lifted. Implementing that in `lib/config.mjs` /
   `lib/models.mjs` is **not** this phase. It is backlog
   `2026-10-11-implement-the-haiku-per-role-adr-let`.
2. **No model pinning, no filling a missing model.** Workflows already pass a model per spawn
   and vary it on purpose:
   - `--fast`;
   - `--effort deep`, which moves the executor and verifier to opus in memory;
   - local-model sessions, which spawn with no model on purpose;
   - the integrator, which is spawned as `astro-executor` at its own tier.

   A mod overriding or filling the model would break these. spawn-policy never touches `model`.
3. **What remains: parallel executors must be isolated (ADR-008, ADR-005).** Refuse an
   `astro-executor` spawn that would run **concurrently with another `astro-executor` in the
   same working tree without worktree isolation**. Sequential runs (`use_worktrees=false`, or
   the Agent-tool fallback) are never affected.
4. **Probe first, else defer** (the user's choice; same shape as phase 39). PROBE.md (phase 36)
   saw no `isolation` key on `agent.spawn` (2.1.292), and parallel worktrees were not
   exercised.
   - **Task 1 is a live probe on ≥ 2.1.292.** It runs a real parallel wave and checks whether
     `agent.spawn` (or `$.agent.list()`, `next.origin`, the spawn's cwd) exposes
     (a) whether the agent gets a worktree and (b) which other executors are live at that
     moment.
   - Worktree creation currently fails under lean-ctx (phase 37: every git command refused).
     The probe only needs the spawn-time fields, not a successful wave, so it can observe the
     spawn even if the wave then fails.
   - **If a reliable isolation signal exists:** build the refusal.
     - Verdict: **deny**, quoting ADR-008 and naming the fix: run sequentially via
       `ac config set use_worktrees false`, or fix worktree creation.
     - Fail open on lookup errors (ADR-071 e).
     - One switch, `mods.spawn-policy`; flip it to `built: true`.
     - Update the FEATURES description in `lib/mods.mjs`.
   - **If not:** stop and report. Record the findings in this phase dir as `PROBE.md`, leave
     `built: false`, and let the user decide whether to drop the phase. No guessing (ADR-071 a).

## Out of scope

- Anything about model choice (decisions 1–2).
- Integrator, testgate and teardown spawns. They are `astro-executor` by type but not
  concurrent wave executors; the probe must tell them apart (e.g. by the workflow agent
  label or index) before any refusal applies.
- Fixing worktree creation under lean-ctx.

## Open questions / assumptions

- Whether any 2.1.292+ field reveals isolation or concurrency. This is the crux of decision 4.
- `lib/mods.mjs` FEATURES still describes spawn-policy as "refuse haiku, pin role models,
  isolate parallel waves". Update it to the isolation-only scope whichever way decision 4 goes.
