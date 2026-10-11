# Criteria — phase 39: blindfold mod (plan-blind verifier and criteria-author enforced per agent)

> Pre-registered, plan-blind. Derived from the phase goal, CONTEXT.md (decisions 1-5, the two
> folded-in debt items, out-of-scope list) and canon (ADR-021, ADR-030, ADR-071, ADR-072,
> CONVENTIONS §Testing). The plan and the verifier both answer to this bar.

## Branch rule (read first)

CONTEXT decision 1 makes this phase two-outcome: the live probe either finds a reliable
agentId→agent-type join or it does not.
- **Join found:** C1, C3-C12 apply. C2 is not applicable.
- **No join:** C1, C2, C8-C12 apply. C3-C7 are reported **not applicable** (never PASS), and
  the verdict must say the enforcement goal was not reached and is escalated to the human, as
  CONTEXT decision 1 requires.
Which branch holds is decided by C1's evidence, never by a claim in a summary or commit.

## Shared harness

- **Sandbox.** Never touch the real home. `S=$(mktemp -d)`; `export HOME=$S/home`;
  `mkdir -p $HOME`; unset `CLAUDE_CONFIG_DIR`, `CURSOR_CONFIG_DIR`. `ac` below means
  `node /Users/buu/Development/astro-code/bin/ac.mjs`.
- **Engine drive.** Copy the shipped plugin (`cp -r /Users/buu/Development/astro-code/mods/astro-mods $S/plug`)
  and add a verifier-authored `*.test.tsx` that uses `claude-code/testing` (the same harness
  the plugin's own engine test uses) and is run with `claude plugin test $S/plug`. Beneath the
  plugin, stub `process.run` so `ac mods status --json --switches-only` answers the switch
  state the criterion needs, stub whatever join source PROBE.md (C1) records as the observed
  link (e.g. `agent.list`), and stub `ui.toast` to count notices. Fire `session.start`, then
  `agent.spawn` / `tool.check` events shaped exactly as PROBE.md (phase 36 and phase 39)
  records them, for BOTH a Workflow-spawned agent and an Agent-tool-spawned agent.
- **Phase-dir fixture paths** used in events: `<P>/.astrocode/phases/39-x/PLAN.md`,
  `…/SPEC.md`, `…/ACCEPTANCE.md`, `…/CRITERIA.md`, `…/CONTEXT.md`, `<P>/.astrocode/PROJECT.md`,
  `<P>/.astrocode/CONVENTIONS.md`, `<P>/src/a.js`, `<P>/docs/PLAN.md`.
- **DENIED** = the plugin's `tool.check` result is a deny decision. Never `ask`.
- **ALLOWED** = the plugin's result is exactly what the stub beneath it answered (pass-through
  via `next(e)`). A plugin that answers its own explicit `allow` is NOT "allowed" here: it
  would override the user's own permission rules, which a guard must never do.

---

### C1 — Whether an agent's tool calls can be tied to its agent type is answered by a live probe, recorded in the phase dir, and the shipped `built` state matches the answer
- **Observe:** Read `PROBE.md` in `.astrocode/phases/39-blindfold-mod-plan-blind-verifier-and/`.
  It must name the Claude Code version it ran on (≥ 2.1.292), show runs covering BOTH a
  Workflow-spawned and an Agent-tool-spawned `astro-verifier` (or `astro-criteria-author`),
  and report, in the order CONTEXT decision 1 lists, what `$.agent.list()` entries carry, what
  `agent.spawn` / `tool.check` / `next.origin` carry now, and any other event examined — each
  field marked observed (with an example value) or `not observed`. It ends in an explicit
  verdict: join found (naming the exact fields that link a `tool.check` `agentId` to an agent
  type, observed for the SAME agent in both spawn paths) or no join. Then in the sandbox run
  `ac mods status --json` and `ac mods status blindfold`: blindfold reports built exactly when
  the verdict is "join found".
- **Fails if:** PROBE.md is missing; the verdict rests on documentation, spawn order, timing,
  path or any other inference rather than an observed linking field; only one spawn path was
  exercised; a field is presented as observed without an example value; or the built state
  disagrees with the verdict (built while no join, or not built while a join is claimed).

### C2 — (no-join branch) Without a reliable join, nothing approximate ships, switching blindfold on denies nothing, and the blocker is put in front of the user
- **Observe:** In the sandbox: `ac mods enable blindfold` — the output says the feature is not
  built; `ac mods status --json` reports it not built. Engine drive with blindfold's switch ON:
  `tool.check` events with an `agentId` (both spawn paths, after an `agent.spawn` whose
  `subagentType` is `astro-verifier`, then `astro-criteria-author`) doing `Read` of PLAN.md,
  `Bash` `cat …/PLAN.md`, and `Grep` over `.astrocode/phases` → every one ALLOWED. Then the
  blocker is findable without reading the plan: it appears in at least one user-facing record
  (`ac debt list`, `ac backlog list`, `ac status`/the phase note, or PROBE.md's verdict section
  naming the decision the user must make).
- **Fails if:** any agent is denied (spawn-order inference, path heuristics, or
  deny-for-all-subagents shipped as an approximation); blindfold reports built; or the blocker
  exists only in a commit message or the plan.

### C3 — (join branch) An identified plan-blind agent is denied Read of its forbidden files, per role, in any phase dir and any letter case, with a reason that quotes the rule and points at CRITERIA.md
- **Observe:** Engine drive, blindfold ON, join source stubbed so the `agentId` resolves to the
  role, for both spawn paths:
  - `astro-verifier`: `Read` of `…/39-x/PLAN.md`, `…/39-x/SPEC.md`, `…/07-other/plan.md`,
    `…/39-x/Plan.MD`, and `NotebookRead` of a PLAN.md path → DENIED; `Read` of
    `…/39-x/ACCEPTANCE.md` → ALLOWED (not forbidden for the verifier).
  - `astro-criteria-author`: `Read` of PLAN.md, `ACCEPTANCE.md`, `SPEC.md` (mixed case
    included) → DENIED.
  Every deny reason cites ADR-021 (and/or the agent's own "Do NOT read" rule), names the file
  that was refused, says the agent grades/derives against CRITERIA.md, and does NOT contain
  `ac mods disable` or any other way to switch the guard off.
- **Fails if:** any listed forbidden read is allowed; the verifier is denied ACCEPTANCE.md; a
  lower/mixed-case basename or a different phase dir slips through; it works for one spawn path
  only; the verdict is `ask`; or the reason omits the rule, the file, or CRITERIA.md, or tells
  the agent how to disable the guard.

### C4 — (join branch) An identified plan-blind agent cannot reach a forbidden file through the shell, while ordinary shell work stays untouched
- **Observe:** Engine drive, blindfold ON, identified `astro-verifier`: `Bash` commands
  `cat .astrocode/phases/39-x/PLAN.md`, `head -n 5 "$P/.astrocode/phases/39-x/SPEC.md"`,
  `grep -n foo .astrocode/phases/39-x/PLAN.md`, `sed -n 1p .astrocode/phases/39-x/plan.md`,
  `cp .astrocode/phases/39-x/PLAN.md /tmp/x`, `rg TODO .astrocode/phases` and
  `grep -r foo .astrocode/phases/39-x` → DENIED. `node --test tests/`,
  `cat .astrocode/phases/39-x/CRITERIA.md`, `git log --oneline -5`, `ls src` → ALLOWED.
  Repeat the forbidden set for `astro-criteria-author` including `cat …/ACCEPTANCE.md` → DENIED.
- **Fails if:** a command naming a forbidden file (or recursively searching a phase dir) as an
  operand is allowed; or a command that names no forbidden file and searches no phase dir is
  denied.

### C5 — (join branch) Broad Grep/Glob over the phases tree is denied for those agents, narrowed searches are allowed
- **Observe:** Engine drive, blindfold ON, identified `astro-verifier`: `Grep` with `path`
  `<P>/.astrocode/phases/39-x`, `<P>/.astrocode/phases`, `<P>/.astrocode`, or `<P>` (a parent)
  and no narrowing glob → DENIED; `Glob` with pattern `**/*.md` under `<P>/.astrocode/phases`
  → DENIED. `Grep` with `path` `<P>/.astrocode/phases/39-x/CRITERIA.md`, `Grep` over
  `<P>/src`, and `Glob` `src/**/*.js` → ALLOWED.
- **Fails if:** a search whose results could include PLAN.md/SPEC.md (or ACCEPTANCE.md for the
  criteria author) is allowed, or a search confined to allowed files or to source/tests is
  denied.

### C6 — (join branch) Only the two plan-blind roles are affected: allowed files stay readable for them, and executors, planners, other agents and the main session read the plan freely
- **Observe:** Engine drive, blindfold ON. Identified `astro-verifier` / `astro-criteria-author`
  `Read` of CRITERIA.md, CONTEXT.md, PROJECT.md, CONVENTIONS.md, `src/a.js`, and
  `<P>/docs/PLAN.md` (a PLAN.md outside `.astrocode/phases/`) → ALLOWED. `Read` of
  `…/39-x/PLAN.md` by: an `agentId` resolving to `astro-executor`, `astro-planner`,
  `astro-researcher`, `workflow-subagent`, a non-astro type; and a main-loop `tool.check` with
  no `agentId` → all ALLOWED.
- **Fails if:** any of those is denied (a guard keyed on "any subagent", on the path alone, or
  on an unresolved agent), or blindfold answers an explicit allow instead of passing through.

### C7 — (join branch) Turning blindfold off restores every forbidden read, and the guard keeps no state of its own
- **Observe:** Engine drive with the switch OFF (stubbed `ac` answer): every DENIED case from
  C3-C5 → ALLOWED, and the join source stub is never consulted. In the sandbox (with
  `ac install` done): `ac mods enable blindfold` then `ac mods disable blindfold`, and
  `ac mods status --json` reflects each. After running the whole engine drive with HOME and
  cwd pointing at fresh empty dirs, list both trees: the plugin created no file anywhere
  (no persisted agent map or cache).
- **Fails if:** an off switch still denies; the switch is read from anywhere but `ac`; or any
  file is written by the plugin (ADR-071 c: an in-memory per-session cache at most, never
  persisted).

### C8 — A guard that cannot identify the agent lets the action through and says so at most once per session
- **Observe:** Engine drive, blindfold ON, `Read` of `…/39-x/PLAN.md` by an `agentId` after an
  `astro-verifier` spawn, in three variants of the join source: it throws, it hangs past any
  timeout, and it returns no entry for that `agentId`. Fire the event three times per variant
  within one session. Every call resolves ALLOWED within bounded time with no exception
  escaping, and the `ui.toast` stub counts at most one notice per session for the
  throw/timeout variants. Under the no-join branch, the same calls are ALLOWED with no join
  source at all.
- **Fails if:** an unidentified or unresolvable agent is denied (fail-closed), an error or hang
  propagates to Claude, or a notice is emitted per call.

### C9 — Enabling a mod feature before `ac install` records the switch and tells the user to run `ac install` first, instead of surfacing a raw Claude error
- **Observe:** Fresh sandbox, real `claude` ≥ 2.1.292 on PATH, `ac install` NOT run (no
  `$HOME/.astro/code/mods`). Run `ac mods enable blindfold` (and again with `witness`). Output
  contains a line telling the user to run `ac install` first; it contains no raw
  `claude plugin marketplace add` error text; `ac mods status --json` shows the switch on.
  Afterwards `ac install` then `ac mods enable blindfold` completes without that line.
- **Fails if:** the switch is not recorded; the fix line is missing; the raw marketplace error
  is shown to the user; or the command crashes or exits as a hard failure with no guidance.

### C10 — `ac mods` never creates a Claude home as a side effect, so a Cursor-only machine stays Cursor-only
- **Observe:** Fresh sandbox with NO `$HOME/.claude` and NO `$HOME/.claude.json`, real `claude`
  on PATH. Run `ac mods status`, `ac mods status --json`, `ac mods status blindfold`, and
  `ac mods enable canon-guard` / `ac mods disable canon-guard`. After each, `$HOME/.claude` and
  `$HOME/.claude.json` are still absent; status still exits 0 and reports a coherent Claude
  availability (version, or explicitly unknown/not checked). Then, with a Cursor config dir
  present (`mkdir -p $HOME/.cursor`) run `ac install` and confirm it did not switch Cursor into
  its Claude-import mode (the same outcome as `ac install` on a sandbox where `ac mods status`
  was never run).
- **Fails if:** either path appears after any `ac mods` command, or the post-status
  `ac install` treats the machine as having Claude when it did not before.

### C11 — The plugin with blindfold still passes Claude Code's own plugin checks, and no command or agent depends on the mod
- **Observe:** `claude plugin validate --strict /Users/buu/Development/astro-code/mods` and
  `… /mods/astro-mods` exit 0; `claude plugin test /Users/buu/Development/astro-code/mods/astro-mods`
  exits 0. `astro-verifier` and `astro-criteria-author` agent bodies still state the plan-blind
  rule in prose on their own (Codex/Cursor keep the prose rule), and the repository's
  mod-dependency guard test is green.
- **Fails if:** validate or test fails (e.g. a feature module handing `$` to an imported
  helper, which phase 36 found the validator rejects); or any command/agent body now requires
  blindfold to be enabled, or the prose rule was removed in favour of the mod.

### C12 — The whole suite stays green on the zero-dependency substrate, with and without Claude on PATH
- **Observe:** `node --test tests/` from the repo → exit 0, zero failures. Again with
  `PATH="$(dirname "$(command -v node)"):/usr/bin:/bin"` (confirm `command -v claude` empty) →
  exit 0, Claude-requiring tests reported skipped, not failed. `package.json` has no
  `dependencies` / `devDependencies` entries.
- **Fails if:** any test fails or crashes at load, the suite needs an install step, or a
  dependency was added (ADR-001).
