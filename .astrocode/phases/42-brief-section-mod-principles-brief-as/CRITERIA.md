# Phase 42 — pre-registered success criteria (plan-blind)

Goal: brief-section mod: principles brief as one cached system-prompt section.
Derived from the goal, CONTEXT.md (decisions 1-6, out of scope) and canon (ADR-057/062
brief lineage, ADR-071 a-e, ADR-072). Plan-blind.

## Harness used by the criteria below

**Sandbox.** A throwaway `HOME` (`T=$(mktemp -d); export HOME=$T; unset CLAUDE_CONFIG_DIR`)
and a scratch astro-code project: a throwaway git repo set up the way `tests/flags.test.mjs`
sets one up (`initPlanning`, a milestone, `addPhase`), driven with
`AC="node /Users/buu/Development/astro-code/bin/ac.mjs"`. Seed the personal principle store
under `$T/.astro/principles/` with enough **accepted** in-scope entries that
`$AC principles brief` prints more than 25,000 characters. The settings hooks then have to
split it into at least 3 parts (banner + part 1, then `K/N` parts 2..N). Call that output
**BRIEF**.

**Hook outputs.** Run the installed SessionStart hooks (the update hook and every
`astro-principles` part) and the PreCompact hook directly with `node`, in the scratch
project with the sandbox `HOME`. Record each one's stdout as **HOOKS-OUT** and **PRECOMPACT-OUT**.

**[engine]** means the scenario runs through the plugin's real engine harness. Run
`claude plugin test` in `mods/astro-mods`, through `host` if the container has no `claude`.
The verifier writes a scenario test shaped like the existing `*.test.tsx` there. In the
scenario:

- `process.run` reaches the real `ac`, or a stub that returns the sandbox's real `ac`
  output. The switches answer `brief-section: true` unless a criterion says off.
- Fire `session.start`, `turn.start`, the system-prompt composition events, and the
  settings-hook output events the probe identified, carrying HOOKS-OUT / PRECOMPACT-OUT.
  A compaction is included where a criterion asks for one.
- Record the composed system prompt, what a hook *beneath* the plugin receives for each
  settings-hook output, every `ac` invocation (argv), and any toast or notice.

---

### C1 — The probe settled both questions on a live Claude Code ≥ 2.1.292, and what shipped matches its answers
- **Observe:** Read `PROBE.md` in this phase dir. Check that it states:
  - the Claude Code version it ran on (≥ 2.1.292);
  - with evidence from a live run, (a) whether a mod can see and drop or rewrite a settings
    hook's SessionStart `additionalContext` and PreCompact output, and how it tells
    astro-code's own hooks from others;
  - (b) whether a custom system-prompt section can be added, whether it is cached with the
    system prompt or sent uncached each turn, and whether it survives `/compact`;
  - the token size of the full unsplit brief, flagged plainly if it is over about 10k tokens.

  Then, if PROBE.md says (a) or (b) is impossible, check that `$AC mods status --json`
  does not report brief-section as built. Check too that no settings-hook entry was
  removed from any Claude profile or from Cursor's hooks.
- **Fails if:** PROBE.md is missing, omits the version, or gives a hedged or doc-sourced
  answer to (a) or (b) instead of an observed one. Also fails if the size is not reported,
  or is over ~10k tokens and not flagged. Also fails if the shipped feature relies on a
  capability the probe says does not exist, or is marked built after the probe found (a)
  or (b) impossible. (In that case the goal is not met and the phase cannot PASS. It must
  still not ship a duplicate brief or unregister hooks.)

### C2 — With the switch on, the session's system prompt carries one section holding the whole, unsplit brief plus one correct position line
- **Observe:** [engine] Fire `session.start`, then compose the system prompt. Check that
  the composed prompt contains exactly one astro-code brief section, and that in it:
  - BRIEF appears once, whole and in order, byte-identical to `$AC principles brief`
    output apart from any surrounding heading. No `K/N` part markers, no truncation, no
    10k cut.
  - There is exactly one position line naming the milestone, the active phase, its
    lifecycle state and the next command. Those values match what `$AC status` / `$AC
    state` report for the scratch project, and the facts PRECOMPACT-OUT carries.

  Repeat with the scratch project's state moved to a different phase/state before
  `session.start`. The line follows the state.
- **Fails if:** the brief is split across several sections, still carries part markers,
  is cut short, re-packed or re-scoped (out of scope per CONTEXT). Also fails if it
  appears twice. Also fails if the position line is missing, spans several lines, or
  shows values that disagree with `ac`. A hard-coded or mod-formatted value `ac` would not
  print counts as disagreeing.

### C3 — No duplicates in Claude: astro-code's brief parts and PreCompact output are dropped, the update banner and unrelated hooks are untouched
- **Observe:** [engine] With the section added, feed HOOKS-OUT and PRECOMPACT-OUT through
  the settings-hook output path the probe identified. Check what reaches the layer beneath:
  - no BRIEF text from any `astro-principles` part or from the update hook's part 1;
  - no PRECOMPACT-OUT position re-injection;
  - the update hook's banner / update-nudge text, byte-identical.

  Also feed the output of a SessionStart hook and a PreCompact hook that are not
  astro-code's, whose text quotes a line of BRIEF. Each arrives byte-identical. After
  compaction, the model-visible context holds BRIEF exactly once (in the section).
- **Fails if:** any brief part or the PreCompact re-injection still reaches the model
  next to the section, so the brief appears twice. Also fails if the banner/update nudge
  is dropped or altered. Also fails if a non-astro-code hook's output is dropped or
  rewritten because its text looks like the brief.

### C4 — The section is stable across turns and changes only on a real state change
- **Observe:** [engine] After `session.start`, fire `turn.start` and compose the system
  prompt 5 times with no change to the scratch project. The section is byte-identical
  every time, and `ac principles brief` was invoked exactly once in the session. Then run
  a real lifecycle change in the scratch project (e.g. `$AC phase` moving the active phase
  or its state) and fire `turn.start` again. The position line now shows the new state,
  and the brief part is byte-identical to before with no new `ac principles brief` call.
  Then touch an unrelated project file and fire another `turn.start`: the section is
  unchanged. Fire `session.start` again (a reload): the brief is recomputed exactly once
  more.
- **Fails if:** the section text changes on a turn where nothing changed (timestamps,
  counters, reordering), which breaks the prompt cache every turn. Also fails if the brief
  is recomputed per turn, or the position line goes stale after a real phase/state change.
  Also fails if a reload keeps a stale brief.

### C5 — Fail open: if the brief cannot be built at session start, there is no section, nothing is suppressed, and the user is told once
- **Observe:** [engine] Run `session.start` in each of these cases: `ac` missing from PATH;
  `ac principles brief` stubbed to exit 1; stubbed to print nothing; stubbed to sleep past
  any timeout. In each case:
  - `session.start` resolves within a bounded time;
  - the composed system prompt has no brief section;
  - HOOKS-OUT and PRECOMPACT-OUT then reach the layer beneath byte-identical, so the
    session gets today's brief;
  - one notice is shown, and only one across several turns and hook events in that
    session.

  Separately, make a plugin path throw, e.g. with a malformed hook-output event. The
  output still passes through, with no stack trace.
- **Fails if:** a failure leaves no section while the hooks' brief is still suppressed,
  so the session has no brief at all (the partial state CONTEXT forbids). Also fails if a
  half-built or empty section is added, the session hangs or errors, or the notice repeats
  on every event.

### C6 — Switch off or other hosts: everything is exactly as before, and settings.json is never touched
- **Observe:**
  - [engine] With the switch answering `brief-section: false`, no section is added and
    HOOKS-OUT / PRECOMPACT-OUT pass through byte-identical.
  - In the sandbox, record `sha256sum` of every Claude profile's `settings.json` and of
    Cursor's hooks file after `$AC install`. Run `$AC mods enable brief-section` and then
    `$AC mods disable brief-section`. Every hash is unchanged, and the SessionStart and
    PreCompact hook entries are still registered.
  - Run the hook scripts directly as Cursor or Codex would, with the switch on. Their
    stdout equals HOOKS-OUT / PRECOMPACT-OUT, so they still deliver the full brief in parts.
- **Fails if:** an off switch still adds a section or suppresses anything. Also fails if
  enabling the feature edits settings.json, removes or unregisters a hook, or changes what
  the hook scripts print. Changing the scripts' output would strip the brief from Cursor
  or Codex, which CONTEXT puts out of scope.

### C7 — brief-section is a real, switchable, Claude-only mod that the plugin loads, and it keeps no state of its own
- **Observe:**
  - `$AC mods status` and `--json` list brief-section as built, kind `mod`, Claude-only,
    with the 2.1.292 floor. It is no longer reported as not built.
  - In the sandbox, `$AC mods enable brief-section` exits 0, and
    `$AC mods status --json --switches-only` then reports it `true`. After `disable` it
    reports `false`.
  - [engine] Flipping only that switch turns C2's section and C3's suppression on and off.
  - After running C2-C5's scenarios, list the files under the sandbox `HOME` and the
    scratch project (excluding paths `ac` itself writes). No file was created or modified
    by the plugin.
- **Fails if:** it still reads as unbuilt, cannot be enabled, or is enabled but has no
  effect. Also fails if it is wired as a settings hook or installed for Codex or Cursor.
  Also fails if the plugin writes its own cache or state file (ADR-071 c), or reads the
  brief or state by parsing `.astrocode/` or the principle store directly in a way that
  disagrees with `ac`'s output.

### C8 — Nothing that already worked regresses, and the brief's content is unchanged
- **Observe:**
  - `node --test tests/` exits 0, and `claude plugin test` in `mods/astro-mods` exits 0.
    The ADR-071(b) parity guard still passes, so no command or agent body depends on
    brief-section.
  - Extract the phase's base commit to a scratch dir (`git archive <base> | tar -x -C $S`).
    Run `node $S/bin/ac.mjs principles brief` and the base commit's hook scripts against
    the same sandbox store and scratch project. They produce the same BRIEF, HOOKS-OUT and
    PRECOMPACT-OUT as the current tree.
- **Fails if:** any existing test fails, or the plugin suite fails to load. Also fails if
  a command or agent body references or requires the mod. Also fails if the brief's
  content, scoping or packing, or the hooks' output, differs from the base commit (out of
  scope per CONTEXT).
