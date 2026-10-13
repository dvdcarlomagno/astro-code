# PROBE — phase 37: what blocks a tool call on Claude Code and Cursor

Machine-read, dense. F1 and F2 were settled during planning; the recheck at the end was run
by t11 against the shipped code.

## F1 — Claude Code 2.1.292 PreToolUse deny (planning, live)

Method: `claude -p --settings <scratch settings.json> --permission-mode bypassPermissions` in a
scratch git dir, with a hook entry
`{"matcher":"Write|Edit|MultiEdit|NotebookEdit|Bash","hooks":[{"type":"command","command":"\"<node>\" \"<hook>\"","timeout":5}]}`.

- stdin: `{session_id, transcript_path, cwd, prompt_id, permission_mode, effort, hook_event_name:"PreToolUse", tool_name, tool_input, tool_use_id}`.
  Write carries `tool_input.file_path` (absolute) and `content`; Bash carries `tool_input.command`.
- Deny: stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<text>"}}`, exit 0.
  Blocked a Write and a Bash redirect even under `bypassPermissions`; the model saw
  `PreToolUse:Write hook error: <text>` and `permission_denials` listed both calls.
- Allow: exit 0, empty stdout. Never print `allow`.
- Not probed then: Edit/MultiEdit/NotebookEdit input (per the docs: `file_path`, `file_path` plus `edits[]`, `notebook_path`).

## F2 — Cursor `cursor-agent` 2026.10.01 (planning, read from the installed bundle)

Source: read-only greps of `/opt/homebrew/Caskroom/cursor-cli/2026.10.01-e373342/dist-package/*.js`.
Not run live: the macOS keychain was locked.

- Native `hooks.json` has `preToolUse`. Input `{conversation_id, generation_id, model, tool_name, tool_input, tool_use_id, cwd, …}`.
- Deny output `{"permission":"deny","user_message":"…","agent_message":"…"}`. `ask` also exists; never used.
- Entry keys: `command`, `matcher` (regex on `tool_name`), `timeout`, `failClosed` (default false, fail open).
- Tools: `Write {file_path, content}` (Cursor's edits are Write), `Delete {file_path}`, `Shell {command, cwd}`.
- Claude-hooks import: `PreToolUse -> preToolUse`, matcher names `Bash -> Shell`, `Edit -> Write`;
  Claude's `permissionDecision`/`permissionDecisionReason` are translated into `permission`/`user_message`.
  So Claude's entry also blocks on Cursor through the import (static evidence; `ac mods status`
  words it "via Claude Code import").

## Recheck (t11, live, claude 2.1.292, 2026-10-11)

Method: scratch HOME, `ac install`, `ac mods enable canon-guard`; the PreToolUse entry that
enable wrote into the scratch `settings.json` was copied alone into a `--settings` file. Then, in
a scratch git project holding `.astrocode/state.json` and `debt.json`:
`claude -p --settings <file> --permission-mode bypassPermissions` asked for a Write to
`.astrocode/state.json`, a Bash `echo '{}' > .astrocode/debt.json`, and a Task subagent
(general-purpose) Write to `.astrocode/state.json`.

- All three calls were denied; `permission_denials` listed the Write, the Bash and the subagent's Write.
- The model relayed the reason: "the `ac` CLI owns `state.json` and refuses hand edits", and for debt.json it
  pointed at `ac debt …`.
- Both files were unchanged afterwards.
- A Task subagent's Write is denied too: settings hooks are session-wide, so the guard reaches
  Workflow and Agent-tool subagents. This closes the "not probed" gap in F1.
