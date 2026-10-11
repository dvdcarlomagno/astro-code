# PROBE — phase 40: does a spawn reveal worktree isolation or a concurrent executor?

Machine-read, dense. "Observed" columns come from `scripts/mods-probe/` (phase 40 t1) on live
runs. "Documented" columns come from the plugin API types bundled with Claude Code 2.1.292
(`plugin-authoring/types/claude-code.d.ts`) and are NEVER evidence. A source not seen is
`not observed`.

- Claude Code: **2.1.292** (`claude --version` -> `2.1.292 (Claude Code)`), the floor.
- Date: 2026-10-11. Driving session model `claude-opus-5-5[1m]`. Container `claude`; no `host` command was used.
- Scratch project (outside the repo, not committed): `mktemp -d`, `git init`, `ac init`,
  `ac registry init` against a bare `remote.git`, `ac models fast`. Phase 1: 9 independent
  tasks on distinct files; phase 2: 2 tasks; phase 3: 9 tasks. 9 > seqBudget 8, so the
  auto-picker goes parallel; the prompt also asked for `args.strategy="parallel"` with worktrees.
- All runs: `claude -p --plugin-dir <repo>/scripts/mods-probe --permission-mode bypassPermissions`
  with `ASTRO_MODS_PROBE_LOG=<scratch>/rN.jsonl`, cwd `<scratch>/proj`.

## Runs

| run | what | command tail |
|---|---|---|
| R1 | parallel wave, `use_worktrees` true | `"/astro-execute 1 (pass args.strategy=\"parallel\" and use worktrees to the Workflow)"` |
| R2 | sequential, `ac config set use_worktrees false`, fresh phase 2 | `"/astro-execute 2"` |
| R3 | Agent-tool `astro-executor` | `"Use the Agent tool to delegate to the astro-executor subagent one trivial task: create file agent.txt ..."` |
| R4 | deny, phase 3, R1 shape plus `ASTRO_MODS_PROBE_DENY_INDEX=4` | same as R1 with phase 3 |

Outcomes:
- **R1**: 12 `agent.spawn`. Index 1 `workflow-subagent` (discover); **indices 2-10 are nine
  `astro-executor` spawns at the same millisecond** (`20:28:23.135`), one wave; indices 11 and
  12 are later `astro-executor` spawns (integrator / heal, sequential after the wave
  finished). The wave failed on worktree git (lean-ctx guard refused git inside the
  worktrees; only t4 and t6 landed). Per the workflow's own report the executors DID run in
  worktrees, so the spawns were isolated in fact.
- **R2**: 4 spawns, indices 1-4: `workflow-subagent`, two sequential `astro-executor`, `astro-verifier`.
- **R3**: 1 spawn, `astro-executor`, no `workflow` key.
- **R4**: index 4 denied by the probe; the other eight wave executors ran; the workflow then
  spawned index 11 (an on-branch re-run of the refused task, t3, which succeeded) plus 12 and 13.

## Sources, observed vs documented

Spawn keys (identical in R1, R2, R4): `tool_use_id, prompt, description, subagentType,
provider, model, parentModel, permissionMode, background, fork, workflow, name, cwd`. R3 has
the same minus `workflow`.

| source | observed | documented (not evidence) |
|---|---|---|
| `agent.spawn` `cwd` | key present, value `undefined` on EVERY spawn in R1, R2, R3, R4 (including the nine wave executors that ran in worktrees) | "directory the subagent runs in when the call set one; undefined means the parent's" (S2) |
| any isolation-like key on `agent.spawn` | not observed (no `isolation`/`worktree` key in any run) | `AgentSpawnInput` has no `isolation`; it exists only on `AgentSpec` (S1) |
| `parentAgentId` | key absent / `undefined` on every spawn (all from the main loop) | pinned for workflow agents (S4) |
| `workflow` | observed on workflow spawns only: `{runId:"wf_ebcaa955-fac", agentIndex:2..10}` (R1); absent in R3 | pinned (S4) |
| `next(e)` answer | observed: `{model:"claude-sonnet-5-5", agentId:"aac7c537b165c967f"}`; no `deny` key on allowed spawns | `{model, agentId}` or `{deny}` |
| `next.origin` | observed: `{plugin:"engine", tier:"core"}` on every spawn; identical for wave executors and everything else | origin of the next hook |
| `$.agent.list()` at spawn | observed: `[]` at every workflow spawn, including while 8 sibling executors were live | "a workflow's [agents] are not" listed (S3) |
| `turn.complete` | observed: carries `agentId` (matches the `next(e)` answer's `agentId`) plus `answer, durationMs, isAborted, turnId, reason, usage`; fires per executor when it ends. The main loop's own turn has no `agentId` | each agent's answer is its own `turn.complete` |

## The four questions, per source

| source | (a) does this spawn get a worktree | (b) which other executors are live | (c) wave executor vs integrator/testgate/teardown | (d) can the hook stop a spawn |
|---|---|---|---|---|
| `cwd` | no: `undefined` for isolated (R1) and unisolated (R2) spawns alike | no | no | n/a |
| isolation-like key | not observed | n/a | n/a | n/a |
| `parentAgentId` | no | no | no | n/a |
| `workflow.agentIndex` | no | no (spawn order only) | no field; only index order and timing, which are not fields | n/a |
| `next(e)` answer | no | the `agentId` is a handle only | no | n/a |
| `next.origin` | no: same value for all | no | no | n/a |
| `$.agent.list()` | no | no: `[]` with 8 siblings live | no | n/a |
| `turn.complete` | no | YES, in memory: spawn `agentId` (answer) minus `turn.complete` `agentId` = live set, from events alone | no | n/a |
| hook `{deny}` on `agent.spawn` | n/a | n/a | n/a | **YES (R4)**: index 4 never started; the workflow tolerated the null hole and re-ran that task on-branch as a later executor (index 11) |

Spawn-time prompt prose (`EXEC_IDENTITY`, `SYNC FIRST (ADR-040)`) could separate wave from
integrator, but a prompt-substring match is recorded and does NOT count (ADR-071 a).

## Verdict: **NO SIGNAL**

Rule (decided by fields, never config, order or timing): signal found only if (a) a spawn-time
field differs deterministically between isolated and unisolated executor spawns, (b) liveness
is answerable from events alone, and (c) wave executors are told apart by a field, not prose.

- (a) FAILS: no field differs. Nine worktree-isolated wave executors (R1) and plain sequential
  executors (R2) carry identical `cwd: undefined`, `origin`, `parentAgentId`, `provider`, and no isolation key.
- (b) holds in memory (`next(e)` answer + `turn.complete`), but only as a count of live
  executors, which says nothing about isolation.
- (c) FAILS: integrator, heal and later executors are the same `astro-executor` shape as wave
  executors, differing only by `agentIndex` order and timing.
- (d) holds: a spawn can be refused, so a refusal is possible if a signal ever appears.

So spawn-policy stays `built: false` (C1, C2). Nothing approximate ships (a guard from
`use_worktrees`, spawn count or timing is a guess, ADR-071 a).

### Decision for the user

The enforcement goal (refuse an unisolated concurrent executor) was **not reached**. Choose:
1. **Keep parked** (current state): description is isolation-only, switch records but nothing refuses.
2. **Re-probe on a later Claude Code.** Unblocked by any ONE of: an `isolation`/`worktree`
   field (or a populated `cwd`) on `AgentSpawnInput` for workflow agents, AND a field (not prompt
   prose) that marks integrator/testgate/teardown apart from wave executors (e.g. the script
   `label`). Liveness is already available from events.
3. **Drop the phase.** ADR-008 stays enforced by the workflow itself (isolation or sequential), and C8 holds without the mod.

Side finding (not this phase): worktree creation under the lean-ctx guard still fails (lean-ctx
refuses git inside worktrees; 7 of 9 executors did nothing in both R1 and R4), as phase 37 noted.

## Gates (phase 40 t5, run at head; no code changed in this task)

| gate | result | criterion |
|---|---|---|
| `node --test tests/` | 1786 tests, 1785 pass, 0 fail, 1 skipped | C11 |
| same with `PATH="$(dirname "$(command -v node)"):/usr/bin:/bin"` (`command -v claude` empty) | 1786 tests, 1779 pass, 0 fail, 7 skipped (Claude-requiring tests skipped, not failed) | C11 |
| `claude plugin validate --strict` on `mods`, `mods/astro-mods`, `scripts/mods-probe` | all exit 0 | C9 |
| `claude plugin test mods/astro-mods` | 4 pass, 0 fail, exit 0 | C9 |
| `package.json` dependencies / devDependencies | none (0 matches) | C11 |
| `ac models --preview`, `models fast --preview`, `models max --preview`, `config get models`, and the same under `ASTRO_LOCAL_MODEL=1` (`models --preview`, `models balanced --preview`): output at head vs pre-phase base `e89986c` (via `git worktree add`, removed after) in a sandbox `HOME` and project | byte-identical on all | C10 |
| sandbox `HOME`: `ac mods status --json` | spawn-policy `built: false`, description `refuse a parallel executor spawned without worktree isolation (ADR-008)`; matches the NO SIGNAL verdict | C1, C5 |
| `ac mods enable spawn-policy` / `status spawn-policy` | says `not built yet`, no haiku/pin wording (tests/mods_cli.test.mjs) | C2, C5 |
| mod-dependency guard in `tests/hosts.test.mjs` | green within the full run above | C8 |
