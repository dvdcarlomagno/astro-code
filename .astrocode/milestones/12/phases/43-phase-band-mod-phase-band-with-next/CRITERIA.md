# Phase 43 — pre-registered success criteria (plan-blind)

Goal: phase-band mod: phase band with next-command buttons and id autocomplete.
Derived from the goal, CONTEXT.md (decisions 1-5, out of scope, open questions) and canon
(ADR-071 a-e, ADR-072, ADR-074, ADR-033). Plan-blind.

## Harness used by the criteria below

**Sandbox.** A throwaway `HOME` (`T=$(mktemp -d); export HOME=$T; unset CLAUDE_CONFIG_DIR`)
and a scratch astro-code project: a throwaway git repo set up the way `tests/flags.test.mjs`
sets one up (`initPlanning`, a milestone, several phases via `addPhase`), driven with
`AC="node /Users/buu/Development/astro-code/bin/ac.mjs"`. Put the phases into distinct
lifecycle states (at least: one `verified`, one `executing` or planned, one pending and
undiscussed), file at least two debt items, two backlog items and one fix, so every
autocomplete source has data. A second scratch directory with **no** `.astrocode/` root
anywhere above it is the **non-project dir**.

**[engine]** means the scenario runs through the plugin's real engine harness: `claude
plugin test` in `mods/astro-mods` (through `host` if the container has no `claude`). The
verifier writes a scenario test shaped like the existing `*.test.tsx` there. In it:

- `process.run` reaches the real `ac` against the scratch project, or a stub that replays
  that real `ac` output byte-for-byte. The switches answer `phase-band: true` unless a
  criterion says off.
- `cwd` is the scratch project unless a criterion says otherwise.
- Record: everything the band renders (text, buttons and each button's action), every
  `prompt.autocomplete` answer, every `$.prompt.fill` / submit / run call, every `ac`
  invocation (argv), every toast/notice, and any file written.

---

### C1 — What the band can see of a live /astro-execute run was probed on a live Claude Code >= 2.1.292, and the shipped live-wave view matches that answer
- **Observe:** Read the probe record in this phase dir. It states the Claude Code version
  it ran on (>= 2.1.292) and, with evidence from a live run (not from type definitions or
  docs), whether `$.agent.list()` shows Workflow-spawned executor/verifier agents, and
  what it shows for Agent-tool agents. Then check the shipped band against it: if workflow
  agents are visible, [engine] the live view lists them; if not, the band shows what is
  visible or the documented fallback (`ac activity` / workflow progress), and its rendered
  text says plainly that workflow agents are not individually visible.
- **Fails if:** the record is missing, omits the version, or answers from the 2.1.292 types
  rather than an observed run. Also fails if the band claims per-agent state for agents
  the probe says it cannot see (fabricated rows, a hard-coded wave shape, a placeholder
  list), or silently shows an empty wave during a live run without saying why.

### C2 — In an astro-code project the band's primary button is exactly the next command `ac status` recommends, by phase number, with at most two sensible siblings
- **Observe:** [engine] With the switch on and `cwd` the scratch project, render the band.
  Compare against `$AC status` (and its `--json` form if it has one):
  - one button's filled command equals the recommended next command, naming the phase by
    **number** (e.g. `/astro-verify 37`), never a slug or title;
  - there are at most 3 next-command buttons in total, no two fill the same command;
  - every sibling names an existing phase by number with a loop verb that phase's current
    state admits (e.g. `discuss` for a pending undiscussed phase; never `accept` on a phase
    that is not `verified`, never `verify` on a pending phase).

  Move the scratch project to a different state with real `$AC` commands (e.g. verify then
  accept a phase, add a phase), trigger the refresh, and render again: the buttons follow.
- **Fails if:** the primary button disagrees with `ac status`, names a phase by slug, shows
  more than 3 buttons, duplicates a command, offers a sibling `ac` would refuse for that
  phase's state or a phase that does not exist, or keeps showing the old recommendation
  after a real state change.

### C3 — A button only fills the composer; it never submits, runs, or mutates anything
- **Observe:** [engine] Press every rendered button. For each press, record the calls:
  exactly one `$.prompt.fill` with the button's command text, and no submit, no
  `process.run` of anything but read-only `ac` queries, no slash-command execution, no
  toast. Across the whole scenario, list every `ac` argv the plugin issued: each is a
  read-only query (`status`, `mods status --switches-only`, `--json` listings and similar),
  never `phase accept/reject`, `fix accept`, `debt pay`, `backlog promote` or any other
  verb that changes state. With witness on in the same session, a `/astro-accept <N>`
  placed by the band remains plain composer text: the band did not add `--agent`, `--by`
  or any provenance flag to it, and did not sign off on its own.
- **Fails if:** a press submits the prompt, runs the command, calls `ac` with a mutating
  verb, writes provenance into the filled text, or fills something other than the
  button's shown command (ADR-074: a sign-off must stay a human-typed composer act).

### C4 — Quiet when idle, expanded only while a run is live, and never a toast
- **Observe:** [engine] With no live run, render the band: its non-button content is a
  single line. Then simulate a live `/astro-execute` run (agents present per C1's
  visibility answer, or the fallback's live signal) and render: the band expands to show
  each visible agent's state (running / done / failed). End the run and render: it
  collapses back to one line. Across the whole scenario count `ui.toast` and popover
  calls: zero.
- **Fails if:** the idle band spans several lines, the band stays expanded after the run
  ends, does not expand during a live run, shows agent states that do not match the
  agents' actual states, or any toast/popover is raised.

### C5 — Prompt autocomplete offers exactly the right ids with short labels after each listed command, and nothing elsewhere
- **Observe:** [engine] Ask `prompt.autocomplete` for these inputs and compare each row set
  with the matching `$AC … --json` output for the scratch project:
  - `/astro-discuss `, `/astro-plan `, `/astro-execute `, `/astro-verify `, `/astro-accept `:
    one row per phase number, each labelled with that phase's lifecycle state as `ac`
    reports it;
  - `/astro-debt-pay `: one row per open debt id with its title;
  - `/astro-backlog-promote `: one row per backlog id with its title;
  - `/astro-fix-accept `: one row per fix id.

  A partial id (e.g. `/astro-plan 4`) narrows the rows to matching ids. Inputs that are
  not one of these commands (plain text, `/astro-status `, `/other 4`) get no rows from the
  band.
- **Fails if:** a listed command gets no rows, a row's id or label disagrees with `ac`
  (stale state, wrong title, a closed debt item offered as open), an id is missing or
  invented, a phase is offered by slug, or the band adds rows to unrelated input.

### C6 — Data refreshes on a real `.astrocode/` change, not per keystroke, and is never persisted
- **Observe:** [engine] With no change to the scratch project, render the band and request
  autocomplete for 20 successive keystrokes of `/astro-plan 4…` within one turn: count the
  `ac` invocations, which must not grow with the keystrokes (at most one refresh per turn).
  Then make a real state change with `$AC` (which touches `.astrocode/`) and start the next
  turn: both the band and the autocomplete rows show the new state. Touch an unrelated
  project file outside `.astrocode/`: no new `ac` query is issued for it. After all of
  C2-C7's scenarios, list files under the sandbox `HOME` and the scratch project
  (excluding paths `ac` itself writes): the plugin created or modified none.
- **Fails if:** `ac` is called once per keystroke or per render, data goes stale after a
  real `.astrocode/` change, or the plugin writes its own cache/state file (ADR-071 c).

### C7 — Fail open: when `ac` fails the band draws nothing or one dim line, autocomplete adds no rows, and nothing throws
- **Observe:** [engine] Repeat C2's render and C5's autocomplete in each case: `ac` missing
  from PATH; `ac` stubbed to exit 1; stubbed to print non-JSON / truncated JSON; stubbed to
  sleep past any timeout. In each case: the render returns within a bounded time with
  either nothing or a single dim line saying astro-code status is unavailable; no buttons;
  autocomplete returns no band rows; no exception reaches the render path (no stack trace,
  no contained-error report from the engine); at most one notice per session. Then restore
  `ac` and trigger a refresh: the band recovers.
- **Fails if:** a failure yields stale or fabricated buttons/rows, the render or
  autocomplete hangs or throws, more than one line is drawn, a notice repeats on every
  render, or the band stays dead after `ac` recovers.

### C8 — Nothing is drawn outside an astro-code project, with the switch off, or headless
- **Observe:** [engine] (a) `cwd` = the non-project dir, switch on: render draws nothing
  and autocomplete for `/astro-plan ` adds no rows. (b) `cwd` = the scratch project,
  `phase-band: false`: render draws nothing, autocomplete adds no rows, and no `ac` query
  beyond the switches read is issued. (c) a non-interactive (`-p`-style) session start:
  nothing is drawn.
- **Fails if:** any band, button, dim line or autocomplete row appears in any of the three
  cases, or an off switch still queries `ac` for band data.

### C9 — phase-band is a real, switchable, Claude-only mod that the plugin loads
- **Observe:** `$AC mods status` and `$AC mods status --json` list phase-band as built,
  kind `mod`, Claude-only, with the 2.1.292 floor. In the sandbox, `$AC mods enable
  phase-band` exits 0 and `$AC mods status --json --switches-only` then reports it `true`;
  after `disable`, `false`. Record `sha256sum` of every Claude profile's `settings.json`
  and Cursor's hooks file before enable and after disable: unchanged (it is a mod, not a
  settings hook — ADR-071/072). [engine] Flipping only that switch turns C2-C5's
  behaviour on and off.
- **Fails if:** it still reads as unbuilt, cannot be enabled, is enabled with no effect,
  is wired as a settings hook, or is installed for Cursor or Codex.

### C10 — Nothing that already worked regresses, and the statusline is untouched
- **Observe:** `node --test tests/` exits 0, and `claude plugin test` in `mods/astro-mods`
  exits 0 (via `host` if needed); the ADR-071(b) parity guard still passes, so no command
  or agent body depends on phase-band. Extract the phase's base commit to a scratch dir
  (`git archive <base> | tar -x -C $S`) and feed the same statusline input JSON (in the
  scratch project, sandbox `HOME`) to the base commit's statusline hook and the current
  one: stdout is byte-identical.
- **Fails if:** any existing test fails, the plugin suite fails to load, a command or agent
  body references or requires the mod, or the statusline's output differs from the base
  commit (statusline changes are out of scope per CONTEXT).
