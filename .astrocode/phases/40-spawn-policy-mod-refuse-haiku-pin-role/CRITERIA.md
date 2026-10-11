# Criteria — phase 40: spawn-policy mod (re-scoped: worktree isolation for parallel executor waves)

> Pre-registered, plan-blind. Derived from the phase goal as re-scoped by CONTEXT.md (decisions
> 1-4, out-of-scope list, open questions) and canon (ADR-005, ADR-008, ADR-071, ADR-073,
> CONVENTIONS §Testing). The roadmap name ("refuse haiku, pin role models") is stale; CONTEXT.md
> is the scope. The plan and the verifier both answer to this bar.

## Branch rule (read first)

CONTEXT decision 4 makes this phase two-outcome: the live probe either finds a reliable
spawn-time isolation/concurrency signal or it does not.
- **Signal found:** C1, C3-C11 apply. C2 is not applicable.
- **No signal:** C1, C2, C5, C8-C11 apply. C3, C4, C6, C7 are reported **not applicable**
  (never PASS), and the verdict must say the enforcement goal was not reached and is escalated
  to the human, as CONTEXT decision 4 requires.
Which branch holds is decided by C1's evidence, never by a claim in a summary or commit.

## Shared harness

- **Sandbox.** Never touch the real home. `S=$(mktemp -d)`; `export HOME=$S/home`;
  `mkdir -p $HOME`; unset `CLAUDE_CONFIG_DIR`, `CURSOR_CONFIG_DIR`. `ac` below means
  `node /Users/buu/Development/astro-code/bin/ac.mjs`.
- **Engine drive.** Copy the shipped plugin (`cp -r /Users/buu/Development/astro-code/mods/astro-mods $S/plug`)
  and add a verifier-authored `*.test.tsx` using `claude-code/testing` (the harness the plugin's
  own engine test uses), run with `claude plugin test $S/plug`. Beneath the plugin, stub
  `process.run` so `ac mods status --json --switches-only` answers the switch state the
  criterion needs; stub whatever isolation/concurrency source PROBE.md (C1) records as observed
  (e.g. `$.agent.list()`, an `agent.spawn` field, the spawn `cwd`, `next.origin`); stub
  `ui.toast` to count notices. Fire `session.start`, then `agent.spawn` events (and/or the
  hook point PROBE.md records as able to stop a spawn) shaped exactly as PROBE.md (phase 36
  and phase 40) records them.
- **Spawn fixtures.** "Wave executor" = an `astro-executor` spawn carrying the workflow
  run/index (or label) PROBE.md records for a wave task. "Integrator / testgate / teardown" =
  an `astro-executor` spawn carrying whatever PROBE.md records as distinguishing those.
  "Isolated" / "not isolated" and "another executor live" are expressed only through the
  observed fields PROBE.md names.
- **DENIED** = the plugin's answer at the spawn-refusal point is a deny/refusal carrying a
  reason. Never `ask`.
- **ALLOWED** = the plugin's answer is exactly what the stub beneath it answered (pass-through
  via `next(e)`), with the event handed downstream unmodified. A plugin that answers its own
  explicit allow is NOT "allowed" here: it would override the user's own permission rules.

---

### C1 — Whether a spawn reveals worktree isolation and concurrent executors is answered by a live parallel-wave probe, recorded in the phase dir, and the shipped `built` state matches the answer
- **Observe:** Read `PROBE.md` in `.astrocode/phases/40-spawn-policy-mod-refuse-haiku-pin-role/`.
  It must name the Claude Code version it ran on (≥ 2.1.292) and show at least one run that
  spawned **two or more `astro-executor` agents in the same wave** with worktree mode on
  (a wave that later failed, e.g. on worktree creation under lean-ctx, is acceptable if the
  spawns were observed), plus a sequential run (`use_worktrees=false` or the Agent-tool path)
  for contrast. For each candidate source CONTEXT decision 4 lists — `agent.spawn` fields,
  `$.agent.list()`, `next.origin`, the spawn's `cwd` — it reports, each marked observed (with
  an example value) or `not observed`: (a) whether the spawning agent gets a worktree, (b)
  which other executors are live at that moment, (c) what tells a wave executor apart from an
  integrator/testgate/teardown `astro-executor`, and (d) whether the refusal point can actually
  stop a spawn. It ends in an explicit verdict: signal found (naming the exact fields) or no
  signal. Then in the sandbox run `ac mods status --json` and `ac mods status spawn-policy`:
  spawn-policy reports built exactly when the verdict is "signal found".
- **Fails if:** PROBE.md is missing; no run had two or more concurrent executor spawns; the
  verdict rests on documentation, config inference (e.g. reading `use_worktrees`), spawn order
  or timing rather than an observed field; a field is presented as observed without an example
  value; wave executors cannot be told apart from integrator/testgate/teardown yet the verdict
  is "signal found"; or the built state disagrees with the verdict.

### C2 — (no-signal branch) Without a reliable signal, nothing approximate ships, switching spawn-policy on refuses nothing, and the blocker is put in front of the user
- **Observe:** In the sandbox: `ac mods enable spawn-policy` — the output says the feature is
  not built; `ac mods status --json` reports it not built. Engine drive with the switch ON:
  two overlapping wave-executor spawns with no isolation indication, a sequential executor
  spawn, and an Agent-tool executor spawn → every one ALLOWED. The blocker is findable without
  reading the plan: it appears in at least one user-facing record (`ac debt list`,
  `ac backlog list`, `ac status`/the phase note, or PROBE.md's verdict section naming the
  decision the user must make — keep, re-probe later, or drop the phase).
- **Fails if:** any spawn is refused (a guess from config, spawn count, timing or labels shipped
  as an approximation — ADR-071 a); spawn-policy reports built; or the blocker exists only in a
  commit message or the plan.

### C3 — (signal branch) A wave executor that would run concurrently with another executor in the same working tree, without worktree isolation, is refused with a reason quoting ADR-008 and naming both fixes
- **Observe:** Engine drive, switch ON, source stubbed so another wave executor is live in the
  same tree and the new wave-executor spawn has no worktree → DENIED. The reason quotes or
  cites ADR-008 (parallel-without-isolation is never allowed), names
  `ac config set use_worktrees false` as the sequential fix, and names fixing worktree creation
  as the other fix. Repeat with three overlapping executors → the second and third are DENIED.
- **Fails if:** the spawn is ALLOWED; the verdict is `ask`; the reason omits ADR-008 or either
  fix; or the refusal only triggers on a config value rather than on the observed
  isolation/concurrency of the spawn.

### C4 — (signal branch) Every legitimate spawn passes untouched: isolated parallel executors, sequential executors, the integrator/testgate/teardown, and non-executor agents
- **Observe:** Engine drive, switch ON, each → ALLOWED (pass-through, unmodified):
  (a) two concurrent wave executors each in its own worktree; (b) a single wave executor with no
  other executor live and no worktree (`use_worktrees=false` sequential run); (c) an Agent-tool
  `astro-executor` spawn with no other executor live (ADR-008 fallback); (d) an integrator,
  testgate and teardown `astro-executor` spawned while (or right after) wave executors are live;
  (e) concurrent `astro-researcher` / `astro-verifier` / `workflow-subagent` spawns in one tree;
  (f) a second wave executor spawned after the first one finished.
- **Fails if:** any of these is denied — a guard keyed on "any executor", on executor count
  regardless of liveness, on `use_worktrees` alone, or one that treats the integrator as a
  wave executor (CONTEXT out-of-scope) — or the plugin answers an explicit allow.

### C5 — spawn-policy never refuses, overrides or fills a spawn's model, haiku included
- **Observe:** Engine drive, switch ON (both branches), on an otherwise-ALLOWED spawn shape
  (C4 a/b, or any spawn in the no-signal branch): spawns with `model` = `"haiku"`, `"sonnet"`,
  `"opus"`, and `undefined` (local-model / inherit), for `astro-executor`, `astro-verifier` and
  an integrator-labelled executor → every one ALLOWED, and the event the stub beneath receives
  has the same `model` value as the one fired (`undefined` stays `undefined`). In the sandbox,
  `ac mods status spawn-policy` (and the `--json` description) describes the feature as
  isolation of parallel executors only, with no claim about refusing haiku or pinning models.
- **Fails if:** a haiku spawn is denied (ADR-073 lifted the ban; ADR-035's haiku rule must not
  be enforced here); any `model` is changed, filled from config, or removed; or the user-facing
  description still promises haiku refusal or model pinning.

### C6 — (signal branch) Turning spawn-policy off restores every refused spawn, and the mod keeps no state of its own
- **Observe:** Engine drive with the switch OFF (stubbed `ac` answer): every DENIED case from
  C3 → ALLOWED, and the isolation/concurrency source stub is never consulted. In the sandbox
  (after `ac install`): `ac mods enable spawn-policy` then `ac mods disable spawn-policy`, and
  `ac mods status --json` reflects each. After running the whole engine drive with HOME and cwd
  pointing at fresh empty dirs, list both trees: the plugin created no file anywhere.
- **Fails if:** an off switch still refuses; the switch is read from anywhere but `ac`; or the
  plugin persists any live-agent map or cache to disk (ADR-071 c).

### C7 — (signal branch) A lookup that fails lets the spawn through and says so at most once per session
- **Observe:** Engine drive, switch ON, the C3 deny shape, in three variants of the
  isolation/concurrency source: it throws, it hangs past any timeout, it returns nothing for
  the spawn. Fire each three times in one session. Every spawn resolves ALLOWED within bounded
  time, no exception escapes, and `ui.toast` counts at most one notice per session for the
  throw/timeout variants.
- **Fails if:** a spawn is refused when the lookup failed (fail-closed, against ADR-071 e); an
  error or hang propagates to Claude; or a notice is emitted per spawn.

### C8 — The mod is optional: workflows still run parallel-with-isolation or sequential on their own, and no command or agent depends on spawn-policy
- **Observe:** With spawn-policy OFF and no plugin installed, the execute workflow/command
  bodies still choose sequential execution when the Workflow tool or worktrees are unavailable
  (ADR-008) — read the execute command and workflow and confirm that rule is stated/implemented
  there, not delegated to the mod. Run the repository's mod-dependency guard test
  (`node --test tests/` covers it) → green.
- **Fails if:** any command, agent or workflow body now requires spawn-policy to be enabled, or
  the sequential-fallback rule was removed from them in favour of the mod (ADR-071 b).

### C9 — The plugin with spawn-policy still passes Claude Code's own plugin checks
- **Observe:** `claude plugin validate --strict /Users/buu/Development/astro-code/mods` and
  `… /mods/astro-mods` exit 0; `claude plugin test /Users/buu/Development/astro-code/mods/astro-mods`
  exits 0.
- **Fails if:** validate or test fails (e.g. a feature module handing `$` to an imported helper,
  which phase 36 found the validator rejects).

### C10 — Model resolution for roles is unchanged by this phase
- **Observe:** In a sandbox project (`ac init` or a copy of a fixture), compare
  `ac models` / the per-role model resolution output (default profile, `--fast`,
  `--effort deep`, and a local-model setting) between this phase's head and the commit before
  the phase started (`git stash`-free: use `git worktree add` of the base commit in `$S`, or
  `git show <base>:lib/... ` run via a temp checkout). Outputs are identical.
- **Fails if:** any role's resolved model differs — this phase slipped in the haiku-per-role
  change (backlog `2026-10-11-implement-the-haiku-per-role-adr-let`, out of scope) or a pinning
  rule.

### C11 — The whole suite stays green on the zero-dependency substrate, with and without Claude on PATH
- **Observe:** `node --test tests/` from the repo → exit 0, zero failures. Again with
  `PATH="$(dirname "$(command -v node)"):/usr/bin:/bin"` (confirm `command -v claude` empty) →
  exit 0, Claude-requiring tests reported skipped, not failed. `package.json` has no
  `dependencies` / `devDependencies` entries.
- **Fails if:** any test fails or crashes at load, the suite needs an install step, or a
  dependency was added (ADR-001).
