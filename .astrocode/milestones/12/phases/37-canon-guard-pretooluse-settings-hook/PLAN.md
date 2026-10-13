# Plan — phase 37: canon-guard (PreToolUse settings hook refusing hand edits to generated and registry-owned state)

This plan follows:
- `.astrocode/CONVENTIONS.md`: Node ≥22 ESM `.mjs`, zero deps, named exports, `die`/`json()`/glyphs,
  `node:test` with a real fs, and the house comment voice.
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-004: the CLI owns the state files.
  - ADR-018: RED tests use dynamic imports.
  - ADR-020: every wave boundary is green.
  - ADR-021: CRITERIA.md is the bar.
  - ADR-029: flag allowlists.
  - ADR-045: debt is a register.
  - ADR-057/058: the principle store.
  - ADR-071: guards are PreToolUse settings hooks that are off by default, fail open, and quote the canon rule.
  - ADR-072: the switch is the registration, and the script never reads the switch.
- This phase's `CONTEXT.md`, decisions D1–D7 plus the folded-in debt.

It aims at every criterion in `CRITERIA.md`, C1–C13.

The principles brief (`--stage plan --by planner`) returned nothing that bears on this phase. The
nearest entry is "advisory/personal rules are non-blocking", and it does not apply: ADR-071 makes
canon-guard a deny of a rule the shared canon states, not a personal rule.

## Facts settled during planning

Executors must not re-derive these. Build on them.

### F1 — Claude Code 2.1.292 PreToolUse deny, verified live

Method:
- Ran `claude -p --settings <scratch settings.json> --permission-mode bypassPermissions` in a
  scratch git dir.
- The hook entry was
  `{"matcher":"Write|Edit|MultiEdit|NotebookEdit|Bash","hooks":[{"type":"command","command":"\"<node>\" \"<hook>\"","timeout":5}]}`.

What arrives on stdin:
- `{session_id, transcript_path, cwd, prompt_id, permission_mode, effort, hook_event_name:"PreToolUse", tool_name, tool_input, tool_use_id}`.
- Write carries `tool_input.file_path`, an absolute path, plus `content`.
- Bash carries `tool_input.command` plus `description`.
- `cwd` is the session directory.

What denies:
- Print `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<text>"}}`
  on stdout and exit 0.
- This blocked a Write and a Bash redirect **even under `bypassPermissions`**.
- The model received `PreToolUse:Write hook error: <text>`, and the result's `permission_denials` listed both calls.

What allows:
- Exit 0 with empty stdout. An unmatched Write went through normally.
- So "no decision" is simply empty stdout. Never print `allow` (C4/C6).

Not probed:
- Workflow subagents. Settings hooks are session-wide, so the same entry applies to them; t11
  records a recheck.
- Edit, MultiEdit and NotebookEdit input. Their keys are per the docs: Edit and MultiEdit use
  `file_path` (MultiEdit adds `edits[]`), NotebookEdit uses `notebook_path`.

### F2 — Cursor `cursor-agent` 2026.10.01, from the installed bundle

Source: read-only greps of `/opt/homebrew/Caskroom/cursor-cli/2026.10.01-e373342/dist-package/*.js`
on the host. It could not be run live because the macOS keychain was locked.

Native `hooks.json` events:
- It has a `preToolUse` step. Input is `{conversation_id, generation_id, model, tool_name, tool_input, tool_use_id, cwd, …}`.
- Deny output is `{"permission":"deny","user_message":"…","agent_message":"…"}`. `deny` rejects
  the call. `ask` also exists; never use it.
- An entry's `matcher` is a regex tested against `tool_name`. The supported entry keys are
  `command`, `matcher`, `timeout` and `failClosed`; the default `failClosed:false` means fail open.

Cursor tool names and their `tool_input`:
- `Write`: `{file_path, content}`. Cursor's edits are Write too: the Claude-import map has `Edit→Write`.
- `Delete`: `{file_path}`.
- `Shell`: `{command, cwd}`.

`beforeShellExecution` (`{command, cwd}` → `permission:"deny"`) also blocks, but `preToolUse`
covers Shell, Write and Delete in one entry, so this plan uses `preToolUse` only.

Claude-hooks import, used when Claude Code is present:
- Cursor maps `PreToolUse→preToolUse`, and maps matcher tool names `Bash→Shell`, `Edit→Write`
  and `Write→Write`.
- It TRANSLATES Claude's `hookSpecificOutput.permissionDecision` into `permission`, and
  `permissionDecisionReason` into `user_message`.
- So Claude's settings entry also blocks on Cursor through the import. This is static evidence,
  so `ac mods status` words it as "via Claude Code import".

### F3 — the code fixed points

- `claude.registerHooks` writes no matcher entries. Ownership there is matched by script filename.
- The `lib/fleet.mjs` `registerFleetHooks`/`stripOurs` pair is the house precedent for a matcher
  entry plus "strip ours, keep a user hook tucked into our entry".
- `cursor.mjs` `removeOurs`/`alreadyOurs` match by full path. That is the folded-in debt
  `2026-10-07-cursor-hook-ownership-matched-by-full`.
- `installClaude` copies every `hooks/*.mjs` into `~/.astro/code/hooks` with `copyDir`, so a new
  hook script ships with no list edit.
- The phase-36 tests that pin `built:false` for canon-guard:
  - `tests/mods.test.mjs:88`, "none built yet".
  - `tests/mods_cli.test.mjs:104`, `/not built yet/` on `enable canon-guard`.
- Real verb names, from `ac help`:
  - `ac phase …`, `ac milestone …`
  - `ac roadmap render`
  - `ac debt …`, `ac backlog …`, `ac fix …`
  - `ac canon [pull …]`
  - `ac principles …`
  - `ac mods enable|disable <feature>`
- No command, agent or workflow tells the model to Write or Edit a protected file. A grep found
  none, so enabling the guard wedges no loop step.

## Decisions this plan pins

### P1 — the protected set and how a path is judged

All of this lives in `hooks/astro-canon-guard.mjs`, the one source.

**`PROTECTED`** is an exported frozen array. Each entry is `{ name, verb, rule, source }`:

| name | verb | rule / source |
|---|---|---|
| `roadmap.json` | `ac phase …` / `ac milestone …` | AGENTS.md "Never hand-edit `.astrocode/roadmap.json`, `state.json`, or the registry"; ADR-004 |
| `state.json` | `ac phase …` / `ac milestone …` | same |
| `debt.json` | `ac debt …` | ADR-004 (CLI-owned state); ADR-045 |
| `backlog.json` | `ac backlog …` | ADR-004; ADR-056 |
| `fixes.json` | `ac fix …` | ADR-004 |
| `ROADMAP.md` | `ac roadmap render` | AGENTS.md "`ROADMAP.md` is generated"; ADR-004 |
| `DECISIONS.in-force.md` | `ac canon pull` | ADR-004 (generated from DECISIONS.md by `ac`) |

There is also one store entry: `{ store: true, verb: 'ac principles add|accept|amend …', rule: 'the
personal principle store is written only through ac principles', source: 'ADR-057, ADR-058' }`.

**`judgePath(p, cwd, env)`** returns the matching entry or `null`. Pure apart from fs stat/realpath calls.

1. Resolve the path:
   - `abs = path.resolve(cwd, p)`. A `~/` prefix is expanded with `env.HOME`.
   - `real = realpathDeep(abs)`: realpath the deepest EXISTING ancestor, then re-join the
     non-existent tail.
   - This covers a symlinked dir, a symlinked file, `..`, `./`, macOS `/var`↔`/private/var`, and
     a not-yet-existing target such as a Write creating `fixes.json`.
2. Project file: protected iff ALL of these hold.
   - `basename(real)` is a `PROTECTED` name.
   - `dirname(real)` is an existing directory.
   - That directory's basename is exactly `.astrocode`.

   The dir holding that `.astrocode/` is the project root, which is the nearest root and works
   for any repo or worktree. Consequences:
   - `phases/37-x/state.json`, `ROADMAP.md.bak`, `docs/roadmap.json` and `/tmp/x/state.json` are
     allowed (C4).
   - A relative target under a nonexistent `cwd` is allowed (C9).
3. Store: protected iff `path.relative(realpathDeep(storeDir), real)` is non-empty, does not start
   with `..` and is not absolute.
   - `storeDir` is the local one-line mirror of `lib/principles.mjs` `principlesDir`:
     `env.ASTRO_PRINCIPLES_DIR || join(env.HOME || homedir(), '.astro', 'principles')`.
   - It is mirrored locally, not imported from `_astro-ctx.mjs`, to keep the hot path free of
     `child_process` and brand imports. A parity test guards the mirror.
   - `~/.astro/principles-notes.md` and `~/.astro/config.json` are allowed.

### P2 — the hook protocol

**`decide(input, { env, host })`** returns `{ reason, entry, path } | null`.

Tool dispatch:

| tool_name | targets |
|---|---|
| `Write`, `Edit`, `MultiEdit` | `tool_input.file_path` |
| `NotebookEdit` | `tool_input.notebook_path` |
| `Delete` (Cursor) | `tool_input.file_path` |
| `Bash` | `bashTargets(tool_input.command, input.cwd)` |
| `Shell` (Cursor) | `bashTargets(tool_input.command, tool_input.cwd \|\| input.cwd)` |
| anything else | `null` |

- A non-string path or command means `null`.
- The base cwd is `input.cwd || process.cwd()`.
- The first protected hit that fails the conflict pass (P4) returns the deny.

`main()` runs only when the script is the entrypoint:
`import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href`. Tests import the module
without it reading stdin.

`main()` steps:
1. Read all of stdin with `readFileSync(0)`.
2. `JSON.parse`, then call `decide`.
3. On a deny:
   - Claude shape by default (F1).
   - Cursor shape `{permission:'deny', user_message, agent_message}` (F2) when `process.argv[2] === 'cursor'`
     or `input.hook_event_name === 'preToolUse'`.
4. Exit 0.

Fail-open discipline:
- The WHOLE of `main` sits in try/catch, and every failure path exits 0 with empty stdout and
  empty stderr.
- That covers empty stdin, bad JSON, `{}`, missing `tool_input`, a non-string field, an unknown
  tool, a realpath or permission error, and a bad cwd (C9).
- Never print a stack.

The script never reads `~/.astro/config.json` or any switch (ADR-072, C3).

Imports are `node:fs`, `node:path`, `node:os`, `node:url` and `node:child_process`. The last is
only used for `spawnSync` in the conflict pass (C10).

### P3 — Bash detection: catching mistakes, not a sandbox (ADR-071)

The header comment says this in so many words. It also says that `python -c`/`node -e` writes,
globs and variables are out of scope.

**`bashTargets(command, cwd, env)`** returns the absolute paths a command would WRITE.

Tokenizing:
- A small shell-aware tokenizer handles single and double quotes and backslash escapes.
- Heredoc bodies (`<<EOF … EOF`, `<<-`, quoted delimiters) are stripped before scanning.
- Segments split on `&&`, `||`, `;`, `|`, `&` and newline, outside quotes only.
- Leading `VAR=x` assignments and `sudo`, `command`, `env`, `time` and `nohup` prefixes are stripped.
- `bash -c`, `sh -c` and `zsh -c` with a string argument are scanned recursively.
- A segment that is exactly `cd <literal>` updates the cwd for later segments.

Never refused:
- A segment whose command word is `ac` or `astrocode` is skipped entirely. This is D2: the
  sanctioned writer. It is per SEGMENT, so `ac status && echo x > …` still checks its second segment.
- A `git` segment is skipped entirely (D2; that is phase 38's ground).

Writes detected in every other segment:
- Redirects:
  - `>`, `>>`, `>|`, `&>`, `&>>`, `N>` and `N>>`, with or without a space before the target (`>file`).
  - `>&N`, `N>&M` and a `/dev/*` target are not writes.
- `sed` and `perl` with an in-place flag write their file arguments. The flag forms are `-i`,
  `-i.bak`, `-i''`, `--in-place[=…]` and combined clusters such as `-pi` and `-pie`. Script and
  expression arguments (`-e X`, `-f F` and the first non-flag sed script) are not targets.
- `tee` writes every non-flag argument, `-a` included.
- `cp` and `mv` write the last non-flag argument, or `-t DIR`/`--target-directory=DIR`. A
  directory destination is joined with each source's basename. `mv` also writes (removes) its sources.
- `rm`, `unlink` and `truncate` write every non-flag argument. `truncate -s N` skips the size.
- `dd` writes the `of=PATH` operand.

Path handling:
- `~` and `$HOME`/`${HOME}` are expanded from `env.HOME`.
- Any OTHER `$`, backtick, `*`, `?` or `[` in a target leaves that target unresolved, and it is
  ignored (fail open, stated in a comment).
- Plain reads are never refused because they write nothing: `cat`, `head`, `grep`, `jq`, `sed -n`
  and `ls`, and `cp` with the protected file as the source.

### P4 — the conflict pass (D4a)

**`inConflict(file)`** is called ONLY for a protected hit, so C10 sees no spawn otherwise.

1. If the file does not exist, return false.
2. Read up to the first 1 MiB. If `/^<<<<<<< /m` matches, return true. This needs a marker at the
   START of a line; a mid-line `<<<<<<<` inside a JSON string does not count (C8e).
3. Otherwise run `spawnSync('git', ['status', '--porcelain', '--', basename(file)], { cwd: dirname(file), encoding: 'utf8', timeout: 2000 })`.
   Return true iff a line's XY is one of `DD AU UD UA DU AA UU`.
4. A git failure (not a repo, git missing, or timeout) returns false, so the call is denied: the
   escape fails closed, while internal errors fail open (P2). Say which is which in a comment.

It is per file, so C8c holds. After `git add`, the file is no longer unmerged and has no markers,
so the deny is back (C8d).

### P5 — the deny reason

`denyReason(entry, displayPath)` returns at most 6 lines, with no stack and no env-var escape:

```
canon-guard: <displayPath> is owned by the ac CLI — hand edits are refused.
Rule: <entry.rule> (<entry.source>).
Use instead: <entry.verb>
Escapes: a file mid-merge (conflict markers, or unmerged in `git status`) may be edited by hand;
for anything else run `ac mods disable canon-guard`, edit, then `ac mods enable canon-guard`.
```

`displayPath` is `.astrocode/<name>`, or `~/.astro/principles/<rel>` for the store.

### P6 — the registration spec and its ownership

**`lib/hosts/guards.mjs`** is new and data-only, so `claude.mjs`, `cursor.mjs` and `mods.mjs` all
import it with no cycle. It exports:

- `GUARD_HOOKS`, frozen and keyed by feature name:
  ```js
  'canon-guard': { script: 'astro-canon-guard.mjs',
    claude: { event: 'PreToolUse', matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash', timeout: 10 },
    cursor: { event: 'preToolUse', matcher: 'Write|Delete|Shell', arg: 'cursor', timeout: 10 } }
  ```
  git-guard gains its own entry in phase 38.
- `GUARD_SCRIPTS`, the list of scripts.
- `guardCommand(home, spec, arg?)`, which returns `"<process.execPath>" "<home>/hooks/<script>"[ <arg>]`.
- `ownsCommand(command, script, arg?)`, the ONE ownership rule:
  - Split the command into tokens, honouring double and single quotes.
  - It is ours iff some token's `basename` equals `script`.
  - When `arg` is given, the last token must also equal `arg`.
  - Install location is never compared, so an entry written under another home or path is still ours.
  - It fixes the debt, and the guard and the always-on hooks use the same rule.

**Claude** (`lib/hosts/claude.mjs`, modelled on `registerFleetHooks`/`stripOurs`):

- `registerGuard(dir, home, spec)`:
  1. A missing `dir` → `{ ok:false, skipped:true }`. A Claude config dir is never created here,
     because that would flip Cursor to import (C12).
  2. Unparseable settings, or `hooks` not an object → `{ ok:false, error }`, and the file is untouched.
  3. If exactly one ours-entry already exists under `spec.claude.event` with the current command
     and matcher → `{ ok:true, changed:false }`, with NO write.
  4. Otherwise strip our hooks (by `ownsCommand`) from every event, keep any user hook tucked into
     an entry, drop emptied entries and arrays, and append
     `{ matcher, hooks:[{ type:'command', command, timeout }] }`.
  5. Write `JSON.stringify(data,null,2)+'\n'` through the symlink target.
- `unregisterGuard(dir, home, spec)`:
  - Strip ours from every event, and delete emptied arrays and an emptied `hooks` key.
  - Write only when something was removed.
  - A missing file or dir is a no-op.
  - The result is JSON-equal to the file before `registerGuard` (C1).
- `guardState(dir, home, spec)` returns one of:
  - `'enforced'`: an ours-entry whose matcher covers all five tools, and `<home>/hooks/<script>` exists.
  - `'missing'`
  - `'broken'`: the entry is present but the script is missing.
  - `'unreadable'`
  - `'no-dir'`
- `unregisterHooks` (uninstall) also strips every `GUARD_SCRIPTS` entry, so no entry is left
  pointing into a deleted home.

**Cursor** (`lib/hosts/cursor.mjs`):

- `EVENT_MAP` gains `PreToolUse: 'preToolUse'` (F2). `ASTRO_HOOKS` is UNCHANGED, because the
  guard is conditional.
- `removeOurs` and `registerHooks`' `alreadyOurs` use `ownsCommand` (the debt fix).
  - In `registerHooks`, an ours-entry with a stale command is re-pointed IN PLACE to the current
    command.
  - Extra ours-duplicates are dropped.
  - The result is at most one entry per script and arg (C12), and a re-run stays byte-identical.
- `removeOurs` also strips every `GUARD_SCRIPTS` entry from every event. The import flip and
  uninstall therefore remove the guard too.
- `registerGuard(dir, home, spec)`, with the same three branches as `registerHooks`:
  - **Claude detected:** strip any native guard and return `{ branch:'import' }`.
  - **Unparseable file:** `{ branch:'none', reason }`.
  - **Otherwise, native:**
    - `version ??= 1`.
    - Merge one `{ command: guardCommand(home, spec, 'cursor'), matcher, timeout }` into
      `hooks.preToolUse`, re-pointing in place.
    - `writeIfChanged`.
    - Return `{ branch:'native' }`.
  - It never creates the Cursor dir.
- `unregisterGuard(dir, home, spec)` strips the guard only, and `writeIfChanged`.
- `guardState(dir, home, spec)` returns `'native'`, `'import'`, `'missing'` or `'unreadable'`.

### P7 — the switch is the registration (`lib/mods.mjs`)

**FEATURES:** `canon-guard` becomes `built: true`.

**`syncHookFeatures({ home = homedir(), astroHome = join(home,'.astro','code'), targets = configTargets(), cursorTargets = defaultCursorTargets(), only })`**
- `defaultCursorTargets()` is `cursorHost.detect() ? cursorHost.configTargets() : new Map()`.
- Loop: for every feature with `kind:'hook'`, `built:true` and a `GUARD_HOOKS` spec (or just
  `only`), read `readMods({home}).switches[name]`.
  - On: call `claude.registerGuard` for each Claude target and `cursor.registerGuard` for each Cursor target.
  - Off: call the `unregister*` pair.
- Returns `[{ feature, host:'claude'|'cursor', dir, label, outcome }]`. `outcome` is one of:
  - Claude: `added`, `already`, `removed`, `absent`, `skipped`, `failed` (with `error`).
  - Cursor: `native`, `import`, `none`, `removed`, `absent`.
- It never throws. One dir failing never stops the others.

**`enableMod` / `disableMod`**
- For a built hook: set the switch first (unchanged), then `result.hooks = syncHookFeatures({ …, only: feature })`.
- Still no `claude` spawn.
- An unbuilt hook (git-guard) stays exactly as today.
- `disableMod` gains the same `targets` / `cursorTargets` params.

**`modsStatus`**
- Each built hook feature gains `enforcement: [{ host, dir, label, state }]`, built from
  `claude.guardState` per Claude target and, only when Cursor is detected, a Cursor entry:
  - `native`: `'enforced'`.
  - `import`: `'via-claude-import'` when the Claude `base` target is `'enforced'`, else `'not-enforced'`.
  - `none` / `missing`: `'not-enforced'`.
- `why` for an on, built hook: `''` when any target is enforced; otherwise
  `not registered in any config dir — run ac install`.
- "Enforced" is never derived from the switch alone (C11).

### P8 — install, update and CLI

**`installClaude`** calls `syncHookFeatures({ astroHome: ASTRO_HOME })` after the host loop, and
returns it as `guards`. `ac install` and `ac update` both go through it, which covers C2 a, b and c.

**`bin/ac.mjs`**
- `install` and `update` print one line per `added`/`removed` guard outcome:
  `✓ canon-guard → <dir> [<label>]` / `✓ canon-guard removed → <dir> [<label>]`.
  - A `failed` outcome prints `⚠ canon-guard: <dir> — <error>`.
  - Otherwise silent.
- `mods enable <hook>` prints:
  - `✓ <f> on — saved to ~/.astro/config.json`.
  - `• not built yet …` only while `!built`.
  - One line per Claude dir: `✓ guard → <dir> [<label>]`, or `⚠ … <error>` on a failure, which
    also sets `process.exitCode = 1`. An `already` outcome is silent.
  - Then, if Cursor is detected, exactly one of:
    - `✓ Cursor: native preToolUse → <dir>`
    - `• Cursor: via Claude Code import`
    - `⚠ Cursor: not enforced (<reason>)`
- `mods disable <hook>` prints `✓ <f> off — guard removed from <n> config dir(s)`.
- `mods status`, human form: under each on hook feature, one indented line per enforcement row:
  - `claude <dir> [<label>]: enforced|missing — run ac install|broken — run ac install|unreadable`
  - `cursor <dir>: enforced (native preToolUse)|via Claude Code import|not enforced on Cursor`
- `--json` carries `enforcement`.

### Test strategy (ADR-018, stated)

The plan is test-first throughout.

RED tasks:
- t1, t4, t7 and t9 are RED.
- They reach every new symbol ONLY through `await import(…)` inside async test bodies, or by
  spawning the script or CLI. A missing module or export fails only the new tests.
- t7 and t9 also update the phase-36 assertions that pin canon-guard as unbuilt. Those go RED
  until t8 and t10 land, which is the sanctioned RED pattern (phase 36 t4–t9).

Implementation and test-in-task:
- t3 is test-in-task. Its spec module and a pure-function test land together.
- t2 turns t1 green. t5 and t6 turn t4 green. t8 turns t7 green. t10 turns t9 green.

Isolation:
- Every test runs with a temp `HOME`. `CLAUDE_CONFIG_DIR`, `CURSOR_CONFIG_DIR` and
  `ASTRO_PRINCIPLES_DIR` are unset unless the test sets them, and PATH is pinned.
- Unit calls into `lib/mods.mjs` pass explicit `targets` and `cursorTargets`, so no test ever
  touches the real `~/.claude` or `~/.cursor`.

## Tasks

### t1 — RED: canon-guard hook behaviour tests
- **file:** `tests/canon_guard.test.mjs` (new)
- **depends_on:** —
- Harness:
  - `feed(event, { env, args })` = `spawnSync(process.execPath, [HOOK, ...args], { input: JSON.stringify(event), env, encoding:'utf8' })`.
  - DENIED / ALLOWED predicates exactly as in CRITERIA "Shared harness".
  - Project P: a `mkdtempSync` dir with `git init`, holding the CRITERIA fixture files, committed.
- Pure helpers: `PROTECTED`, `judgePath`, `bashTargets`, `denyReason`, `decide` are reached via
  `await import('../hooks/astro-canon-guard.mjs')`.
- Tables to cover:
  - C3: every protected file × Write, Edit, MultiEdit, NotebookEdit × every listed spelling.
    Symlinked dir; symlinked file; deleted-then-created `fixes.json`; `ASTRO_PRINCIPLES_DIR`
    override; a `mods.canon-guard:false` config present.
  - C4: the allowed list.
  - C5: the deny Bash list.
  - C6: the allow Bash list.
  - C8 (a)–(e): marker file; a real `git merge` conflict with `UU` and markers stripped
    unstaged; per-file; after commit; mid-line marker.
  - C9: the malformed list. No stdout decision, and no `    at ` in stdout or stderr.
  - C10: `$S/bin` stubs `git`, `ac` and `jq` that log, with `PATH=$S/bin:/usr/bin:/bin`.
    - Every C4 and C6 event leaves the log empty.
    - 20 back-to-back unprotected Writes finish in under 20 s.
- C7 reason checks, per protected file:
  - It names the source (`AGENTS.md`/`ADR-004`, or `ADR-057`/`ADR-058` for the store).
  - It names that file's verb.
  - It names both escapes (`conflict`/merge wording and `ac mods disable canon-guard`).
  - It is ≤ 8 lines.
  - It has no `ASTRO_` and no env-var escape wording.
  - Every verb's words appear together on one `ac help` line beginning `ac <first word>`. This
    treats `enable|disable` and `[pull …]` as covering the word.
- Cursor shape:
  - With the arg `cursor`, a `{hook_event_name:'preToolUse', tool_name:'Write'|'Delete'|'Shell', tool_input:{file_path|command, cwd}}`
    payload aimed at `$P/.astrocode/state.json` returns stdout `permission:"deny"` with a
    non-empty `user_message`.
  - An unprotected one returns empty stdout.
- Parity: `principlesStoreDir`-style resolution in the hook equals `lib/principles.mjs`
  `principlesDir` for two env shapes, and importing the hook module does not block on stdin.

### t2 — The hook script `hooks/astro-canon-guard.mjs`
- **file:** `hooks/astro-canon-guard.mjs` (new)
- **depends_on:** t1
- Implement P1–P5. The house header comment covers:
  - why it is a settings hook and never reads the switch (ADR-071, ADR-072);
  - catching mistakes, not a sandbox;
  - fail-open versus the fail-closed conflict escape;
  - why the store path is mirrored locally;
  - why the parent-dir rule is used instead of a walk-up.
- Shebang `#!/usr/bin/env node`. No imports from `lib/` or `_astro-ctx.mjs`.
- Done when `node --test tests/canon_guard.test.mjs` is green.

### t3 — Guard registration spec + the one ownership rule
- **file:** `lib/hosts/guards.mjs` (new), `tests/guards_spec.test.mjs` (new)
- **depends_on:** —
- Implement P6's `GUARD_HOOKS`, `GUARD_SCRIPTS`, `guardCommand` and `ownsCommand`. The header
  states why this is a separate data module (no cycle between `mods.mjs` and the hosts) and why
  ownership is by script filename (phase 35 D2, and the debt).
- Test-in-task, with a static import, because the module and its test land together. `ownsCommand`
  must be:
  - true for quoted, unquoted and different-home commands;
  - false for a user command naming the script inside another word (`my-astro-canon-guard.mjs.bak`);
  - true with the arg match for `astro-principles.mjs 2/3`, and false for `… 3/3` against arg `2/3`.
- `guardCommand` quotes both paths.

### t4 — RED: host guard registration + Cursor ownership + drift guard tests
- **file:** `tests/guard_hooks.test.mjs` (new), `tests/cursor_hooks.test.mjs`
- **depends_on:** —
- Use the `withEnv` pattern (HOME, CLAUDE_CONFIG_DIR, CURSOR_CONFIG_DIR, PATH pinned) and reach
  every new symbol via `await import`.
- Claude (`tests/guard_hooks.test.mjs`):
  - `registerGuard` on a settings file holding a user `PreToolUse` `{matcher:'Bash', hooks:[echo user-hook]}`
    and an unrelated key:
    - adds exactly one entry with the five-tool matcher and a `timeout`;
    - a second call writes nothing (mtime and bytes unchanged);
    - a stale-path guard entry is re-pointed, not duplicated;
    - `unregisterGuard` restores a JSON-equal file.
  - A missing dir is skipped and NOT created.
  - Unparseable settings: untouched, `ok:false`.
  - `guardState`: `enforced`, `missing`, and `broken` (script absent).
  - `unregisterHooks` strips the guard.
- Cursor native, Claude absent (`tests/guard_hooks.test.mjs`):
  - `registerGuard` writes `hooks.preToolUse` `[{command:…astro-canon-guard.mjs" cursor, matcher:'Write|Delete|Shell', timeout}]`
    with `version:1`, and keeps a user hook.
  - It is idempotent and byte-identical.
  - `unregisterGuard` removes only it.
  - With `$HOME/.claude` created: `{branch:'import'}` and the native guard is stripped.
- Debt, Cursor ownership (`tests/guard_hooks.test.mjs`):
  - Seed `hooks.json` with `node /old/place/.astro/code/hooks/astro-update.mjs` under `sessionStart`
    plus `echo mine`.
  - `registerHooks` (native) leaves exactly one astro-update entry, pointing at the current home.
  - Then create `$HOME/.claude`. `registerHooks` (import) removes every astro entry, the
    stale-path one included, and `echo mine` stays.
- Drift (`tests/cursor_hooks.test.mjs`): ADD one test and leave the existing always-on assertion
  UNCHANGED.
  - After `claude.registerHooks` plus `claude.registerGuard(…, GUARD_HOOKS['canon-guard'])`, the
    written event set equals ASTRO_HOOKS events ∪ each guard's `claude.event`.
  - Each guard's `claude.event` maps through `EVENT_MAP` to its declared `cursor.event`.
  - The original four-script filter still yields exactly ASTRO_HOOKS' events.

### t5 — Claude settings guard registration
- **file:** `lib/hosts/claude.mjs`
- **depends_on:** t3, t4
- Implement P6 Claude: `registerGuard`, `unregisterGuard`, `guardState`, and guard stripping in
  `unregisterHooks`. Export them on the default host object as well.
- `registerHooks` is untouched, so the drift baseline is unchanged.
- Done when `node --test tests/guard_hooks.test.mjs tests/cursor_hooks.test.mjs tests/hooks_principles.test.mjs tests/hooks-update.test.mjs`
  passes for the Claude cases.

### t6 — Cursor guard registration + ownership by script filename (folded debt)
- **file:** `lib/hosts/cursor.mjs`
- **depends_on:** t3, t4
- Implement P6 Cursor: the `EVENT_MAP` entry, `ownsCommand` in `removeOurs` and `alreadyOurs`
  with in-place re-point and dedupe, guard stripping in `removeOurs`, and
  `registerGuard`/`unregisterGuard`/`guardState`. Export them on `cursorHost`.
- Update the header comment block above `ASTRO_HOOKS` to cover:
  - the conditional guard list;
  - the F2 event and deny facts;
  - ownership by filename.
- Done when `node --test tests/guard_hooks.test.mjs tests/cursor_hooks.test.mjs tests/install_cursor.test.mjs tests/cursor.test.mjs`
  is green for the Cursor cases.

### t7 — RED: mods registry, fan-out, re-sync and status tests
- **file:** `tests/mods.test.mjs`
- **depends_on:** —
- Update line 88's registry test: canon-guard is `built:true` and the other seven are `built:false`.
- New tests:
  - `enableMod canon-guard` with `targets` = two temp Claude dirs (one holding a user `PreToolUse`
    hook) and `cursorTargets: new Map()`:
    - no `claude` spawn (keep the existing assertion);
    - `result.hooks` has `added` for both;
    - each settings.json holds one guard entry;
    - a second enable gives `already` with no duplicate;
    - `disableMod` gives `removed`, and each file is JSON-equal to its pre-enable copy.
  - `enableMod git-guard` (unbuilt) writes no entry.
  - `syncHookFeatures`:
    - with the switch on, a third dir with no settings.json gets `added`;
    - a hand-deleted entry is restored;
    - with the switch off, a planted entry is removed;
    - a missing dir is `absent` and not created;
    - an unparseable file gives `failed`, untouched, and the other dirs still proceed.
  - `modsStatus` (pass `run` = the fake claude):
    - canon-guard on gives `enforcement` with both dirs `enforced`;
    - delete one entry and that dir is `missing`;
    - with both deleted, `canTakeEffect:false` and `why` matches `run ac install`;
    - off and built, `why` is `off`, not "not built yet".
  - Cursor rows. Set `CURSOR_CONFIG_DIR` to a created temp dir and HOME to a temp dir with no
    `.claude`, restoring both in `finally`:
    - native gives `enforced`;
    - with `$HOME/.claude` created gives `via-claude-import` / `not-enforced` per P7.

### t8 — `lib/mods.mjs`: built flip, switch-is-registration, status enforcement
- **file:** `lib/mods.mjs`
- **depends_on:** t5, t6, t7
- Implement P7. Add to the header:
  - why a hook's switch is its registration (ADR-072);
  - why Claude dirs are never created;
  - why Cursor is reached only when detected.
- Done when `node --test tests/mods.test.mjs tests/hosts.test.mjs` is green.

### t9 — RED: CLI and install/update re-sync tests
- **file:** `tests/mods_cli.test.mjs`, `tests/mods_lifecycle.test.mjs`
- **depends_on:** —
- `mods_cli.test.mjs`:
  - In the C3 test, `enable canon-guard` no longer prints `not built yet`; assert that
    `enable git-guard` still does.
  - Add tests in a box with `$T/.claude` plus a jean-claude profile `work` (`$T/.claude-work`),
    both pre-seeded with a user PreToolUse hook and an unrelated key:
    - `ac mods enable canon-guard` twice gives exactly one entry per profile, with a five-tool
      matcher.
    - Feeding that entry's command via `sh -c` a Write to a temp project's `.astrocode/state.json`
      is DENIED. Seed `$T/.astro/code/hooks` by running `ac install` first.
    - `ac mods status canon-guard` (human and `--json`) shows on and enforced in both.
    - After hand-deleting one entry, that profile reads `missing`.
    - With `CURSOR_CONFIG_DIR` created, a Cursor line appears.
    - `ac mods disable canon-guard` leaves both files JSON-equal to their saved copies.
  - Cursor-only box (no `$T/.claude`, `CURSOR_CONFIG_DIR` created, seeded stale astro-update
    entry plus `echo mine`), C12:
    - `ac install` then `enable canon-guard` gives one preToolUse guard, one astro-update, and
      `echo mine` intact.
    - The guard command fed a Cursor `preToolUse` Write payload gives `permission:"deny"`.
    - `disable` removes only the guard.
    - `mkdir $T/.claude` then `ac install` removes every astro entry, leaving `echo mine`.
    - Both hosts present: after enable, Cursor's hooks.json has no guard and Claude's settings do.
- `mods_lifecycle.test.mjs`, C2:
  - With canon-guard on, add a third profile and run `ac install`: it gets exactly one working entry.
  - Hand-delete one entry, then `ac install`: restored, with no duplicates anywhere.
  - Switch off, plant a copy, then `ac install`: removed.
  - The `ac update` variant reuses the existing bare-remote, clone and stub-npm pattern.
  - `ac uninstall` leaves no guard entry.

### t10 — Wire re-sync into install/update and render hooks in `ac mods`
- **file:** `lib/install.mjs`, `bin/ac.mjs`
- **depends_on:** t2, t8, t9
- Implement P8. Keep the `case 'mods'` rendering thin: the logic stays in `lib/mods.mjs`.
- Done when this is green:
  `node --test tests/mods_cli.test.mjs tests/mods_lifecycle.test.mjs tests/install.test.mjs tests/install_cursor.test.mjs tests/hooks-update.test.mjs tests/agent_tools.test.mjs tests/flags.test.mjs tests/cli.test.mjs`.

### t11 — Document canon-guard, record the probe, close the folded debt, full-suite gate
- **file:** `MANUAL.md`, `ARCHITECTURE.md`, `.astrocode/phases/37-canon-guard-pretooluse-settings-hook/PROBE.md` (new), `.astrocode/debt.json`
- **depends_on:** t2, t10
- `MANUAL.md` "Enforcement mods":
  - canon-guard is built; the protected list; what Bash forms it catches ("a mistake-catcher,
    not a sandbox"); the two escapes.
  - Where it is enforced: every Claude profile; Cursor native `preToolUse` or via the Claude import;
    Codex is prose-only.
  - `ac install`/`update` re-sync.
  - Change "All eight are not built yet" to seven.
- `ARCHITECTURE.md` astro-mods paragraph: one or two sentences on `lib/hosts/guards.mjs` and
  "switch = registration".
- `PROBE.md`: F1 and F2 with their method, plus one live end-to-end recheck.
  - The recheck: `claude -p --settings <scratch file holding the entry ac mods enable writes>` in
    a scratch project, with a Write to `.astrocode/state.json` and an `echo > .astrocode/debt.json`.
  - Record the denial text, and whether a Task subagent's Write is denied too.
  - Skip it with a stated reason if `claude` is unavailable.
- Run `ac debt drop 2026-10-07-cursor-hook-ownership-matched-by-full --reason "fixed in phase 37: Cursor ownership now matches by script filename (lib/hosts/guards.mjs ownsCommand)"`.
  Never hand-edit `debt.json`.
- Gate, C13: `npm test` (or `node --test tests/`) exits 0 with zero failures before committing.

## Wave shape

- Wave 1: t1, t3, t4, t7, t9. These are independent and their files do not overlap.
- Wave 2: t2 (after t1), t5 and t6 (after t3, t4). The files are disjoint.
- Wave 3: t8.
- Wave 4: t10.
- Wave 5: t11.

Same-file check:
- `tests/cursor_hooks.test.mjs`: t4 only.
- `lib/hosts/claude.mjs`: t5 only.
- `lib/hosts/cursor.mjs`: t6 only.
- `lib/mods.mjs`: t8 only.
- `bin/ac.mjs` and `lib/install.mjs`: t10 only.
- No task deletes or renames a symbol. `EVENT_MAP` and `FEATURES` changes are additive, and their
  only pinned-value consumers (phase-36 tests) are rewritten in t7 and t9.
