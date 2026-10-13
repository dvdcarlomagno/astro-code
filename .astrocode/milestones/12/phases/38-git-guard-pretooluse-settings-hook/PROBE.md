# Phase 38 PROBE — what a hook `ask` does, what lean-ctx sends, what Cursor can do

Probed 2026-10-11 on Claude Code 2.1.292 and `cursor-agent` 2026.10.01.

## F1 — a Claude Code hook `ask` refuses headless and never hangs

- Setup: scratch git repo with a modified `src/a.js` and an untracked `notes.txt`. A probe hook
  printed `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"…"}}`
  for any command containing `git stash`, registered through `--settings` with matcher `Bash`, timeout 10.
- Run 1, `claude -p --permission-mode bypassPermissions`, `git stash -u .`: REFUSED, listed in
  `permission_denials`, reason relayed verbatim, exit 0 after 8 s, stash empty, `notes.txt` intact.
- Run 2, `--permission-mode default --allowedTools "Bash(git stash:*)"`, a direct `git stash -u` and
  a general-purpose Task subagent running `cd . && git stash`: both REFUSED (the subagent's stdin
  carried an `agent_id`, so settings hooks reach subagents), exit 0 after 17 s, stash empty. A hook
  `ask` beats an explicit allow rule.
- Verdict: `ask` ships on Claude. Not probed: the interactive approval prompt (needs a TTY).

## F2 — under lean-ctx the guard receives the ORIGINAL command

- The user's profile registers `lean-ctx hook rewrite` on PreToolUse `Bash|bash` ahead of any astro
  entry. In both F1 runs the probe hook's stdin held `tool_input.command` = `git stash -u .` /
  `cd . && git stash`; only the executed and denied input was the rewritten
  `/usr/local/bin/lean-ctx -c 'git stash -u .'`. A sibling's `updatedInput` never reaches the guard,
  and lean-ctx's own `allow` did not override our `ask`.
- Rewrite form: `<abs path>/lean-ctx -c '<cmd>'`, single-quoted, embedded `'` as `'\''`. The guard
  unwraps it (by basename) as defence in depth; tests feed the recorded forms.
- Known gap: lean-ctx's MCP `ctx_shell` is not the Bash tool, so the matcher never sees it.

## F3 — Cursor cannot ask from `preToolUse`; git-guard denies there

- Source: read-only greps of `cursor-cli/2026.10.01-e373342/dist-package/190.index.js` on the host
  (not run live; keychain locked, as in phase 37 F2).
- The `preToolUse` validator accepts `permission` in `allow|deny|ask`, and merging is
  `deny` > `ask` > `allow`, but the tool-execution path only acts on `"deny"`; an `ask` lets the
  Shell call run. `beforeShellExecution` handles `ask` but is not used (single `preToolUse` event).
- Cursor stamps `hook_event_name:"preToolUse"` on every payload, including Claude-imported hooks,
  so the script answers `{permission:"deny", …}` for both the native entry and the import.

## Recheck against the SHIPPED script

- Setup: scratch HOME, `CLAUDE_CONFIG_DIR` pointed at a scratch dir, `ac install`,
  `ac mods enable git-guard`; the one resulting entry was copied alone into a `--settings` file.
- Run: `claude -p --settings <file> --permission-mode bypassPermissions`, in a scratch repo with a
  modified tracked file and an untracked `notes.txt`, asking for `git stash -u`, `git reset --hard`,
  and a Task subagent running `git clean -fd .`.
- Result: all three were REFUSED and appear in `permission_denials` (as the lean-ctx-rewritten
  `lean-ctx -c 'cd … && git …'` input). The model relayed the full reason (rule, ADR-035/038, why,
  `git stash push -- <path>` alternative, escape). Exit 0 after 27 s, no hang. Afterwards the stash
  list was empty, `src/a.js` still modified, and `notes.txt` present.
