# PROBE — phase 36: what Claude Code's mod events actually carry

Machine-read, dense. Everything below was OBSERVED by `scripts/mods-probe/` on a live
session. Nothing is copied from the docs. A field that was not seen is marked
`not observed`, never filled in.

- Claude Code: **2.1.292** (`claude --version` -> `2.1.292 (Claude Code)`), at/above the floor,
  so phases 39/40 are NOT blocked on an upgrade.
- Date: 2026-10-11. Model of the driving session: `claude-opus-5-5[1m]`.
- Probe: `scripts/mods-probe` (loaded with `--plugin-dir`, never `plugin install`ed).
  `claude plugin validate --strict scripts/mods-probe` exits 0.
- Scratch project `<scratch>/proj`: `git init`, `ac init`, `ac registry init` against a bare
  `<scratch>/remote.git`, `ac models fast`, one throwaway phase `01-probe-throwaway` whose
  PLAN.md has two independent trivial tasks (t1 writes `alpha.txt`, t2 writes `beta.txt`).
  Neither the log nor the scratch project is committed.

## Runs

| run | what | command (scratch paths shown as `<scratch>`) |
|---|---|---|
| 1 | real `/astro-execute`: Workflow-spawned agents | `cd <scratch>/proj && ASTRO_MODS_PROBE_LOG=<scratch>/run1.jsonl timeout 1800 claude -p --plugin-dir <repo>/scripts/mods-probe --permission-mode bypassPermissions "/astro-execute 1"` |
| 2 | Agent-tool path: `astro-researcher` subagent | `cd <scratch>/proj && ASTRO_MODS_PROBE_LOG=<scratch>/run2.jsonl timeout 600 claude -p --plugin-dir <repo>/scripts/mods-probe --permission-mode bypassPermissions "Use the Agent tool to delegate to the astro-researcher subagent one read-only question: which files are in the current directory? Report its answer in one line."` |
| 2b | main-loop `tool.check` verdict | same as run 2 with `--permission-mode default` and the prompt "Run the shell command 'ls' and tell me the first entry." (the verdict logging was added to the probe after run 1) |
| 3 | interactive, typed prompt then typed `/astro-status` | `tmux new -d -s probe3 "cd <scratch>/proj && ASTRO_MODS_PROBE_LOG=<scratch>/run3.jsonl claude --plugin-dir <repo>/scripts/mods-probe --permission-mode bypassPermissions"`, trust prompt answered, then `tmux send-keys` of `What is 2+2? answer in one word` and `/astro-status`, then `/exit` |

Run 1 outcome: phase verified; one lean batched `astro-executor` committed t1 and t2
(`worktrees` unused: the phase ran sequentially on-branch). 44 events: 1 `session.start`,
1 `command.run`, 2 `prompt.submit`, 4 `agent.spawn`, 18 `tool.call`, 18 `tool.check`.

Redaction note: run 1 predates two probe fixes (tool.call arguments reduced to
`{type,length}`; `tool.check` verdict logged). Its tool.call argument VALUES are therefore
not reproduced here; runs 2/2b/3 used the final probe.

## `session.start` (the only event the skeleton touches)

`keys`: `cwd`, `surface`, `isInteractive`. Nothing else.

| field | `-p` (runs 1, 2) | interactive (run 3) |
|---|---|---|
| `cwd` | observed (run 1): absolute project dir | observed (run 3) |
| `surface` | observed (run 1): `null` | observed (run 3): `"terminal"` |
| `isInteractive` | observed (run 1): `false` | observed (run 3): `true` |

The skeleton reads NO field of `e` on `session.start` (it only awaits the switches and
returns `next(e)`), so it depends on none of the above.

## `agent.spawn`

`keys` (identical on every spawn in run 1): `tool_use_id`, `prompt`, `description`,
`subagentType`, `provider`, `model`, `parentModel`, `permissionMode`, `background`, `fork`,
`workflow`, `name`, `cwd`. Run 2 (Agent tool) has the same keys minus `workflow`. `name` and
`cwd` are present as KEYS with an `undefined` value (absent from the JSON line).

| field | Workflow agent (run 1) | Agent-tool agent (run 2) |
|---|---|---|
| agent type | observed: `subagentType` = `workflow-subagent` (the plan/discover step), `astro-executor`, `astro-verifier` | observed: `subagentType` = `astro-researcher` |
| agent name | key present, value `undefined` (`name` not set on any workflow agent) | key present, value `undefined` |
| model | observed: `"sonnet"` (executor, discover), `"opus"` (verifier) | key present, value `undefined` (model not set on the call) |
| parentModel | observed: `claude-opus-5-5[1m]` | observed: `claude-opus-5-5[1m]` |
| isolation | not observed (no `isolation` key; run 1 ran sequentially, no worktree isolation was requested) | not observed |
| isTeammate | not observed (key absent) | not observed (key absent) |
| fork | observed: `false` | observed: `false` |
| background | observed: `false` | observed: `false` |
| permissionMode | observed: `bypassPermissions` | observed: `bypassPermissions` |
| provider | observed: `{plugin:"engine",tier:"core"}` for `workflow-subagent`; `{plugin:"user",tier:"user"}` for astro agents | observed: `{plugin:"user",tier:"user"}` |
| workflow run / index | observed: `workflow:{runId:"wf_62d2bd26-665", agentIndex:1..4}` (index in spawn order) | not observed (no `workflow` key) |
| tool_use_id | observed, and the SAME value for all four agents of the run: it is the id of the `Workflow` tool call | observed: the id of the `Agent` tool call |
| parentAgentId | not observed (key absent; spawns came from the main loop) | not observed |
| child agent id | not observed: no `agent.spawn` field names the id the child later carries as `agentId` on `tool.check` | not observed |
| prompt / description | observed (redacted as logged: first 80 chars + length) | observed |

## `tool.check`

`keys`: main loop `tool`, `input`, `tool_use_id`; inside an agent also `agentId`.
Verdict (probe's `result` = what `next(e)` answered, run 2b, main loop, `Bash`, default
permission mode): `{"decision":"allow","hook":"PreToolUse"}`. A verdict from an agent loop is
`not observed` (runs 1/2 predate verdict logging).

| loop | agentId | tool | input | decision |
|---|---|---|---|---|
| main loop (runs 1, 2b) | observed ABSENT (key not in `keys`) | observed: `Bash`, `Workflow` | observed, reduced to `{key:{type,length}}` | observed (run 2b): `allow` |
| Agent-tool agent (run 2) | observed PRESENT, e.g. `a0490e56d31aeef64` (`a` + 16 hex) | observed: `Bash` | observed | not observed |
| Workflow agent (run 1) | observed PRESENT, e.g. `a183bf4dca1c3311f`, `ab06f52a78fa1d29b`, `ace7530118b09cb8b`, `afbad64070fac1506` (four agents, four distinct ids) | observed: `Bash`, `StructuredOutput` | observed | not observed |

The Workflow agents' ids appear in the same order as the `agentIndex` values
(`workflow-subagent`, executor, audit, verifier). No field links an `agentIndex` to an
`agentId`; the pairing is an inference from order, not an observation.

`tool.call` carries the tool's arguments spread onto the event (`command`, `description`,
`file_path`...), plus `tool`, `tool_use_id`, and `agentId` inside an agent loop. `agentId` is
present on tool.call in exactly the cases it is on tool.check.

## `prompt.submit` and `command.run` (origin)

`prompt.submit` keys: `text`, `wait`, `origin`. `command.run` keys: `command`, `args`,
`origin`, `presentation`.

| prompt | origin observed | evidence |
|---|---|---|
| human typed in the interactive composer | `{"kind":"composer"}` | run 3: `What is 2+2? answer in one word` on `prompt.submit` |
| typed slash command, interactive | `command.run` `{command:"astro-status", args:"", origin:{kind:"composer"}}`, then `prompt.submit` of the expanded `/astro-status` with `origin:{kind:"composer"}` | run 3 |
| `claude -p "<prompt>"` argument | `{"kind":"sdk"}` (both `prompt.submit` and `command.run` for `/astro-execute 1`: `command:"astro-execute"`, `args:"1"`) | runs 1, 2 |
| Workflow background-task completion notice | `{"kind":"task-notification"}`, text starts `<task-notification>...` | run 1 |
| prompt a Workflow hands to its agents | no `prompt.submit` at all: it is only the `prompt` on that agent's `agent.spawn` | run 1 |
| a plugin's own `$.prompt.submit` | not observed | |

So a HUMAN-typed prompt is `origin.kind === "composer"`; `-p` input is `sdk`; an agent-side
injection arrives as `task-notification`. Whether other kinds exist (queued prompts, remote
surface, teammate message) is `not observed`. `command.run.presentation` observed:
`{isFullscreen, columns}`.

## What this means for phases 39 / 40 / 41

- **39 blindfold (plan-blind verifier / criteria author).** An agent is identifiable on
  `agent.spawn` by `subagentType` (`astro-verifier`, `astro-criteria-author`... as named)
  and by its `prompt`. On `tool.check` it is identifiable only by `agentId`, and NO field
  joins the two: a mod cannot learn "agentId X is the verifier" from the events observed. 39
  must either infer it from spawn order or test whether `next.origin` / a later probe adds the
  link; do not assume it.
- **40 spawn-policy (refuse haiku, pin role models, isolate parallel waves).** `model` is
  present and settable on Workflow spawns (`"sonnet"`, `"opus"` observed) and `undefined` on
  an Agent-tool spawn that did not set one, so an absent model must be treated as "inherit",
  not as a violation. `isolation` and `isTeammate` were NOT observed: the 2.1.292 spawn event
  carries no `isolation` key, and run 1 did not exercise parallel worktrees. 40 must probe a
  worktree-mode wave before relying on isolation.
- **41 witness (human vs agent acceptance).** `prompt.submit.origin.kind === "composer"` is
  the only human-typed origin observed; `command.run` shares it. `sdk` (`-p`) and
  `task-notification` are not typed by a human at a composer. Remote/queued origins are not
  observed.

## Install facts (F1-F5, from live `claude` 2.1.292 with a scratch `CLAUDE_CONFIG_DIR`)

- **F1** `CLAUDE_CONFIG_DIR` IS honoured by `claude plugin marketplace add|list|remove`,
  `install`, `update`, `uninstall` and `list`; marketplaces, plugins and `settings.json`
  `enabledPlugins` land in that dir. The multi-profile fan-out is built; it is not a recorded
  gap.
- **F2** JSON shapes (every command takes `--json`; `update`/`uninstall` also `-y`):
  `marketplace list` -> `[]` or `[{name,source:"directory",path,installLocation}]`;
  `plugin list` -> `[{id:"astro-mods@astro-code",version,scope:"user",enabled,installPath,...}]`;
  `marketplace add <path>` -> `{command,outcome:"ok",marketplace,message}`; re-adding the same
  path is idempotent; adding a DIFFERENT path under an existing name silently re-points it and
  exits 0, so `ac` compares `path` itself. `install` failure: exit 1,
  `{outcome:"failed",failureCode:"not_found"}` plus a `✘` stderr line.
- **F3** plugin validator: `export function register(on, options)`; every registration must be
  literally `on("<event>", <function literal or name>)` (a wrapper call such as
  `on('x', failOpen(fn))` fails); fail-open is therefore `on(...).catch(failOpen)`;
  `hooks/hooks.json` = `{"modules":["./register.js"]}`; `$.process.run(argv,{timeoutMs})`
  rejects when the command cannot start or overruns; `session.start` fires at start and again
  on each `/reload-plugins`.
- **F4** `claude plugin test <dir>` runs only `*.test.ts` / `*.test.tsx` and exits 1 with none;
  a `.test.ts` is also collected by a bare `node --test` on Node >= 23 and crashes on
  `import 'claude-code/testing'`, a `.test.tsx` is not, so the plugin's engine test is
  `register.test.tsx`.
- **F5** a local-directory marketplace is read from the folder (`readFromFolder`); `ac install`
  / `ac update` refresh `~/.astro/code/mods` and a session picks it up on `/reload-plugins`;
  `claude plugin update` is then mostly `up_to_date`, and is still run.
