# Criteria — phase 38: git-guard (PreToolUse settings hook refusing unscoped destructive git in the shared tree)

> Pre-registered, plan-blind. Derived from the phase goal, CONTEXT.md (decisions 1-6, out of
> scope, open questions) and canon (ADR-014, ADR-035, ADR-038, ADR-071, ADR-072). The plan and
> the verifier both answer to this bar.

## Shared harness (used by every criterion below)

- **Sandbox.** Never touch the real home. `S=$(mktemp -d)`; `export HOME=$S/home`; unset
  `CLAUDE_CONFIG_DIR`, `CURSOR_CONFIG_DIR` unless a criterion sets them; `mkdir -p $HOME/.claude`.
  Run the CLI as `node /Users/buu/Development/astro-code/bin/ac.mjs` (written `ac` below). Turn
  the feature on the way ac documents it: `ac install` then `ac mods enable git-guard`.
- **GUARD.** The command(s) that `ac mods enable git-guard` added under `hooks.PreToolUse` in a
  profile's `settings.json` (diff the file before/after enable). Drive it exactly as Claude Code
  would: `printf '%s' "$EVENT_JSON" | sh -c "$GUARD"`, honouring the entry's `matcher` (a tool
  the matcher does not cover is, in practice, unguarded).
- **Event.** `{"hook_event_name":"PreToolUse","cwd":"<dir>","tool_name":"Bash","tool_input":{"command":"<cmd>"}}`,
  built with `node -e` (JSON.stringify) or `jq -n --arg` so quotes and newlines inside `<cmd>`
  survive.
- **Repo R.** `R=$(mktemp -d)`, `git init`, one commit holding `src/a.js`, plus an untracked
  file `notes.txt`. A real agent worktree: `git -C $R worktree add $R/.claude/worktrees/agent-1 -b wt1`.
- **VERDICT.** The phase's chosen refusal verdict: `ask` (stdout JSON
  `hookSpecificOutput.permissionDecision == "ask"`), unless C7's recorded live finding forced
  the fallback to `deny` (permissionDecision `"deny"`, or exit 2).
- **REFUSED** = the guard answers with VERDICT. **ALLOWED** = exit 0 and stdout carries **no**
  permission decision at all — not `deny`, not `ask`, and not `allow` (an explicit `allow`
  would auto-approve the call past the user's own permission rules, which a guard must never do).
- After every case, `git -C $R stash list` is empty and `notes.txt` still exists — the guard only
  decides, it never runs the command.

---

### C1 — Enabling git-guard makes it live in every Claude profile; disabling removes exactly it, and it coexists with canon-guard
- **Observe:** In the sandbox, register a second Claude profile (`$HOME/.claude/.jean-claude/profiles.json`
  listing `{"profiles":{"work":{"configDir":"$HOME/.claude-work"}}}`; `mkdir -p` it). Pre-seed
  BOTH profiles' `settings.json` with a user-owned `PreToolUse` entry (`matcher:"Bash"`, command
  `echo user-hook`) and an unrelated top-level key; save copies. Run `ac mods enable git-guard`
  twice. In each profile: exactly one git-guard entry; its matcher covers Bash; feeding it
  `git stash -u` (cwd `$R`) is REFUSED. Then `ac mods enable canon-guard`: both guard entries
  present; `git stash -u` is REFUSED by the git-guard entry and gets no decision from the
  canon-guard entry; `echo x > .astrocode/state.json` gets no decision from the git-guard entry.
  `ac mods disable git-guard` → canon-guard's entry is untouched and still works; then
  `ac mods disable canon-guard` → each `settings.json` is JSON-equal to its saved copy.
- **Fails if:** only the base profile gets the entry; the matcher misses Bash; a second `enable`
  duplicates the entry; disabling one guard removes, breaks or rewrites the other guard, the
  user's own hook, or unrelated keys; disabling both leaves anything behind.

### C2 — `ac install` / `ac update` re-sync the git-guard entry to its switch
- **Observe:** (a) With git-guard enabled, add a third profile to `profiles.json` (empty dir, no
  settings.json) and run `ac install` → that profile holds exactly one working git-guard entry.
  (b) Hand-delete the entry from one profile, `ac install` → restored, nothing duplicated.
  (c) `ac mods disable git-guard`, hand-insert a copy of the entry into one profile, `ac install`
  → the stale entry is removed. Repeat (a) with `ac update` if it runs offline in the sandbox.
- **Fails if:** a later-added profile never receives the guard; a hand-removed entry stays missing
  while the switch is on; a stale entry survives re-sync while the switch is off; any re-sync
  duplicates entries.

### C3 — Every canon-listed unscoped destructive git form is refused, in the shared tree and in an agent worktree
- **Observe:** Feed Bash events, once with `cwd=$R` and once with `cwd=$R/.claude/worktrees/agent-1`,
  for: `git stash`; `git stash -u`; `git stash --include-untracked`; `git stash -a`;
  `git stash --all`; `git stash save "wip"`; `git stash push`; `git stash push -u`;
  `git stash push -m "wip"`; `git stash push --keep-index`; `git clean -f`; `git clean -fd`;
  `git clean -fdx`; `git clean --force`; `git reset --hard`; `git reset --hard HEAD~1`;
  `git reset --hard origin/main`; `git checkout .`; `git checkout -- .`; `git restore .`;
  `git restore --worktree .`; `git restore --staged .`; `git restore --staged --worktree .`.
  Every case is REFUSED. Then hand-set `"mods":{"git-guard":false}` (or remove the key) in
  `$HOME/.astro/config.json` and re-feed `git stash -u` — the registered guard still refuses.
- **Fails if:** any listed form is allowed (e.g. only the bare `git stash` caught, `stash push`
  treated as always scoped, `reset --hard` with a ref missed, `restore --staged .` missed); the
  worktree cwd is exempted; the script consults the config switch at run time (ADR-072:
  registration is the switch).

### C4 — Wrapped, prefixed and compound spellings are refused segment by segment
- **Observe:** Feed Bash events (`cwd=$R`) for: `cd $R && git stash -u`; `cd src; git clean -fd`;
  `FOO=1 git reset --hard`; `GIT_DIR=.git git stash`; `command git clean -f`; `exec git stash -u`;
  `git -C $R stash -u`; `git -C "$R" reset --hard`; `git --git-dir=$R/.git stash`;
  `git -c core.pager=cat stash -u`; `git status && git stash -u && git stash pop`;
  `git fetch || git reset --hard origin/main`; `ac status; git clean -fdx`;
  `echo y | git clean -f`; a two-line command `git status` + newline + `git reset --hard`;
  `bash -c "git stash -u"`; `sh -c 'git reset --hard'`; `bash -c "cd src && git clean -fd"`;
  `lean-ctx -c "git stash -u"`; `lean-ctx -c 'cd /tmp && git reset --hard'` — and, if the phase
  recorded that the guard actually receives some other rewritten form of a Bash command when
  lean-ctx's own PreToolUse hook runs first, `git stash -u` in exactly that recorded form. Every
  case is REFUSED.
- **Fails if:** a compound command is waved through because its first segment is harmless; a
  `cd`/env/`command`/`exec` prefix or a `git -C`/`--git-dir`/`-c` global option hides the
  subcommand; one level of `sh -c`/`bash -c` or the lean-ctx wrapper hides it; the phase never
  established which form the guard receives under lean-ctx.

### C5 — Scoped, read-only and out-of-scope git (and mere mentions of git) are never refused
- **Observe:** Feed Bash events (`cwd=$R`, and the scoped-stash cases also from the worktree cwd)
  for: `git stash push -- src/a.js`; `git stash push -m "wip" -- src/a.js notes.txt`;
  `git stash push -u -- notes.txt`; `git stash pop`; `git stash apply stash@{0}`;
  `git stash list`; `git stash show -p`; `git stash drop`; `git clean -n`; `git clean --dry-run -d`;
  `git reset --soft HEAD~1`; `git reset HEAD src/a.js`; `git reset --mixed`;
  `git checkout -- src/a.js`; `git checkout main`; `git checkout -b feat`;
  `git restore src/a.js`; `git restore --staged src/a.js`; `git status`; `git log --oneline`;
  `git push --force origin feat`; `git branch -D feat`; `git worktree remove --force .claude/worktrees/agent-1`;
  `echo "never run git stash -u here"`; `git commit -m "avoid git reset --hard"`;
  `grep -rn "git clean -fd" docs`; `ac mods disable git-guard`; `ls -la`. Every case is ALLOWED.
- **Fails if:** any is refused — the scoped stash form (pathspec after `--`) treated as unscoped,
  pop/apply/list/show/drop or a dry-run clean caught, a non-hard reset or path-scoped
  checkout/restore caught, the out-of-scope force push / `branch -D` / `worktree remove --force`
  caught (CONTEXT decision 1: those need an ADR first), or a destructive phrase merely appearing
  inside a quoted argument of a different command trips the guard.

### C6 — The refusal reason quotes the rule, says why, and names the scoped alternative and the escape, briefly
- **Observe:** Collect the reason text (stdout `permissionDecisionReason`, or stderr on exit 2)
  for `git stash -u`, `git clean -fd`, `git reset --hard` and `git checkout .`. Each reason:
  cites ADR-035 and/or ADR-038; says why (the stash stack is repository-wide, and/or that a
  finished plan was destroyed this way); names the scoped alternative `git stash push -- <path>`
  with `git stash pop`; names the escape `ac mods disable git-guard`; is at most 8 lines with no
  stack trace. Running `ac mods disable git-guard` in the sandbox actually succeeds and removes
  the guard (the named escape works).
- **Fails if:** the reason is empty or generic ("blocked"); no ADR cited; no why; the scoped
  alternative or the escape is missing or names a verb that does not work; an env-var escape is
  offered instead; the reason runs long.

### C7 — The refusal verdict is `ask`, unless a recorded live finding on Claude Code 2.1.292 justified falling back to `deny`
- **Observe:** Read what the phase recorded (in the phase directory, a doc, or an ADR) about hook
  `ask` behaviour on Claude Code 2.1.292 under `bypassPermissions` and in `-p`/Workflow agents.
  Compare it with the verdict GUARD actually returns for `git stash -u` (cwd `$R`): if the
  finding says `ask` still prompts interactively and refuses without hanging in a
  non-interactive agent, the verdict is `ask`; if it says `ask` is auto-approved in bypass mode
  or hangs an agent, the verdict is `deny`. Either way the verdict is the same for every C3/C4
  case.
- **Fails if:** no live finding was recorded; the observed verdict contradicts the recorded
  finding (e.g. `ask` shipped although the finding shows bypass auto-approves it); the verdict
  is an explicit `allow`, or differs between refused cases.

### C8 — Malformed or unexpected input fails open, silently
- **Observe:** Feed GUARD: empty stdin; `not json`; `{}`; `{"tool_name":"Bash"}` (no tool_input);
  `{"tool_name":"Bash","tool_input":{"command":null}}`; `{"tool_name":"Bash","tool_input":{"command":42}}`;
  `{"tool_name":"Write","tool_input":{"file_path":"/tmp/x","content":"git stash -u"}}`;
  a Bash event whose command has an unterminated quote, `bash -c "git stash -u`; and a Bash
  `git stash -u` event whose `cwd` does not exist. Each of the first seven is ALLOWED. The last
  two may be ALLOWED or REFUSED, but must not crash. No case prints a stack trace (no `    at `
  frames, no uncaught `Error:` dump), hangs, or exits non-zero other than a deliberate refusal.
- **Fails if:** any input crashes, prints a stack, hangs, or emits a decision for a non-Bash tool
  or a non-string command.

### C9 — Deciding a call spawns no other program and is fast
- **Observe:** Make `$S/bin` with executable stubs named `git`, `ac`, `jq` and `lean-ctx` that
  each append their own name to `$S/spawned.log`; run GUARD with
  `PATH=$S/bin:$(dirname "$(command -v node)"):/usr/bin:/bin` (stubs first) for every C3, C4 and
  C5 event, plus 20 back-to-back `git status` events timed with `time`. `$S/spawned.log` stays
  empty; the 20 calls finish within 20 s total.
- **Fails if:** the guard shells out (runs git, ac, lean-ctx, jq, …) to reach a verdict, or each
  call is slow enough to tax every Bash use.

### C10 — `ac mods status` truthfully reports git-guard and where it is enforced
- **Observe:** In the two-profile sandbox: before enable, `ac mods status git-guard` (and `--json`)
  shows git-guard as available and off — not "not built yet". After enable, it shows on and
  enforced in both profiles. Hand-delete the entry from one profile's settings.json and re-run:
  that profile is no longer reported as enforced (or is flagged). With a Cursor config dir present
  (`CURSOR_CONFIG_DIR=$S/cursor`, created), the output states Cursor's position for git-guard
  explicitly: enforced (with whether it asks or denies there, C11) or "not enforced on Cursor".
- **Fails if:** status still reports git-guard unbuilt; derives "enforced" from the switch alone
  and lies about a profile missing its entry; says nothing about Cursor when Cursor is present.

### C11 — Cursor wiring is honest and never doubled
- **Observe:** Sandbox A, Cursor native (no `$HOME/.claude`, `CLAUDE_CONFIG_DIR` unset,
  `CURSOR_CONFIG_DIR=$S/cursor` created), `$S/cursor/hooks.json` pre-seeded with a user hook
  (`echo mine`). `ac install`, then `ac mods enable git-guard` twice: the user hook is intact and
  EITHER exactly one git-guard entry sits on a Cursor event that can block shell commands and,
  fed that event's payload for `git stash -u`, answers with the response the phase recorded from
  its Cursor research (native `ask` if Cursor honours it, otherwise `deny`, with `ac mods status`
  saying which) — OR `ac mods status` reports git-guard "not enforced on Cursor". `ac mods
  disable git-guard` removes only that entry. Sandbox B (Claude and Cursor both present): after
  enable, Cursor's hooks.json carries no native git-guard entry while Claude's settings.json does.
- **Fails if:** the user hook is touched; enabling twice duplicates the Cursor entry; Cursor gets
  a native guard while Claude's import already supplies one (double firing); status claims Cursor
  enforcement with no blocking entry wired, or claims `ask` where the wired entry denies (or the
  reverse).

### C12 — The repository's test suite stays green
- **Observe:** From `/Users/buu/Development/astro-code`, run the project's full test command
  (`npm test`, or `node --test tests/` if that is what it wraps) → exits 0 with zero failing tests,
  including the Cursor hook drift guard and the parity test that no command/agent body depends
  on a mod (ADR-071).
- **Fails if:** any test fails or errors at load, or an existing guard test was weakened or
  skipped to accommodate git-guard instead of accounting for it.
