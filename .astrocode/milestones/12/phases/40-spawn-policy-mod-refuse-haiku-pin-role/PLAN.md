# Plan — phase 40: spawn-policy (re-scoped): refuse an unisolated concurrent executor, probe first

This plan follows:
- `.astrocode/CONVENTIONS.md`:
  - zero dependencies (ADR-001);
  - named exports only;
  - `node:test` with a real fs;
  - comments that are dense and say why.
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-005 and ADR-008, the rule enforced;
  - ADR-018, RED tests use `await import`;
  - ADR-020, every wave boundary is green;
  - ADR-021, CRITERIA.md is the bar;
  - ADR-071 (a)–(e), mod rules;
  - ADR-073, no haiku refusal.
- This phase's `CONTEXT.md`, decisions 1–4. **CONTEXT.md is the scope. The roadmap name is stale.**

It aims at `CRITERIA.md` C1–C11 under its branch rule.

Principles brief (`--stage plan --by planner`), applied:
- `enforce-critical-agent-behavior-with-a-ce7b`: a guardrail only if its signal is
  deterministic. Otherwise defer.
- `optional-or-auxiliary-capabilities-b940`: fail open, and give a visible reason.
- `state-each-rule-in-exactly-one-place-9173`: the deny text cites ADR-008 and does not restate it.
- `keep-tooling-deterministic-and-leave-333f`: no prompt-prose heuristics.

## Facts settled during planning (static; t4 confirms live)

Source: the plugin API types bundled with Claude Code **2.1.292**,
`/tmp/claude-1001/bundled-skills/2.1.292/*/plugin-authoring/types/claude-code.d.ts`. This is
documentation, not observation. PROBE.md must keep it in a separate "documented" column and
never mark it observed.

- **S1** `AgentSpawnInput` has **no `isolation` field**. `isolation?: 'worktree'|'remote'` exists
  only on `AgentSpec`, a plugin-registered agent type.
- **S2** `cwd` on `agent.spawn` is "the directory the subagent runs in when the call set one;
  undefined means the parent's". A worktree the engine creates for `isolation:'worktree'` may
  therefore not appear there. Only t4 can tell.
- **S3** `$.agent.list()` returns subagents and teammates, but **"a workflow's are not"** listed.
  Liveness of workflow executors is not available from the list. A source that might still show
  it: the `agentId` that `next(e)` answers on `agent.spawn`, paired with `turn.complete`.
- **S4** A hook can only **refuse** a workflow agent (`{deny}`). Content rewrites are ignored.
  `parentAgentId`, `isTeammate` and `workflow` are pinned.
- **S5** `workflows/execute-phase.mjs`:
  - The auto-picker goes parallel only when `tasks > seqBudget (8)` and `maxWidth ≥ 2`.
    `args.strategy: "parallel"` forces it (`commands/astro-execute.md:89`).
  - Wave executors are spawned with `isolation:'worktree'` (~L1413).
  - Integrator, testgate, teardown and the batched executor are also `astro-executor`, and are
    told apart only by script `label`, which is not on the event (phase-36 PROBE).

Prior expectation: **no signal**. S1 and S3 make (a) and (b) unlikely. The live run still decides
(C1), and the plan does not presume it.

## Branch handling

**t4's PROBE.md verdict decides the branch.** Everything below is valid on both branches except
t3's overlap case, which pins the no-signal behaviour.

**No signal (expected).**
- `built` stays `false`.
- Only the description, the regression tests and PROBE.md ship.
- PROBE.md's verdict section puts the decision in front of the user: keep the phase parked,
  re-probe on a later Claude Code, or drop it (C2).

**Signal found.**
- t4 commits PROBE.md naming the exact fields and the example values seen.
- It does **not** flip `built` and does **not** write a refusal.
- t4 reports `REPLAN: signal found (<fields>)` as its last line.
- The refusal is then planned by re-running `/astro-plan 40` with PROBE.md as input:
  - C3, C4, C6, C7;
  - flipping `built`;
  - revising t3's overlap case.

  Its shape (where the deny reads its fields, how liveness is kept in memory without disk state)
  depends on which field carries the signal. Designing it before the probe would be guessing
  (ADR-071 a).
- t5 still runs.

## Tasks

### t1 — Extend the probe to capture isolation, liveness and refusal at spawn time
- **id:** t1
- **file:** `scripts/mods-probe/hooks/probe.js`
- **depends_on:** []
- **Changes to `onAgentSpawn`.** Log as now, plus:
  - `cwd` and `parentAgentId` values in full. These are paths and ids, not secrets.
  - `next.origin`.
  - The answer of `next(e)`, as `{model, agentId, deny}`. Await it, record it, and return it
    untouched, the same way `onToolCheck` does.
  - A `$.agent.list()` snapshot taken at that moment, as rows of `{id, type, status, parentId, name}`.
    Cut `description` like the other fields. Wrap the call in try/catch; a failure is logged as
    `{listError}`.
- **New hook `onTurnComplete`.** Logs `agentId` and `keys`; the answer is reduced to `shape()`.
  It shows whether a workflow executor's end is observable.
- **New opt-in `ASTRO_MODS_PROBE_DENY_INDEX=<n>`.**
  - When set, the workflow agent with that `agentIndex` gets
    `{deny: 'astro-mods probe: refused on purpose'}`, to observe C1(d) and how the workflow reacts.
  - When unset, the probe stays a pure observer.
  - Document it in the header beside `ASTRO_MODS_PROBE_LOG`.
- **Rules the edit must keep:**
  - Every registration stays a literal `on('<event>', fn).catch(pass)` (phase-36 F3).
  - `$` is never handed to an imported helper.
  - Redaction is unchanged.
- **Gate:** `claude plugin validate --strict scripts/mods-probe` exits 0.
- **Commit:** `chore(mods-probe): …`.

### t2 — spawn-policy is described as isolation-only, and stays unbuilt
- **id:** t2
- **file:** `lib/mods.mjs`, `tests/mods.test.mjs`, `tests/mods_cli.test.mjs`, `MANUAL.md`
- **depends_on:** []
- **Test-first, within the task.**
  - In `tests/mods.test.mjs`, beside the registry test at ~L82, add a test through the existing
    `await mods()` dynamic import (ADR-018). It asserts:
    - spawn-policy's description matches `/isolat/`;
    - it does not match `/haiku|pin/i`;
    - `built === false`.
  - Run the test and watch it fail.
- **Then change `lib/mods.mjs:65`.**
  - Set the description to `refuse a parallel executor spawned without worktree isolation (ADR-008)`.
  - Keep `built: false`. A signal-branch replan flips it, never this task.
  - Keep the `FEATURES` header comment accurate.
- **In `tests/mods_cli.test.mjs`, in the "not-yet-built is said" test (~L100), add:**
  - `ac mods enable spawn-policy` prints `/not built yet/`;
  - `ac mods status spawn-policy` shows the new description and no `haiku` or `pin`;
  - disable it again, so sibling assertions are unaffected.
- **In `MANUAL.md` line ~116**, change only the `spawn-policy` row's "does" cell to the same
  description (C5's user-facing text).
  - Note: at plan time the main tree holds **uncommitted** phase-38 edits to `MANUAL.md`. Touch
    that one cell only.
  - If integration hits the dirty file, surface it and do not stash (ADR-035/038).
- **Gate:** `node --test tests/mods.test.mjs tests/mods_cli.test.mjs` is green.
- **Commit:** `feat(mods): …`.

### t3 — Engine test: with spawn-policy on, every spawn passes through untouched and its model is never changed
- **id:** t3
- **file:** `mods/astro-mods/hooks/register.test.tsx`
- **depends_on:** []
- **Test-only, green on arrival.** It is a characterization test that pins C2 and C5 against
  regressions. It imports nothing new, only `claude-code/testing`.
- **Setup.**
  - The `process.run` stub answers
    `{switches:{'spawn-policy':true}, warnings:[]}`.
  - Fire `$.session.start(START)`.
- **Below the plugin.** An `agent.spawn` stub records each event it receives and answers
  `{model: e.model ?? 'inherit', agentId: 'a<n>'}`.
- **Fire `$.agent.spawn` for each of these shapes:**
  - (i) two `astro-executor` spawns with no `cwd`, overlapping, shaped as phase-36 PROBE records
    a wave. Pass `workflow:{runId:'wf_x', agentIndex:2|3}` if the harness accepts it. If it does
    not, say so in a comment and use the Agent-tool shape.
  - (ii) an Agent-tool `astro-executor` spawn;
  - (iii) an `astro-verifier` spawn;
  - each with `model` set to `'haiku'`, `'sonnet'`, `'opus'` and `undefined`.
- **Assert, for every spawn:**
  - the result equals the stub's answer (no `deny`, no allow of the plugin's own);
  - the stub saw the same `model`, with `undefined` staying `undefined`.
- **Comment the why:**
  - ADR-073: no haiku refusal.
  - CONTEXT decision 2: never touch `model`.
  - PROBE.md phase 40: spawn-policy is unbuilt, so nothing refuses.
  - A signal-branch replan revises case (i).
- **Gate:** `claude plugin test mods/astro-mods` exits 0, and
  `claude plugin validate --strict mods/astro-mods` exits 0.
- **Commit:** `test(mods): …`.

### t4 — Live parallel-wave probe on ≥ 2.1.292; write PROBE.md with the verdict
- **id:** t4
- **file:** `.astrocode/phases/40-spawn-policy-mod-refuse-haiku-pin-role/PROBE.md`
- **depends_on:** [t1]
- **Setup, the phase-36 way.**
  - Scratch dir from `mktemp -d`, outside the repo. Neither the scratch dir nor the logs are
    committed.
  - `git init`, `ac init`, `ac registry init` against a bare `<scratch>/remote.git`, then
    `ac models fast`.
  - One throwaway phase whose PLAN has **≥ 3 independent tasks on distinct files**.
  - Load the probe with `claude -p --plugin-dir <repo>/scripts/mods-probe
    --permission-mode bypassPermissions`, with `ASTRO_MODS_PROBE_LOG` set.
  - Record `claude --version`.
- **Runs:**
  - **R1, parallel.** `/astro-execute 1` with `args.strategy: "parallel"` and `use_worktrees`
    true. If the command will not pass the override, use ≥ 9 independent tasks.
    - It must log **≥ 2 `astro-executor` `agent.spawn` events in one wave**, plus the
      integrator, testgate and teardown spawns if they occur.
    - Worktree creation may fail under lean-ctx (phase 37). Spawn-time fields are still what
      count.
  - **R2, sequential.** Same project, `ac config set use_worktrees false`, a fresh phase.
  - **R3, Agent-tool.** One Agent-tool `astro-executor` spawn, like phase-36 run 2.
  - **R4, deny.** R1 again with `ASTRO_MODS_PROBE_DENY_INDEX` set to a wave executor's index.
    Observe whether the spawn is stopped, and what the workflow does next (null hole, then an
    on-branch re-run or a `worktreesUnavailable` latch).
- **Write PROBE.md** in phase-36 shape: dense, machine-read, runs table with commands.
  - For each source give observed-with-example-value or `not observed`, plus a separate
    "documented" column holding S1–S4. Sources: `agent.spawn` fields (`cwd`, any
    isolation-like key), the `next(e)` answer, `$.agent.list()`, `turn.complete`, `next.origin`.
  - Answer four questions per source:
    - (a) does this spawn get a worktree;
    - (b) which other executors are live;
    - (c) what tells a wave executor from the integrator, testgate and teardown;
    - (d) can the hook stop a spawn.
- **Verdict rule (decided by fields, never by config, order or timing).**
  - **Signal found** only if all three hold:
    - (a) is answered by a spawn-time field that differs deterministically between isolated and
      unisolated executor spawns;
    - (b) is answered from events alone;
    - (c) is answered by a field rather than prompt prose.
  - A prompt-substring match (`EXEC_IDENTITY`, `SYNC FIRST (ADR-040)`) is recorded but **does
    not count** (ADR-071 a).
  - Anything less is **no signal**.
- **Verdict section.**
  - On no signal, name the user's decision: keep parked, re-probe on a later Claude Code (say
    what field would unblock it), or drop the phase.
  - On signal found, see Branch handling above.
- **Report every `host` command used**, if any. Prefer the container's `claude`.
- **Commit:** `docs(phase-40): …`.

### t5 — Close-out gates, recorded in PROBE.md
- **id:** t5
- **file:** `.astrocode/phases/40-spawn-policy-mod-refuse-haiku-pin-role/PROBE.md`
- **depends_on:** [t2, t3, t4]
- **Append a "Gates" section to PROBE.md, with counts:**
  - `node --test tests/`: 0 failures. Run it again with
    `PATH="$(dirname "$(command -v node)"):/usr/bin:/bin"` and confirm `command -v claude` is
    empty. Claude tests show as skipped, not failed. (C11)
  - `claude plugin validate --strict` on `mods`, `mods/astro-mods` and `scripts/mods-probe`, and
    `claude plugin test mods/astro-mods`: all exit 0. (C9)
  - `package.json` has no deps. (C11)
  - `ac models` output in a sandbox project is identical at the phase base and at head:
    - profiles: default, `ac models fast`, `--effort deep`, and a local-model setting;
    - get the base through `git worktree add` of the pre-phase commit into the sandbox, then
      remove it. (C10)
  - In a sandbox `HOME`, `ac mods status --json` reports spawn-policy built exactly as the
    verdict says. (C1)
  - The mod-dependency guard in `tests/hosts.test.mjs` is green. (C8)
- **Do not fix code in this task.** A failure means re-running the owning task.
- **Commit:** `docs(phase-40): gates`.

## Waves

- Wave 1: t1, t2, t3. Their files are disjoint.
- Wave 2: t4, which depends on t1.
- Wave 3: t5, which depends on t2, t3 and t4.

## Rule checks

- **RED-import rule.** t2's new assertion reaches `FEATURES` through the existing
  `await mods()`. t3 is test-only and imports nothing new.
- **Wave-green rule.** Nothing is deleted or renamed. Each task leaves the suite green on its
  own.
- **Same-file rule.** t4 and t5 both touch PROBE.md, and t5 depends on t4. No two wave-1 tasks
  share a file.
- **Every task declares its file(s).** Every task commits; there are no `commits: none` gates.
