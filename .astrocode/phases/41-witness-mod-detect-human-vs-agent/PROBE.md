# PROBE — phase 41: rewrite channel, prompt origins, `!` form, AskUserQuestion

Machine-read, dense. Everything below was OBSERVED by `scripts/mods-probe/` on a live
session. Nothing is copied from the docs. A field that was not seen is marked
`not observed`, never filled in. This file adds to phase 36's PROBE.md; it does not repeat it.

- Claude Code: **2.1.292** (`claude --version` -> `2.1.292 (Claude Code)`), at the floor.
- Date: 2026-10-12. Model of the driving session: `claude-opus-5-5` (interactive, bypassPermissions).
- Probe: `scripts/mods-probe` (loaded with `--plugin-dir`). `claude plugin validate --strict
  scripts/mods-probe` exits 0. Probe additions: `tool.call` logs `next.origin` and a 40-char head
  of a Bash `command`; `ASTRO_MODS_PROBE_REWRITE=1` rewrite; `AskUserQuestion` result shape.
- Scratch project `<scratch>`: `git init`, a bare `<scratch>-remote.git` as `origin`, `ac init`,
  `ac registry init`, one phase `01-probe` set `verified` with an ACCEPTANCE.md ("probe works").
  Neither the log nor the scratch project is committed.

## Runs

| run | what | command (scratch paths shown as `<scratch>`) |
|---|---|---|
| 1 | interactive tmux session, typed by `tmux send-keys` | `tmux new -d -s probe41 "cd <scratch> && CLAUDE_CONFIG_DIR=<cfg> ASTRO_MODS_PROBE_LOG=<scratch>.run1.jsonl ASTRO_MODS_PROBE_REWRITE=1 claude --plugin-dir <repo>/scripts/mods-probe --permission-mode bypassPermissions"`; trust prompt answered; then typed in order: `/astro-accept 1` (AskUserQuestion answered Accept), `! echo witness-probe-a`, `! ac phase show 1 \|\| true`, `Run the shell command: echo witness-probe-a ...`, `Run the shell command sleep 20 and then say done.` + a second prompt 7 s later, `Run sleep 6 as four separate sequential foreground Bash calls ...` + `queued-probe-second say ok` 8 s later, a Write+Edit prompt, `/exit` |
| 2 | headless | `cd <scratch> && ASTRO_MODS_PROBE_LOG=<scratch>.run2.jsonl ASTRO_MODS_PROBE_REWRITE=1 claude -p --plugin-dir <repo>/scripts/mods-probe --permission-mode bypassPermissions "/astro-accept 1"` |

No host command was used; tmux ran inside the container.

## Rewrite channel (decision 3)

Observed (run 1): on `tool.call` `Bash` with `command === 'echo witness-probe-a'` the probe
returned `next({ ...e, command: 'echo witness-probe-b' })`.
- The `tool.check` that followed carried `input.command` = `echo witness-probe-b` (length 20).
- What `next` resolved to: `{ref, result:{stdout:"witness-probe-b", stderr:"", interrupted:false,
  isImage:false, noOutputExpected:false}, text:"witness-probe-b", isReadOnly:true}`. That is the
  tool's executed output, so `next` on `tool.call` runs the tool (the `tool.call` handler wraps the
  execution).
- The model reported that the output differed from the command it sent.
- **The executed output said `witness-probe-b`: the rewrite DID reach the executed command.** The
  phase is not blocked.
- Run 2 (headless): `AskUserQuestion` was not used and no `echo witness-probe-a` was requested, so
  the rewrite was not exercised there. Not observed headless.

## `prompt.submit` / `command.run` origin and text form

| input | observed |
|---|---|
| typed `/astro-accept 1` (interactive) | `command.run` `{command:"astro-accept", args:"1", origin:{kind:"composer"}}`, then `prompt.submit` with `text` = the RAW `/astro-accept 1` (length 15, NOT the expanded body), `origin:{kind:"composer"}` |
| typed plain prompt (interactive) | `prompt.submit` `origin:{kind:"composer"}` |
| `! echo witness-probe-a` and `! ac phase show 1 \|\| true` | **no `prompt.submit`, no `command.run`, no Bash `tool.call`, no `tool.check`.** The line ran (the shell output was shown) and only `turn.complete` events followed. A `!` line is invisible to every witness hook. |
| prompt typed while a turn was running (queued) | `prompt.submit` `origin:{kind:"composer"}`, with an EXTRA key `turnId` (keys: `text`, `wait`, `origin`, `turnId`). It is stamped `composer`, so a queued human prompt is indistinguishable from a fresh one by `origin` alone; the `turnId` key is the only difference. A second prompt typed after the first turn had already ended carries no `turnId`. |
| `claude -p "/astro-accept 1"` | `command.run` and `prompt.submit` both `origin:{kind:"sdk"}`, `text` = raw `/astro-accept 1` |
| Workflow/background completion notice | `prompt.submit` `origin:{kind:"task-notification"}`, `text` begins `<task-notification>` (here from a backgrounded `sleep 20`) |

`tool.call` itself carries NO prompt origin: its `next.origin` is the handler's provider,
`{plugin:"engine",tier:"core"}` for every tool call seen. The prompt origin must be tracked from
`prompt.submit` / `command.run`.

## `tool.call` keys by tool (main loop, run 1)

| tool | keys observed |
|---|---|
| `Bash` | `command`, `description`, `tool`, `tool_use_id` (no `agentId` in the main loop) |
| `Write` | `file_path`, `content`, `tool`, `tool_use_id` |
| `Edit` | `replace_all`, `file_path`, `old_string`, `new_string`, `tool`, `tool_use_id` |
| `AskUserQuestion` | `questions`, `tool`, `tool_use_id` |

`agentId` on `tool.call` inside an agent loop: observed in phase 36 (present only there).

## AskUserQuestion

Observed (run 1): `/astro-accept 1` raised an `AskUserQuestion` (header `UAT 01-probe`, options
Accept / Reject); Accept was chosen by Enter in the tmux pane. The `tool.call` event keys are
`questions`, `tool`, `tool_use_id` (`questions[0]`: `question`, `header`, `multiSelect`,
`options`). The `next(e)` result keys: `ref`, `result`, `text`, `isReadOnly`. `result` has keys
`questions` (array), `answers` (object), `annotations` (object); `text` is
`Your questions have been answered: "<question>"="<label>" ...` (length 343).
- No field in `e`, in the result, or in `next` names who answered. `answers` and `annotations` are
  objects whose contents were cut at depth 2 (their members were not observed); nothing at the key
  level (`ref`, `result`, `text`, `isReadOnly`, `questions`, `answers`, `annotations`) is an
  attestation of the answerer.
- Headless (run 2): the model did NOT call `AskUserQuestion`; it asked in plain text and stopped.
  Whether `AskUserQuestion` is answerable headless: not observed.

Verdict (decision 2): not-observable

## Fields witness reads (every one observed)

- `command` -- `tool.call` Bash (the string to inspect/rewrite); observed.
- `args` -- `command.run` (`"1"`); observed.
- `origin` -- `command.run` and `prompt.submit` (`{kind}`: `composer`, `sdk`, `task-notification`);
  observed. `tool.call`'s `next.origin` is a provider, not a prompt origin.
- `text` -- `prompt.submit` (raw `/cmd args` for a typed command); observed.
- `tool` -- `tool.call`; observed.
- `agentId` -- `tool.call` inside an agent loop only; absent in the main loop (observed both).
- `file_path` -- `tool.call` Write/Edit; observed.
- `content` -- `tool.call` Write; observed (string, length 5).
- `new_string` -- `tool.call` Edit; observed (string, length 3). `old_string` observed too.
- `turnId` -- `prompt.submit` queued mid-turn only; observed.

## Not observed

- A rewrite in the headless run; `AskUserQuestion` answered headless.
- Any field attesting a human answered the `AskUserQuestion`; members of `answers`/`annotations`.
- The origin of a Remote Control (`bridge`) prompt.

## Live end-to-end check (phase 41 t11)

Run 2026-10-12 on Claude Code 2.1.292, in the astro-forge container (the same place the
probe runs in were done); the host was used only for `host claude plugin ...` and `ssh host true`.
`<scratch>` is a `mktemp -d` project: `git init`, bare `<scratch>-remote.git` as `origin`,
`ac init`, `ac registry init`, phases 1 `one` and 2 `two` (`ac phase add`), each with an
ACCEPTANCE.md, both `ac phase verify`d. `<shim>` = `<scratch>-shim/ac`, a `sh` script: for
`mods status --json --switches-only` it prints `{"switches":{"witness":true}}`, otherwise it
`exec`s `/data/bin/ac "$@"`. The real `~/.astro/config.json` was never touched.

Commands (the interactive session needs `CLAUDE_CONFIG_DIR` passed explicitly; tmux's own
environment otherwise has no login):

```
tmux new -d -s w41 -x 200 -y 50 "cd <scratch> && env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR PATH=<scratch>-shim:$PATH claude --plugin-dir <repo>/mods/astro-mods --permission-mode bypassPermissions"
  (trust prompt: Up, Enter) then typed: /astro-accept 1   -> AskUserQuestion, Accept by Enter
  then typed: Create .astrocode/phases/02-two/CONTEXT.md with your Write tool. Its first line must be exactly the HTML comment <!-- astro-discuss: captured --> ...
cd <scratch> && env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION PATH=<scratch>-shim:$PATH claude -p --plugin-dir <repo>/mods/astro-mods --permission-mode bypassPermissions "/astro-accept 2"
  (the model asked in plain text and stopped, phase 2 still verified), then
cd <scratch> && ... claude -p --continue --plugin-dir <repo>/mods/astro-mods --permission-mode bypassPermissions "accept"
```

Outcomes:
- Interactive typed `/astro-accept 1` then Accept: `ac phase show 1` -> `status:"complete"`,
  `accepted_kind:"human"`, `accepted_evidence:"composer"`. PASS.
- Headless: `/astro-accept 2` alone does not reach the sign-off (headless has no AskUserQuestion; the
  model asks in text, exit 0, no hang, no deny). The follow-up `-p --continue "accept"` ran a plain
  `ac phase accept`; witness added `--agent`: phase 2 `complete`, `accepted_by:"claude"`,
  `accepted_kind:"agent"`, no `accepted_evidence`. No hang, no deny. PASS (via the two-step form).
- Composer request to Write a CONTEXT.md whose first line is `<!-- astro-discuss: captured -->`,
  no `/astro-discuss` typed: the file on disk starts `<!-- astro-discuss: captured by agent: claude -->`
  and `ac phase context 2 --author` prints `agent claude`. PASS. (A first attempt using a prose
  `Captured: human` line is not the ac marker, so `--author` said `none`; not a witness case.)
- Noted: a `SessionStart` hook of the globally installed astro plugin printed a non-blocking
  `node:internal/modules/cjs/loader` failure in the scratch project; unrelated to witness.

Gates:
- `node --test tests/` with `claude` on PATH: exit 0; tests 1853, pass 1852, fail 0, skipped 1.
- Same with `/usr/local/bin` (where `claude` lives) removed from PATH, so no `claude`: exit 0; tests
  1853, pass 1846, fail 0, skipped 7 (the live tests skip).
- `host ~/.local/bin/claude plugin validate --strict mods/astro-mods`: exit 0, "Validation passed".
  (`claude` is not on the host's non-interactive PATH; the full path was used.) The same command
  in the container also passes.
- `claude plugin test mods/astro-mods` in the container: exit 0, 12 pass, 0 fail. On the host it
  exits 1 with no test run: "hooks modules are turned off in this process: the rollout switch was
  saved off by an earlier session and is not refreshed yet" (host environment, not the mod).

| criterion | evidence |
|---|---|
| C1 | typed `/astro-accept 1` live -> `accepted_evidence:"composer"`, `accepted_kind:"human"` |
| C2 | headless accept -> `accepted_kind:"agent"`, no evidence, no hang, no deny |
| C3 | Write of the human marker with no typed `/astro-discuss` -> `captured by agent: claude`; `--author` = `agent claude` |
| C4 | ADR-074 amended with the probe outcome through `ac decision amend` (UAT answer not attestable) |
| C5 | `claude plugin test` (12 pass) covers off-switch byte-identical and cold-call-left-declared |
| C6 | register.test.tsx witness scenarios pass in `claude plugin test` |
| C7 | `claude plugin validate --strict` exit 0 (host and container) |
| C8 | `node --test tests/` exit 0, with and without `claude` on PATH |
| C9 | ADR-074 text states subagent calls, empty-id typed command, unknown turn, bridge and MCP shell are not witnessed |
| C10 | ADR-074 states `ac` still never detects; scratch run used a PATH shim, real `~/.astro/config.json` untouched |

The C-number mapping is a summary by subject, not a re-read of CRITERIA.md; the verifier
gathers its own evidence.
