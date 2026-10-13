# PROBE — phase 39: is there an agentId -> agent-type join?

Machine-read, dense. Everything below was OBSERVED by `scripts/mods-probe/` (extended in phase 39
t1) on live sessions. Nothing is copied from the docs. A field that was not seen is marked
`not observed`. Phase 36's PROBE.md is the baseline; this file adds only the join question.

- Claude Code: **2.1.292** (`claude --version` -> `2.1.292 (Claude Code)`). Date: 2026-10-11.
  Driving model `claude-opus-5-5[1m]`.
- Probe: `scripts/mods-probe`, loaded with `--plugin-dir`, never installed.
  `claude plugin validate --strict scripts/mods-probe` exits 0.
- Scratch project: `git init`, `ac init`, bare-remote `ac registry init`, `ac models fast`, one
  throwaway phase `01-probe-throwaway` with CONTEXT.md, CRITERIA.md (C1 alpha.txt, C2 beta.txt)
  and PLAN.md (two trivial tasks). Fresh clones at the same commit per run. Not committed.

## Runs

| run | path | what | outcome |
|---|---|---|---|
| 1 | Workflow | `claude -p --plugin-dir scripts/mods-probe --permission-mode bypassPermissions "/astro-execute 1"`, no deny env | 4 Workflow agents spawned (`workflow-subagent`, 2x `astro-executor`, `astro-verifier`); phase verified; 50 log lines |
| 2 | Agent tool | same flags, prompt "Use the Agent tool with subagent_type astro-verifier: list the phase dir, then read its CRITERIA.md and report the first criterion id." | verifier ran Bash + Read, answered `C1` |
| 3 | Agent tool, deny | run 2 with `ASTRO_MODS_PROBE_DENY_AGENT=astro-verifier`, `--output-format json` | verifier's first Bash refused; it carried on with Read |
| 4 | Workflow, deny | run 1 with `ASTRO_MODS_PROBE_DENY_AGENT=astro-verifier`, `--output-format json` | verifier's first Bash refused; it reported the plugin blocked it |
| 5 | F1 | fresh `HOME`, no `CLAUDE_CONFIG_DIR` | see F1 |

`astro-criteria-author` was NOT spawned in any run: **not observed** on either path. The join below
is keyed by agent id, not by type, so it does not depend on which type spawns; the spawner passes the
type string it was given (`subagentType`), observed here as `astro-verifier`, `astro-executor`,
`workflow-subagent`.

## 1. `$.agent.list()` (CONTEXT 1, source S1)

Logged on each agent's FIRST `tool.check` (`listMs` is the call duration).

| path | entry for the calling agent on its first tool call | evidence |
|---|---|---|
| Agent tool (runs 2, 3) | **observed present**: `{ id: "a5d05c14d68b7013f", type: "astro-verifier", status: "running", description: "Read phase CRITERIA.md" }`; `listMs` 1-2 | `tool.check` `agentId` is the same `a5d05c14d68b7013f`; run 3: `a474be468f03d1da4` both sides |
| Workflow (runs 1, 4) | **observed ABSENT**: `list` is `[]` on the first call of every Workflow agent (`a82d2324825d1fe33` verifier, `a0640aefbb0e22668`, `a76f2e1cac9ec6573`, `a357a2ccf14585be4`; run 4 verifier `a0d0f15cada37ee5f`); `listMs` 0-1 | matches the typings' "a workflow's agents are not listed" |

Entry fields observed: `id`, `type`, `status`, `description`. `name`, `parentId` not observed (keys
absent for these agents). So S1 identifies Agent-tool agents only. **S1 fails the Workflow path.**

## 2. `agent.spawn` / `next(e)` result / `tool.check` / `next.origin` (source S2)

`agent.spawn` is raised for both paths; the probe awaited `next(e)` and logged what it settled with.

| path | `agent.spawn` | `await next(e)` settled with | later `tool.check` `agentId` | same? |
|---|---|---|---|---|
| Agent tool (run 2) | `subagentType: "astro-verifier"`, no `workflow` key | `{ model: "claude-opus-5-5[1m]", agentId: "a5d05c14d68b7013f" }` | `a5d05c14d68b7013f` | **yes** |
| Agent tool (run 3) | `subagentType: "astro-verifier"` | `{ model, agentId: "a474be468f03d1da4" }` | `a474be468f03d1da4` | **yes** |
| Workflow (run 1) | `subagentType: "astro-verifier"`, `workflow: { runId: "wf_9a41e660-ee9", agentIndex: 4 }`, shared `tool_use_id` (the `Workflow` call) | `{ model: "claude-opus-5-5[1m]", agentId: "a82d2324825d1fe33" }` | `a82d2324825d1fe33` | **yes** |
| Workflow (run 1) | `subagentType: "astro-executor"`, `agentIndex: 2` / `3` | `agentId: "a76f2e1cac9ec6573"` / `"a357a2ccf14585be4"` | same two ids | **yes** |
| Workflow (run 1) | `subagentType: "workflow-subagent"`, `agentIndex: 1` | `agentId: "a0640aefbb0e22668"` | same | **yes** |
| Workflow (run 4) | `subagentType: "astro-verifier"`, `agentIndex: 4` | `agentId: "a0d0f15cada37ee5f"` | `a0d0f15cada37ee5f` | **yes** |

- `next(e)` on `agent.spawn` resolved before the child's first `tool.check` in every case (the
  result was logged first). Its keys: `model`, `agentId`. `teammateId` not observed.
- The spawn result's `model` is a resolved id (`claude-opus-5-5[1m]`, `claude-sonnet-5-5`), unlike
  the requested `"opus"`/`"sonnet"` on the event.
- `tool.check` keys inside an agent loop: `tool`, `input`, `tool_use_id`, `agentId`. Main loop: no
  `agentId` (observed ABSENT on the `Agent`, `Workflow` and main-loop `Bash` checks).
- `next.origin` on a `tool.check` first call: `{ plugin: "engine", tier: "core" }` on both paths. It
  names the plugin that caused the call, not the agent type: **not a join**.
- Depth-4 key walk of `e`: `tool`, `input{command|file_path…}`, `tool_use_id`, `agentId`; no
  `agentType`/`subagentType`/`name`/`parentAgentId` key. Of `next`: `to`, `signal`, `is`, `event`,
  `origin{plugin,tier}`, `trace`, `budget{ms,remainingMs}`; no agent type.

## 3. Other events examined

`tool.call` carries `agentId` in the same cases as `tool.check` and no type (phase 36). No other
event was needed. `prompt.submit`/`command.run`: unchanged from phase 36.

## Tool input keys actually seen on `tool.check`

- `Bash`: `command`, `description`. `Read`: `file_path`. `Agent`: `description`, `prompt`,
  `subagent_type`, `run_in_background`. `Workflow`: `scriptPath`, `args`. `StructuredOutput`: the
  schema's own keys.
- `Grep`, `Glob`, `NotebookRead`, `Edit`: **not observed** (no run used them).
- A Workflow agent's Bash commands arrived wrapped: `/usr/local/bin/lean-ctx -c '<command>'` (the
  container's shell wrapper). A command guard must read through `<wrapper> -c '<str>'`.

## Deny honoured? (`ASTRO_MODS_PROBE_DENY_AGENT=astro-verifier`, bypassPermissions)

| path | observed |
|---|---|
| Agent tool (run 3) | **refused**: the first Bash was answered `{ decision: "deny", reason: "probe deny" }`; `permission_denials` holds that Bash call (`tool_name`, `tool_use_id`, `tool_input`); the verifier relayed "a plugin hook (astro-mods-probe) blocked the verifier's Bash call with 'probe deny'" and continued with Read; no hang |
| Workflow (run 4) | **refused**: same deny on the verifier's first Bash; `permission_denials` is `[]` in the result (not recorded for workflow agents); the reason reached the model ("blocked the verifier's shell commands ('probe deny')"); no hang |

A `deny` is honoured inside a `bypassPermissions` subagent on both paths, and the model reads the
`reason`.

## F1-F3 (planning facts)

- **F1** On a fresh `HOME`: `claude --version` printed `2.1.292 (Claude Code)` and left `HOME` empty
  (`ls -a`: `.`, `..`); `claude plugin marketplace list --json` printed `[]` and created `.claude`
  and `.claude.json`. So `claude plugin ...` is the side effect, not `--version`.
- **F2** `ac install` on a fresh `HOME` with `claude` on PATH falls back to Claude and creates
  `~/.claude`; a plain `ac mods enable` afterwards finds the dir (planning fact; exercised by t2's tests).
- **F3** The bundled typings describe `AgentSpawnResult.agentId` as the id its loop's `tool.call`
  events carry, and `$.agent.list()` as not listing workflow agents. Section 1 and 2 above are the
  observation: both statements held on 2.1.292.

## Verdict

S1 (`$.agent.list()`) joins on the Agent-tool path only. S2 (an `agent.spawn` hook awaits `next(e)`
and pairs `r.agentId` with `e.subagentType`; the later `tool.check` `agentId` equals it) was
observed for the SAME agent on BOTH paths, with the type string the spawner passed.

Verdict: join found — source: S2 (`agent.spawn` `next(e).agentId` + `subagentType` -> `tool.check` `agentId`)

## Recheck (shipped plugin)

Claude Code 2.1.292, 2026-10-11, after t5/t6 (blindfold built).

- Setup: scratch `HOME` (with an empty `.claude`), `CLAUDE_CONFIG_DIR` unset for `ac`: `ac install`,
  then `ac mods enable blindfold` -> `✓ astro-mods installed`, `ac mods status blindfold` -> `on  mod  takes effect`.
- Run: scratch project (fresh copy of the throwaway phase), `HOME=<scratch>` so the plugin's `ac` reads
  the scratch switch, `claude -p --plugin-dir <HOME>/.astro/code/mods/astro-mods --permission-mode bypassPermissions --output-format json`,
  one prompt asking the main session to Read PLAN.md and an Agent-tool `astro-verifier` to Read PLAN.md then CRITERIA.md.

| observation | result |
|---|---|
| verifier Read of PLAN.md | **refused**; relayed reason: `Permission to use Read denied by plugin astro-mods: blindfold: Read refused — PLAN.md is closed to astro-verifier (ADR-021: the bar is the goal and CRITERIA.md, never the plan).` then `Your own rule: "Do NOT read \`PLAN.md\`. Do NOT read \`SPEC.md\`."` then the CRITERIA.md line; `permission_denials` lists the Read |
| verifier Read of CRITERIA.md | read normally; it reported `C1` as the first criterion |
| main-session Read of PLAN.md | allowed (it named task `t1 — write alpha`) |
| hang | none (run took 26 s) |

The reason carries no way to switch the guard off. Workflow-spawned verifier on the shipped plugin: not
re-run here (the engine tests and run 4's deny cover that path).
