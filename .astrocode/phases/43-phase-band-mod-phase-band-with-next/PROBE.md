# PROBE — phase 43: what the band can see of a live /astro-execute run, and what autocomplete receives

Machine-read, dense. "Observed" comes from `scripts/mods-probe/` (phase 43 t1) on live runs.
"Documented" comes from the plugin API types bundled with Claude Code 2.1.292 and is NEVER
evidence. A source not seen is `not observed`; nothing is inferred.

- Claude Code: **2.1.292** (`claude --version` -> `2.1.292 (Claude Code)`), the floor.
- Date: 2026-10-13. Driving session model `claude-opus-5-5`. Container `claude`; `host` was NOT
  used for any run (`host true` only confirmed the bridge; `host 'which claude ac node tmux'`
  was run once, read-only, to see where `claude` lives: not on the host).
- Scratch project (outside the repo, not committed): `git init` + bare `remote.git`,
  `ac init`, `ac registry init`, `ac models fast`, `ac config set use_worktrees false`, one
  phase `01-probe-throwaway` whose PLAN has 3 independent tasks on distinct files
  (`alpha.txt`, `beta.txt`, `gamma.txt`). `claude --plugin-dir <repo>/scripts/mods-probe`,
  `ASTRO_MODS_PROBE_LOG=<scratch>/rN.jsonl`, cwd `<scratch>/proj`. The throwaway-HOME rule was
  relaxed to the session's own `CLAUDE_CONFIG_DIR` (a fresh HOME has no login); the probe is
  `--plugin-dir` only, never installed.

## Runs

| run | what | command tail |
|---|---|---|
| R1 | `/astro-execute 1` through the Workflow tool, under `-p` | `claude -p --plugin-dir <repo>/scripts/mods-probe --permission-mode bypassPermissions "/astro-execute 1"` |
| R2 | one Agent-tool `astro-executor` spawn, under `-p` | same flags, prompt: use the Agent tool to delegate to `astro-executor` one trivial task (create `agent.txt`) |
| R3 | interactive, `tmux`, typed `/astro-plan 1`, `/astro-fix-accept a` | `claude --plugin-dir <repo>/scripts/mods-probe --permission-mode bypassPermissions` (trust prompt answered Yes for the scratch dir) |

## `$.agent.list()` while a run is live

| source | observed (example value) | documented (typings) |
|---|---|---|
| Workflow agents, R1: `agent.spawn` snapshot | `[]` at all 4 spawns (`workflow-subagent` idx 1, `astro-executor` idx 2 and 3, `astro-verifier` idx 4; `workflow.runId` `wf_0ae316db-222`) | "a workflow's agents are not listed" |
| Workflow agents, R1: snapshot at each agent's first `tool.check` (agent mid-run, running Bash) | `[]` for `workflow-subagent`, both `astro-executor`, and `astro-verifier` | same |
| Workflow agents, R1: `turn.complete` snapshots (6) | `[]` every time | same |
| Agent-tool agent, R2: `agent.spawn` snapshot | `[]` (the agent is not registered yet at spawn) | n/a |
| Agent-tool agent, R2: snapshot at the agent's first `tool.check` | `[{"id":"ad32dadfa6074a54f","type":"astro-executor","status":"running","description":"Create agent.txt file"}]` (`name` and `parentId` absent) | `AgentInfo` rows |
| Agent-tool agent, R2: `turn.complete` snapshots (2) | `[]` (already gone) | n/a |

Phase 40 R1 independently saw `[]` at every workflow spawn with 8 sibling executors live
(`.astrocode/phases/40-*/PROBE.md`), so the answer holds for a parallel wave too. This phase's
R1 ran sequentially (`use_worktrees false`, lean execution), which is the shape the band meets
most often.

`AgentInfo.status` values seen: **`running`** (R2, mid-run). `done` and `failed` are NOT
observed: an Agent-tool agent leaves the list instead of showing a terminal status.

workflowAgentsListed: false

Consequence for the band: a live `/astro-execute` run shows no per-agent rows. The live signal
is `ac`'s `activity` text (`readContext` freshness, `state.activity`) and the band says so
plainly. Agent-tool `astro-executor`/`astro-verifier` agents that ARE listed may be shown with
their observed `running` status; no row is ever invented.

## `prompt.autocomplete` input (R3, interactive, `surface: "terminal"`)

| typed | event input (observed) |
|---|---|
| `/astro-plan 1` | `{"text":"/astro-plan 1","cursor":13,"token":"1","start":12}` |
| `/astro-plan 1 x` | `{"text":"/astro-plan 1 x","cursor":15,"token":"x","start":14}` |
| `/astro-plan /` | `{"text":"/astro-plan /","cursor":13,"token":"/","start":12}` |
| `/astro-fix-accept a` | `{"text":"/astro-fix-accept a","cursor":19,"token":"a","start":18}` |

- The command arrives **bare** (`/astro-plan`), not namespaced (`<ns>:astro-plan`). The
  matcher still allows an optional `<ns>:` prefix; nothing observed needs it.
- The hook fired **only once the token was non-empty**: typing `/astro-plan ` and backspacing
  to `/astro-plan ` produced no event. Rows therefore appear after the first character of the
  id, not on the bare space. Not observed: whether a different host build fires on an empty token.
- `start` is the index of the token's first character, so `text.slice(0, start)` is
  `/astro-plan ` (command plus the whitespace), as t4's `commandSource` expects.

## Filled composer text and submit origin

`prompt.fill` observer: **not observed** (no mod called `$.prompt.fill` in these runs; only the
band does). Whether a filled line followed by a human Enter reaches `prompt.submit` with
`origin.kind === 'composer'` is **not observed**; see ACCEPTANCE item 3. Phase 36 run 3
observed a typed prompt's `prompt.submit` origin; a fill-then-Enter was not part of it.

## host commands used

- `host true` (bridge check), `host 'which claude ac node tmux; claude --version; echo $HOME'`
  (read-only; `claude` is not on the host). No other `host` command.
