# Criteria — phase 37: canon-guard (PreToolUse settings hook refusing hand edits to generated and registry-owned state)

> Pre-registered, plan-blind. Derived from the phase goal, CONTEXT.md (decisions 1-7 + the
> folded-in debt) and canon (AGENTS.md "Never hand-edit…", ADR-004, ADR-057/058, ADR-071,
> ADR-072). The plan and the verifier both answer to this bar.

## Shared harness (used by every criterion below)

- **Sandbox.** Never touch the real home. `S=$(mktemp -d)`; `export HOME=$S/home`; unset
  `CLAUDE_CONFIG_DIR`, `CURSOR_CONFIG_DIR`, `ASTRO_PRINCIPLES_DIR` unless a criterion sets
  them; `mkdir -p $HOME/.claude`. Run the CLI as `node /Users/buu/Development/astro-code/bin/ac.mjs`
  (written `ac` below). Turn the feature on the way ac documents it: `ac install` (so the
  installed copy exists under `$HOME`) then `ac mods enable canon-guard`.
- **GUARD.** The command(s) that `ac mods enable canon-guard` added under `hooks.PreToolUse` in
  a profile's `settings.json` (diff the file before/after enable). Drive it exactly as Claude
  Code would: `printf '%s' "$EVENT_JSON" | sh -c "$GUARD"`, honouring the entry's `matcher`
  (a tool the matcher does not cover is, in practice, unguarded).
- **Events.** Claude PreToolUse payloads:
  `{"hook_event_name":"PreToolUse","cwd":"<dir>","tool_name":"Write","tool_input":{"file_path":"<p>","content":"x"}}`;
  Edit → `{file_path,old_string,new_string}`; MultiEdit → `{file_path,edits:[…]}`;
  NotebookEdit → `{notebook_path,new_source}`; Bash → `{command}`.
- **Project P.** `P=$(mktemp -d)`, `git init`, commit a `.astrocode/` holding plausible
  `roadmap.json state.json debt.json backlog.json fixes.json ROADMAP.md DECISIONS.in-force.md
  config.json CONVENTIONS.md DECISIONS.md PROJECT.md phases/37-x/{CONTEXT.md,PLAN.md}`, plus
  `src/a.js` and `docs/roadmap.json`. Principle store: `$HOME/.astro/principles/p-1.md`.
- **DENIED** = exit 2, or exit 0 with stdout JSON whose `hookSpecificOutput.permissionDecision`
  is `"deny"`. Never `"ask"`.
- **ALLOWED** = exit 0 and stdout carries **no** permission decision at all — not `deny`, not
  `ask`, and not `allow` (an explicit `allow` would auto-approve the call past the user's own
  permission rules, which a guard must never do).

---

### C1 — Enabling canon-guard makes it live in every Claude profile; disabling removes exactly it
- **Observe:** In the sandbox, register a second Claude profile (`$HOME/.claude/.jean-claude/profiles.json`
  listing `{"profiles":{"work":{"configDir":"$HOME/.claude-work"}}}`; `mkdir -p` it). Pre-seed
  BOTH profiles' `settings.json` with a user-owned `PreToolUse` entry (`matcher:"Bash"`,
  command `echo user-hook`) and an unrelated top-level key. Save copies. Run
  `ac mods enable canon-guard`, then run it a second time. In each profile: exactly one guard
  entry exists; its matcher covers Write, Edit, MultiEdit, NotebookEdit and Bash; feeding it a
  Write to `$P/.astrocode/state.json` is DENIED. Run `ac mods disable canon-guard`: each
  `settings.json` is JSON-equal to its saved pre-enable copy (user hook and unrelated key intact).
- **Fails if:** only the base profile gets the entry; the matcher omits any of the five tools;
  a second `enable` adds a duplicate entry; `disable` leaves the guard behind, or removes or
  rewrites the user's own hook or keys.

### C2 — `ac install` / `ac update` re-sync guard entries to the switch
- **Observe:** (a) With canon-guard enabled, add a third profile to `profiles.json` (empty dir,
  no settings.json) and run `ac install` → that profile now holds exactly one working guard
  entry. (b) Hand-delete the guard entry from one profile, run `ac install` → it is restored,
  not duplicated elsewhere. (c) `ac mods disable canon-guard`, then hand-insert a copy of the
  guard entry into one profile's settings.json, run `ac install` → the stale entry is removed.
  Repeat (a) with `ac update` if it runs offline in the sandbox.
- **Fails if:** a later-added profile never receives the guard; a hand-removed entry stays
  missing while the switch is on; a stale entry survives re-sync while the switch is off; any
  re-sync duplicates entries.

### C3 — Every hand edit to a protected file is denied, whatever the tool and path spelling
- **Observe:** For each of `.astrocode/{roadmap,state,debt,backlog,fixes}.json`,
  `.astrocode/ROADMAP.md`, `.astrocode/DECISIONS.in-force.md` and `$HOME/.astro/principles/p-1.md`,
  feed Write, Edit, MultiEdit and NotebookEdit events using each spelling: absolute path;
  relative with `cwd=$P`; `./.astrocode/…`; `src/../.astrocode/…`; `../.astrocode/…` with
  `cwd=$P/src`; absolute path with `cwd=/`; absolute path through a symlinked directory
  (`ln -s $P $S/link` → `$S/link/.astrocode/state.json`); a symlinked file
  (`ln -s ../.astrocode/state.json $P/src/s.json` → target `$P/src/s.json`). Also: Write creating
  `.astrocode/fixes.json` after deleting it (target does not exist yet); and a store file under
  `$S/alt` when `ASTRO_PRINCIPLES_DIR=$S/alt` is in the hook's environment (the store location
  `ac principles` itself resolves). Finally, hand-set `"mods":{"canon-guard":false}` (or remove the
  key) in `$HOME/.astro/config.json` and re-feed one Write — the registered guard still denies.
  Every case is DENIED.
- **Fails if:** any spelling slips through (relative-only or string-prefix matching, no
  symlink/`..` normalisation); a not-yet-existing target is allowed (e.g. a realpath error
  falling through to fail-open); the store override is ignored; the verdict is `ask`; the
  registered script consults the config switch at run time (ADR-072: registration is the switch).

### C4 — Files outside the protected set are allowed with no decision
- **Observe:** Feed Write and Edit events (cwd `$P`) for: `.astrocode/config.json`,
  `$HOME/.astro/config.json`, `.astrocode/CONVENTIONS.md`, `.astrocode/DECISIONS.md`,
  `.astrocode/PROJECT.md`, `.astrocode/phases/37-x/CONTEXT.md`, `.astrocode/phases/37-x/PLAN.md`,
  `.astrocode/phases/37-x/state.json`, `.astrocode/ROADMAP.md.bak`, `src/a.js`,
  `docs/roadmap.json`, `$HOME/.astro/principles-notes.md` (sibling sharing the store's name
  prefix), and `/tmp/<fresh>/state.json` in a directory with no `.astrocode/` above it. Every
  case is ALLOWED.
- **Fails if:** any of them is denied (basename matching, missing path-separator boundary,
  protecting the whole `.astrocode/` tree or `~/.astro/`), or the guard emits an explicit
  `allow` decision for them.

### C5 — Obvious Bash writes to a protected file are denied, segment by segment
- **Observe:** Feed Bash events with `cwd=$P` for: `echo x > .astrocode/state.json`;
  `echo x >.astrocode/state.json`; `echo x >> .astrocode/debt.json`;
  `sed -i 's/a/b/' .astrocode/roadmap.json`; `sed -i.bak 's/a/b/' .astrocode/roadmap.json`;
  `perl -pi -e 's/a/b/' .astrocode/backlog.json`; `echo x | tee .astrocode/fixes.json`;
  `echo x | tee -a .astrocode/ROADMAP.md`; `cp /tmp/x .astrocode/ROADMAP.md`;
  `mv /tmp/x .astrocode/DECISIONS.in-force.md`; `rm -f .astrocode/state.json`;
  `truncate -s 0 .astrocode/state.json`; `dd if=/dev/null of=.astrocode/state.json`;
  `echo x > $HOME/.astro/principles/p-1.md` (path written out absolute); compound forms
  `ac status && echo x > .astrocode/state.json`, `git status; rm .astrocode/debt.json`,
  `cat src/a.js | tee .astrocode/roadmap.json`; plus `echo x > ../.astrocode/state.json` with
  `cwd=$P/src` and `echo x > $P/.astrocode/state.json` with `cwd=/tmp`. Every case is DENIED.
- **Fails if:** any listed form is allowed — in particular a whole compound command waved
  through because its first segment is `ac`/`git`/a read, or relative paths resolved against
  the wrong directory.

### C6 — Sanctioned and read-only Bash is never refused
- **Observe:** Feed Bash events with `cwd=$P` for: `ac phase add "x"`; `ac roadmap render`;
  `ac debt list`; `cat .astrocode/state.json`; `head -n 5 .astrocode/roadmap.json`;
  `grep -n phase .astrocode/roadmap.json 2>/dev/null`; `jq '.phases' .astrocode/roadmap.json`;
  `sed -n 1p .astrocode/state.json`; `cat .astrocode/state.json > /tmp/copy.json`;
  `cp .astrocode/roadmap.json /tmp/r.json`; `ls -la .astrocode`; `git add .astrocode/roadmap.json`;
  `git checkout -- .astrocode/state.json`; `echo x > src/a.js`; `echo x > .astrocode/config.json`;
  `rm .astrocode/phases/37-x/PLAN.md`. Every case is ALLOWED.
- **Fails if:** any is denied — a protected path appearing as a read source, a redirect of
  stderr/stdout to an unprotected target, a `git` command, or an `ac` command trips the guard.

### C7 — The deny reason names the rule, the right `ac` verb for that file, and both escapes, briefly
- **Observe:** Collect the reason text (stdout `permissionDecisionReason`, or stderr on exit 2)
  for a Write to each protected file. Each reason: cites the rule's source (AGENTS.md's
  "Never hand-edit" rule or ADR-004 for `.astrocode/` files; ADR-057 or ADR-058 for the
  principle store); names the verb for THAT file — roadmap.json/state.json → `ac phase`/`ac milestone`,
  ROADMAP.md → `ac roadmap render`, debt.json → `ac debt`, backlog.json → `ac backlog`,
  fixes.json → `ac fix`, DECISIONS.in-force.md → `ac canon pull`, store → `ac principles`;
  names both escapes (a file mid-merge with conflicts may be edited; `ac mods disable canon-guard`
  for anything else); is at most 8 lines with no stack trace. Every verb it names appears in
  `ac help`.
- **Fails if:** one generic message for every file; a wrong or nonexistent verb (e.g. ROADMAP.md
  pointed at `ac phase`); either escape missing; an env-var escape offered; the reason runs long.

### C8 — Resolving a merge conflict in a protected file is allowed; nothing else is
- **Observe:** In `$P`: (a) write a line beginning `<<<<<<< HEAD` into `.astrocode/debt.json`
  (uncommitted) → Write/Edit to it ALLOWED. (b) Make two branches change the same line of
  `.astrocode/roadmap.json`, `git merge` so it conflicts; Edit to roadmap.json ALLOWED; then
  strip the markers by hand WITHOUT `git add` (`git status --porcelain` still shows `UU`) → Edit
  still ALLOWED. (c) While roadmap.json is unmerged, a Write to the clean `.astrocode/state.json`
  is DENIED. (d) After `git add` + commit of the resolution, Edit to roadmap.json is DENIED again.
  (e) A protected file whose only `<<<<<<<` sits mid-line (e.g. inside a JSON string) and that is
  not unmerged → DENIED.
- **Fails if:** the conflict pass is missing (a), relies only on markers and misses an unmerged
  file (b), is repo-wide rather than per-file (c), persists after resolution (d), or matches the
  marker anywhere in the text (e).

### C9 — Malformed or unexpected input fails open, silently
- **Observe:** Feed GUARD: empty stdin; `not json`; `{}`; `{"tool_name":"Write"}` (no
  tool_input); `{"tool_name":"Write","tool_input":{"file_path":42}}`;
  `{"tool_name":"Bash","tool_input":{"command":null}}`;
  `{"tool_name":"FutureTool","tool_input":{"file_path":"$P/.astrocode/state.json"}}`; a relative
  Write target with a nonexistent `cwd`. Each: ALLOWED, and neither stdout nor stderr contains
  a stack trace (no `    at ` frames, no uncaught `Error:` dump).
- **Fails if:** any input crashes with a non-zero exit other than a deliberate deny, prints a
  stack, emits a decision, or blocks.

### C10 — Deciding an unprotected call spawns no other program
- **Observe:** Make `$S/bin` with executable stubs `git`, `ac`, `jq` that each append their name
  to `$S/spawned.log`; run GUARD with `PATH=$S/bin:/usr/bin:/bin` for every C4 and C6 event, plus
  20 back-to-back unprotected Writes timed with `time`. `$S/spawned.log` stays empty; the 20
  calls finish within 20 s total.
- **Fails if:** the guard shells out (git status, ac, jq, …) for calls that touch no protected
  path, or each call is slow enough to tax every tool use.

### C11 — `ac mods status` truthfully reports where canon-guard is enforced
- **Observe:** In the two-profile sandbox: before enable, `ac mods status canon-guard` (and
  `--json`) shows canon-guard as available and off — not "not built yet". After enable, it shows
  on and enforced in both profiles. Hand-delete the entry from one profile's settings.json and
  re-run: that profile is no longer reported as enforced (or is flagged). With a Cursor config dir
  present (`CURSOR_CONFIG_DIR=$S/cursor`, created), the output states Cursor's position explicitly:
  enforced (only when a blocking guard entry is really wired, C12) or "not enforced on Cursor".
- **Fails if:** status derives "enforced" from the switch alone and lies about a profile missing
  its entry; still reports the feature unbuilt; says nothing about Cursor when Cursor is present.

### C12 — Cursor wiring is honest, never doubled, and owns its entries by script filename
- **Observe:** Sandbox A, Cursor native (no `$HOME/.claude`, `CLAUDE_CONFIG_DIR` unset,
  `CURSOR_CONFIG_DIR=$S/cursor` created): pre-seed `$S/cursor/hooks.json` with a user hook
  (`echo mine`) and a stale astro-code entry for one of astro-code's own hook scripts at a
  different directory (e.g. `node /old/place/.astro/code/hooks/astro-update.mjs` under
  `sessionStart`). Run `ac install` and `ac mods enable canon-guard`: hooks.json holds at most one
  entry per astro-code script/argument (the stale-path one is recognised as astro-code's, not
  duplicated), the user hook is intact, and EITHER a canon-guard entry sits on a Cursor event that
  can block and, fed that event's payload for a write to `$P/.astrocode/state.json`, answers with
  the blocking response the phase recorded from its Cursor research — OR `ac mods status` reports
  canon-guard "not enforced on Cursor". `ac mods disable canon-guard` removes the guard entry only;
  then `mkdir $HOME/.claude` + `ac install` (Claude appears) removes every astro-code entry,
  stale-path one included, leaving `echo mine`. Sandbox B (both Claude and Cursor present):
  after enable, Cursor's hooks.json carries no native canon-guard entry while Claude's
  settings.json does.
- **Fails if:** a stale-path astro-code entry is duplicated or survives removal (full-path
  ownership — the folded-in debt); the user's hook is touched; Cursor gets a native guard while
  Claude's import already supplies one (double firing); status claims Cursor enforcement with no
  blocking entry wired.

### C13 — The repository's test suite stays green
- **Observe:** From `/Users/buu/Development/astro-code`, run the project's full test command
  (`npm test`, or `node --test tests/` if that is what it wraps) → exits 0 with zero failing tests,
  including the Cursor hook drift guard.
- **Fails if:** any test fails or errors at load, or the drift guard was weakened to skip the
  conditionally-registered guard entry instead of accounting for it.
