# Phase 41 — pre-registered success criteria (plan-blind)

Derived from the phase goal, CONTEXT.md (decisions 1-7) and canon (ADR-033, ADR-071, ADR-074).

**Mod-side scenarios.** Criteria marked [engine] are driven through the plugin's real engine
harness. Run `claude plugin test` in `mods/astro-mods` (via `host` if the container lacks
`claude`) with a scenario test that the verifier writes itself, shaped like
`hooks/register.test.tsx`. The scenario does five things:

- stub `process.run` so the switches answer `witness: true`, unless the criterion says off;
- fire the turn's `command.run` / `prompt.submit` events with the stated `origin.kind`;
- fire the gated `tool.call`;
- record what a hook *beneath* the plugin receives (the command or content that would
  really run or be written), plus any `deny` and any `ui.toast` or notice;
- use `<n>`, a real number such as `41`, consistently unless a mismatch is the point.

**ac-side checks.** A "scratch project" is a throwaway git repo set up the way
`tests/flags.test.mjs` sets one up (`initPlanning`, `addPhase`, `setPhaseStatus` to
`verified`), driven with `node bin/ac.mjs`.

### C1 — A human-typed gate command is witnessed end-to-end: the accept reaches `ac` marked `--witnessed composer`, and the record says `accepted_evidence: "composer"`
- **Observe:** [engine] Fire `command.run {command:"astro-accept", args:"<n>", origin:{kind:"composer"}}`
  and then the expanded composer `prompt.submit`. Then fire `tool.call` Bash
  `ac phase accept <n>`. The command received downstream contains `--witnessed composer` and
  no `--agent`. Repeat with the typed shell form: a composer prompt `! ac phase accept <n>`.
  It gives the same result, or the call is passed through already carrying
  `--witnessed composer`.
  Then run that exact downstream command in a scratch project whose phase `<n>` is
  `verified`. `ac phase show <n>` (and its JSON) report `accepted_kind: "human"` and
  `accepted_evidence: "composer"`. The accept output names the evidence too.
- **Fails if:** the downstream command is unchanged or gains `--agent`. Also fails if
  `--witnessed composer` only works for the slash form or only for the `!` form. Also
  fails if `ac` accepts the flag but stores nothing, or stores it but `ac phase show` /
  the accept output never shows it.

#### Amendment to C1 (2026-10-12, approved by the user after verify)
The `!` form cannot be witnessed on Claude Code 2.1.292. PROBE.md found that a typed
`! ac …` line fires no `prompt.submit`, `command.run` or `tool.call` event, and ADR-074
records this as a host limit.

So the `!`-form half of C1 is out of scope: such a line reaches `ac` undeclared, as with the
mod off. **Only the slash form must be witnessed end-to-end**, as observed above.

"Only works for the slash form" is no longer a Fails-if condition. C1 **fails if** the typed
slash form is not witnessed end-to-end.

### C2 — Any turn that is not the human typing the *matching* gate command records the gate as agent, by rewrite and never by block
- **Observe:** [engine] Each case below ends with `tool.call` Bash `ac phase accept <n>`:
  (a) a composer-typed `/astro-autonomous` (any human-started turn that is not the gate
  command); (b) `/astro-accept <n>` with `origin.kind: "sdk"`; (c) a composer
  `/astro-accept <n>`, then a later `prompt.submit` with `origin.kind: "task-notification"`
  in the same session; (d) a composer `/astro-accept <m>` with `m != n`; (e) a prompt or
  command submitted by a mod (non-composer origin).
  In every case the call is not denied. The downstream command carries `--agent <name>`,
  where `<name>` is non-empty and contains no `>`. It never carries `--witnessed`, and a
  notice says the call was recorded as agent. Running the downstream command in a scratch
  project records `accepted_kind: "agent"` and no `accepted_evidence`, and the phase still
  reaches `complete`.
- **Fails if:** any case is witnessed as human, which is the ADR-033 false-confidence case.
  In particular, case (a) fails if a human-started autonomous turn reads as a sign-off, and
  case (c) fails if the earlier composer signal carries past a non-composer prompt. Also
  fails if any case is denied or blocked, so an unattended run cannot close a phase. Also
  fails if the rewritten call carries both `--agent` and `--witnessed`, or an agent name
  containing `>`.

### C3 — The reject path and fix accept follow the same rule, keyed to their own command and id
- **Observe:** [engine] `ac phase reject <n>` after a composer `/astro-accept <n>` is
  witnessed: downstream it carries `--witnessed composer`. After a composer
  `/astro-accept <m>` with `m != n`, or a non-composer turn, it carries `--agent <name>`.
  `ac fix accept <id>` after a composer `/astro-fix-accept <id>` (or `! ac fix accept <id>`)
  is witnessed. After `/astro-fix-accept <other-id>`, or after `/astro-accept <n>`, it gets
  `--agent <name>`. In a scratch project, the witnessed reject and fix commands store the
  evidence field on the rejection record and the fix record. Inspect them with
  `ac phase show <n>` and `ac fix show <id>` (or their JSON). The agent-rewritten commands
  store kind agent and no evidence.
- **Fails if:** only `phase accept` is gated, and reject or fix accept pass unchanged. Also
  fails if a typed `/astro-accept` witnesses a fix accept, or a mismatched fix id is
  witnessed. Also fails if the evidence is recorded for accepts but dropped for rejects
  or fixes.

### C4 — witness never touches a call that already declares `--agent`, never blocks, and does nothing at all when switched off
- **Observe:** [engine] With witness on, `ac phase accept <n> --agent bot` in a
  non-composer turn arrives downstream byte-identical. With witness on, the same call after
  a composer `/astro-accept <n>` also arrives byte-identical: no second `--agent`, no
  `--witnessed`. With the switch answering `witness: false`, every C1-C3 and C6 scenario
  passes its command or content through byte-identical. Across all scenarios, no gate
  `tool.call` is ever answered with a deny.
- **Fails if:** a declared `--agent` call is rewritten, duplicated or witnessed. Also fails
  if an off switch still rewrites anything, or if any gate call is denied.

### C5 — Fail open: when the turn origin cannot be determined, the call goes through untouched and the record stays "declared"
- **Observe:** [engine] Fire `session.start` (a plugin load or reload) and then, with no
  `command.run` / `prompt.submit` seen since, `tool.call` Bash `ac phase accept <n>`. Do the
  same for `ac fix accept <id>` and a CONTEXT.md marker Write. Each arrives downstream
  byte-identical, with no `--agent` and no `--witnessed`, and is not denied. A notice is
  shown, at most once per session across several such calls. Separately, make a hook path
  throw, for example a malformed `tool.call` event. The action still goes through and the
  user is told once.
- **Fails if:** an undeterminable origin is treated as agent (rewrite) or as human
  (`--witnessed`). Also fails if the call is blocked, a stack trace is printed, or the
  notice repeats on every call.

### C6 — The discuss "captured" marker is human only when `/astro-discuss <n>` was typed for that phase; otherwise it is rewritten to the agent marker
- **Observe:** [engine] `tool.call` Write (and separately Edit) puts
  `<!-- astro-discuss: captured -->` as line 1 of `.astrocode/phases/<n>-<slug>/CONTEXT.md`:
  (a) in a turn begun by a composer `/astro-discuss <n>`, the content arrives downstream
  unchanged; (b) after a composer `/astro-discuss <m>` (m != n), a composer
  `/astro-autonomous`, or a non-composer origin, line 1 arrives as
  `<!-- astro-discuss: captured by agent: <name> -->`, where `<name>` is non-empty and
  contains no `>`. Every other line is byte-identical, and a notice is shown. (c) A Write
  whose line 1 is already the agent marker is never changed to the human marker, in any
  turn. (d) The same marker written to a file that is not a phase CONTEXT.md, or not on
  line 1, is not rewritten. Then run `ac`'s own reader of the marker in a scratch project
  holding the rewritten file, for example the command that reports a phase's discuss
  state or context author. It reports agent authorship.
- **Fails if:** an agent-written marker survives as human. Also fails if a human
  `/astro-discuss <n>` turn gets its marker downgraded. Also fails if an agent marker is
  ever upgraded to human, or the rewrite alters other content. Also fails if `ac` cannot
  parse the rewritten marker, for example because a `>` in the name breaks it.

### C7 — `ac` stores and shows the evidence only when told, refuses contradictory input, and never back-fills or detects
- **Observe:** In a scratch project:
  - `ac phase accept <n> --witnessed composer --agent bot` exits non-zero with a `✖` line
    naming the conflict, and the phase stays unaccepted. The same holds for `phase reject`
    and `fix accept`.
  - A plain `ac phase accept <n>` records `accepted_kind: "human"` and no
    `accepted_evidence`, which means "declared".
  - That stays true when the plain accept runs with Claude-session env vars set, such as
    `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT=cli` and a non-TTY stdin: `ac` infers nothing.
  - A phase or fix accepted before this change still has no evidence field after other
    phases are witness-accepted and `ac phase show` / `ac status` run.
  - `ac phase show` on that old record does not present it as unwitnessed or doubtful.
  - An unknown flag next to `--witnessed` is still rejected (ADR-029).
- **Fails if:** `--witnessed` and `--agent` are accepted together. Also fails if an
  evidence value appears without the flag (detection inside `ac`), if old records gain
  or lose fields, or if historical human sign-offs are relabelled.

### C8 — The probe question about the AskUserQuestion answer is settled, and the shipped behavior matches the recorded answer
- **Observe:** Read the phase's probe record (PROBE.md in this phase dir) and the in-force
  ADR-074 text. Both state plainly, with evidence from a live run on Claude Code
  ≥ 2.1.292, whether a mod can see the UAT AskUserQuestion answer and that a human gave it.
  - **If yes:** [engine] a composer `/astro-accept <n>` turn where the UAT answer was
    absent, or was not "accept", before `ac phase accept <n>` gets `--agent <name>`. The
    same holds for the reject path with a non-reject answer. With a human "accept" answer
    in the same turn, the call is witnessed.
  - **If no:** the ADR-074 text and the probe record both say the signal is the typed
    command alone, and C1's scenario with no UAT event is witnessed.
- **Fails if:** the probe answer is missing, hedged or contradicted by the evidence. Also
  fails if the code requires a UAT answer the probe says cannot be seen, or ignores one the
  probe says can. Also fails if the canon still claims something the probe disproved.

### C9 — witness is a real, switchable, Claude-only feature that the plugin actually loads
- **Observe:** `node bin/ac.mjs mods status` (and `--json`) lists witness as built, a mod,
  Claude-only, with the 2.1.292 floor. It is no longer reported as "not built". With a
  scratch `HOME`, `ac mods enable witness` exits 0. Then
  `ac mods status --json --switches-only` reports `witness: true`, and after
  `ac mods disable witness` it reports `false`. [engine] Toggling only that switch turns
  the C1 rewrite on and off.
- **Fails if:** witness still reads as unbuilt, cannot be enabled, or is enabled but has
  no effect in the loaded plugin. Also fails if it is wired as a settings hook or
  installed for Codex/Cursor, which CONTEXT puts out of scope.

### C10 — Nothing that already worked regresses, and no command or agent depends on the mod
- **Observe:** `node --test tests/` exits 0, and `claude plugin test` in `mods/astro-mods`
  exits 0. The ADR-033 behaviors still hold: a plain accept is human, `--agent` gives
  agent plus the AGENT marker, and a typo'd flag is rejected. The ADR-071(b) parity guard
  still passes. With witness off, or with the plugin absent, `/astro-accept` /
  `/astro-discuss` / `/astro-fix-accept` run exactly as before.
- **Fails if:** any existing test fails, the plugin test suite fails to load, or a command
  or agent body references or requires witness.
