<!-- astro-discuss: captured -->
# Phase 38 — git-guard: PreToolUse settings hook refusing unscoped destructive git in the shared tree

Sibling of phase 37 (canon-guard): same shape, different rule. Per ADR-071 it is a
**PreToolUse settings hook** (`kind: 'hook'` in `lib/mods.mjs` FEATURES). Per ADR-072 its
switch is its registration. **Reuse phase 37's machinery** wherever it exists:

- `lib/hosts/guards.mjs` (GUARD_HOOKS / GUARD_SCRIPTS / guardCommand / ownership by script
  filename);
- Claude `registerGuard`/`unregisterGuard`/`guardState`;
- Cursor guard registration;
- `ac mods` re-sync on install/update;
- the enforcement column in `ac mods status`.

Adding git-guard should mostly be a new entry plus a new script, not new plumbing. If phase
37 is not yet verified/accepted when this executes, plan against what's on develop.

## Decisions

1. **Refused commands: exactly the canon list plus same-effect spellings.** Sources:
   ADR-035, ADR-038, and `NO_BROAD_STASH` in `workflows/execute-phase.mjs:89`.
   - Unscoped stash: `git stash`, `git stash -u`/`--include-untracked`, `-a`/`--all`,
     `git stash save …`, and `git stash push` without a `-- <pathspec>`.
   - `git clean`, any flags (`-n`/`--dry-run` may pass, since it changes nothing).
   - `git reset --hard`, with or without a ref.
   - `git checkout .`, `git checkout -- .`.
   - `git restore .` and `git restore --worktree/--staged … .` on the whole tree.

   Allowed: `git stash push -- <path>…` (scoped), `git stash pop|apply|list|show|drop`,
   and every other git command.

   **Not in scope:** `push --force`, `branch -D`, and `worktree remove --force`. They are
   not in the canon, and `/astro-execute` itself tells the user to run the last two for
   leftovers. Adding them would need an ADR first.
2. **Everywhere.** The shared tree and agent worktrees (`.claude/worktrees/*`) alike, matching
   the canon wording (ADR-038 put the ban in every executor prompt). The stash stack is
   repository-wide, and the heal ladder is drop-and-rerun (ADR-014), so no role needs these.
3. **Verdict: `ask`, not deny.**
   - The user can approve a deliberate reset in their own session.
   - A background Workflow agent can't answer a prompt, so for agents it acts as a refusal,
     with no need to detect which session is an agent.
   - The reason quotes the rule (ADR-035/038), says why (the stash stack is repo-wide; a
     plan was destroyed this way), and names the scoped alternative
     (`git stash push -- <path>` … `git stash pop`) and the escape
     (`ac mods disable git-guard`).
   - **Planning must confirm live on Claude Code 2.1.292** that a hook `ask` still prompts
     under `bypassPermissions` and in `-p`/Workflow agents (expect: refused, no hang). If
     `ask` is auto-approved in bypass mode or hangs an agent, fall back to **deny**, and
     record the finding.
4. **Parsing (catch mistakes, not a sandbox: ADR-071).**
   - Split compound commands (`&&`, `||`, `;`, `|`, newlines) and check each segment.
   - Strip leading `cd … &&`, env assignments (`FOO=1 git …`), `command`/`exec`, and
     `git -C <dir>` / `--git-dir`/`-c k=v` global options before the subcommand.
   - **Unwrap the lean-ctx Bash wrapper** (`lean-ctx -c "<cmd>"` and similar), because the
     guard may see the rewritten command, depending on PreToolUse hook order. Find out which
     form the guard actually receives, and handle both.
   - `sh -c`/`bash -c "…"` one level deep: yes. Aliases, scripts and `eval`: out of scope.
5. **Script.** `hooks/astro-git-guard.mjs`.
   - Standalone (no `lib/` imports), with the same fail-open contract as canon-guard: on
     any error or malformed input, allow silently.
   - Fast: no spawns.
   - Output in the host's ask shape.
6. **Switch, Cursor and Codex: same as phase 37.**
   - Registration fans out to every Claude profile, and to Cursor's native hooks when used.
   - Cursor is best effort, and `ac mods status` says where the guard isn't enforced.
     Planning establishes whether Cursor honours `ask` (`permission: "ask"` natively, and a
     translated Claude ask). If Cursor can't ask, use deny on Cursor and say so in status.
   - Codex: prose only.
   - Flip `git-guard` `built: true`.

## Out of scope

- Force push / branch -D / worktree remove, unless a new ADR first.
- Per-agent strictness (a mod).
- Checking git operations done by `ac` itself or by the workflow script: `ac` uses git via
  `child_process`, not the Bash tool, so the guard never sees them.
- A slash command for `ac mods`. A personal principle says every user-facing capability
  gets one; note it as a follow-up for the milestone, not for this phase.

## Open questions / assumptions

- Hook `ask` behaviour under bypassPermissions / `-p` / Workflow agents on 2.1.292 (decision 3).
- What form the guard receives when lean-ctx's PreToolUse rewrites Bash (decision 4).
- Interplay with canon-guard: both are Bash PreToolUse entries; each decides independently,
  and the strictest verdict wins (Claude merges hook decisions).
