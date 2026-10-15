<!-- astro-discuss: captured -->
# Phase 37 — canon-guard: PreToolUse settings hook refusing hand edits to generated and registry-owned state

Builds on phase 36 (ADR-071; `lib/mods.mjs` FEATURES has `canon-guard`, `kind: 'hook'`,
`built: false`). Per ADR-071 this is a **PreToolUse settings hook**, not a mod: it needs no
per-agent knowledge, and Claude settings hooks also reach Cursor.

## Decisions

1. **Protected set.** Only files that are owned by the CLI or generated:
   - `.astrocode/{roadmap,state,debt,backlog,fixes}.json`
   - `.astrocode/ROADMAP.md`
   - `.astrocode/DECISIONS.in-force.md`
   - `~/.astro/principles/**`

   **Not protected:** `.astrocode/config.json`, `~/.astro/config.json` (agent_tools is
   hand-edited), `CONVENTIONS.md`, `DECISIONS.md`, `PROJECT.md`, phase dirs (CONTEXT/PLAN/…).

   - Paths are resolved against the project root: the dir holding `.astrocode/`, found
     upward from the hook's cwd or from the tool's absolute target path.
   - Symlinks and `..` are normalised, so relative, absolute and `./` spellings all match.
   - Keep the set as **one exported constant** that the deny message and tests share.
2. **What it inspects.**
   - Write, Edit and NotebookEdit: always. MultiEdit too, if the host has it.
   - Bash: refuse obvious writes aimed at a protected path, namely `>`, `>>`, `sed -i`,
     `perl -i`, `tee`, `cp`/`mv`/`rm` (destination/target), `truncate`, and `dd of=`.
   - Bash, never refuse: commands starting with `ac` (the sanctioned writer), plain reads
     (cat/head/grep/jq without in-place flags), or `git` commands. git's own handling of
     these files is phase 38's ground, not this one.
   - Compound commands (`&&`, `;`, `|`): check each segment.
   - Document this in a comment as **catching mistakes, not a sandbox** (ADR-071).
     `python -c`/`node -e` writes are out of scope.
3. **Verdict: deny**, never ask. It must behave the same in headless and Workflow subagents.
   - The reason names the rule and its source (AGENTS.md "Never hand-edit…", ADR-004, and
     for principles ADR-057/058).
   - It names the `ac` verb to use for that file: `ac phase …`/`ac milestone …` for
     roadmap/state, `ac roadmap render` for ROADMAP.md, `ac debt …`, `ac backlog …`,
     `ac fix …`, `ac canon pull` for DECISIONS.in-force.md, and the `ac principles` propose
     path for the store.
   - It names the two escapes (decision 4).
   - Keep it to a few lines.
4. **Escapes.**
   - (a) **Conflict pass:** allow when the target file currently contains git conflict
     markers (a line starting `<<<<<<< `) or is unmerged (`git status --porcelain` shows
     `UU`/`AA`/…). Resolving a merge is the one hand edit ADR-004 can't route through `ac`.
   - (b) Anything else: `ac mods disable canon-guard`, edit, re-enable.
   - No env-var escape.
5. **Switch = registration.**
   - `ac mods enable canon-guard` **writes the PreToolUse entry** into every Claude
     profile's settings.json (the same fan-out as `registerHooks`).
   - It also writes into Cursor's native hooks.json when Cursor is on native hooks (per
     `lib/hosts/cursor.mjs`'s branch).
   - `disable` removes it.
   - `ac install`/`ac update` re-sync the entries to the switch state, so a profile added
     later gets the entry and a stale entry is removed.
   - The hook script itself does **not** read `~/.astro/config.json`: being registered
     means it is on. Zero cost when off.
   - Flip `canon-guard` to `built: true` in `FEATURES`; `ac mods status` shows where the
     guard is enforced.
6. **Hook script.** `hooks/astro-canon-guard.mjs`.
   - Standalone: no `lib/` imports, per the existing hooks rule; shared helpers go in
     `hooks/_astro-ctx.mjs` only if they're genuinely shared.
   - Reads the hook JSON on stdin and emits the host's deny shape.
   - **Fail open:** on any internal error, malformed input or unknown tool, allow (exit 0
     with no decision), and never print a stack (ADR-071 e).
   - Must stay fast: one node start, no spawns, except `git status` only when a protected
     path is hit and the conflict pass needs it.
7. **Cursor: best effort.**
   - Wire it wherever Cursor can block: the import of Claude's PreToolUse when Claude Code
     is present, or Cursor-native `hooks.json` events when it isn't.
   - Planning must establish which Cursor events and deny shapes actually block
     (`preToolUse`/`beforeShellExecution`/…), and add the mapping to `EVENT_MAP` /
     `ASTRO_HOOKS` handling.
   - Where Cursor cannot block, `ac mods status` reports canon-guard as "not enforced on
     Cursor" and the prose rule stands. The phase does **not** fail on Cursor's limits.
   - Codex: nothing (no hooks wired by design); prose rule only.
   - The drift guard `tests/cursor_hooks.test.mjs` must cover the new entry. A
     conditionally present hook is not part of the always-on `ASTRO_HOOKS` list, so the
     test must allow for that explicitly.

## Folded-in debt (in scope)

- `2026-10-07-cursor-hook-ownership-matched-by-full`: Cursor hook ownership is matched by
  full path rather than by script filename as phase 35's decision 2 specifies
  (`lib/hosts/cursor.mjs`). Fix it while adding the guard entry, since ownership matching
  decides whether `disable`/re-sync removes exactly our entries.

## Out of scope

- git-guard (phase 38): destructive git, and any `git` command touching protected files.
- Per-agent strictness (needs a mod).
- `python`/`node` inline writes.
- `.astrocode/config.json` protection.
- Per-project switches.

## Open questions / assumptions

- Exact Claude PreToolUse deny output (`hookSpecificOutput.permissionDecision: "deny"` +
  reason) on 2.1.292: confirm it live, the way phase 36's probe did.
- Whether Cursor's import of Claude hooks honours a PreToolUse deny, and Cursor's native
  blocking events and their output shape: research during planning, and record the
  outcome in PLAN/PROBE notes.
- The principles store path honours `ASTRO_HOME`/`HOME` overrides the same way `lib/principles.mjs` does.
