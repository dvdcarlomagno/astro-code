# Plan — phase 38: git-guard (PreToolUse settings hook refusing unscoped destructive git in the shared tree)

This plan follows:
- `.astrocode/CONVENTIONS.md`: Node ≥22 ESM `.mjs`, zero deps (ADR-001), named exports, `node:test`
  with a real fs and real git, `die`/`json()`/glyphs, and the house comment voice.
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-014: healing is drop-and-rerun, so no role needs the refused commands.
  - ADR-018: RED tests reach new symbols by `await import` or by spawning.
  - ADR-020: every wave boundary is green.
  - ADR-021: CRITERIA.md is the bar.
  - ADR-035 and ADR-038: the rule this guard enforces.
  - ADR-071: guards are PreToolUse settings hooks that are off by default, fail open, and quote the canon.
  - ADR-072: the switch is the registration, and the script never reads it.
- This phase's `CONTEXT.md`, decisions 1–6.

It aims at every criterion in `CRITERIA.md`, C1–C12.

Phase 37's machinery is on `develop` at `c247e1d` and is reused unchanged:
- `lib/hosts/guards.mjs`;
- Claude and Cursor `registerGuard`/`unregisterGuard`/`guardState`;
- `syncHookFeatures` and the install/update re-sync;
- the `enforcement` rows.

So git-guard is a new spec entry, a new script, the `built` flip and a verdict word in status. It
adds no new plumbing.

Principles brief (`--stage plan --by planner`), applied:
- `enforce-critical-agent-behavior-with-a-ce7b`: this phase is that deterministic guardrail.
- `optional-or-auxiliary-capabilities-b940`: fail open, and give a visible reason on refusal.
- `state-each-rule-in-exactly-one-place-9173`: the refused list lives in ONE exported constant. The
  reason cites ADR-035/038 instead of copying prose. A drift test ties it to `NO_BROAD_STASH`.
- `unattended-automation-must-never-stall-5116`: settled by F1. An `ask` refuses without hanging
  when headless.
- `give-every-user-facing-capability-a-2310`: deferred by CONTEXT. t8 files the follow-up in the backlog.

## Facts settled during planning

These were probed live on 2026-10-11. Executors build on them and must not re-derive them. t8 copies
them into `PROBE.md` and adds a recheck against the shipped script.

### F1 — Claude Code 2.1.292: a hook `ask` refuses headless and never hangs

Method:
- Scratch git repo holding a modified `src/a.js` and an untracked `notes.txt`.
- A probe hook that prints
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"…"}}`
  for any command containing `git stash`.
- It was registered through `--settings` with `{"matcher":"Bash", …, "timeout":10}`.

Runs:
1. `claude -p --permission-mode bypassPermissions`, asking for `git stash -u .`:
   - REFUSED. The call is listed in `permission_denials`.
   - The model relayed the reason verbatim.
   - Exit 0 after 8 s, with no hang.
   - `git stash list` stayed empty and `notes.txt` survived.
2. `claude -p --permission-mode default --allowedTools "Bash(git stash:*)"`, with a direct
   `git stash -u` and a Task (general-purpose) subagent running `cd . && git stash`:
   - Both were REFUSED, and both appear in `permission_denials`. The subagent's stdin carried an
     `agent_id`, so settings hooks reach subagents.
   - Exit 0 after 17 s, with no hang.
   - Stash empty.
   - So a hook `ask` beats an explicit allow rule too.

Verdict: **`ask` ships on Claude**. It is never auto-approved under `bypassPermissions` headless,
and a non-interactive agent treats it as a refusal. The deny fallback in CONTEXT decision 3 is not
triggered.

Not probed: the interactive approval prompt, because it needs a TTY. ACCEPTANCE item 3 checks it by
hand.

### F2 — under lean-ctx the guard receives the ORIGINAL command

The user's profile registers `lean-ctx hook rewrite` on PreToolUse `Bash|bash`, ahead of any astro
entry. During both F1 runs:
- the probe hook's stdin held `tool_input.command` = `"git stash -u ."` / `"cd . && git stash"`,
  the original command;
- the executed and denied input was the rewritten
  `"/usr/local/bin/lean-ctx -c 'git stash -u .'"`.

Matching hooks run on the original `tool_input`, so a sibling's `updatedInput` never reaches the
guard. lean-ctx's own `permissionDecision:"allow"` did not override our `ask`.

The rewrite form, from `lean-ctx 3.11.2 hook rewrite`:
- `<abs path>/lean-ctx -c '<cmd>'`, with the command in POSIX single quotes.
- Embedded single quotes are escaped `'\''`. For example
  `git commit -m 'it'\''s' && git stash` becomes
  `/usr/local/bin/lean-ctx -c 'git commit -m '\''it'\''\'\'''\''s'\'' && git stash'`.

The guard therefore unwraps `lean-ctx -c <str>` (matched by basename, so any install path works) as
defence in depth, for an agent that types the wrapper itself. This is CONTEXT decision 4's "handle both".

Known gap: lean-ctx's MCP `ctx_shell` is not the Bash tool, so the `Bash` matcher never sees it. t8
documents this gap; this phase does not fix it.

### F3 — Cursor `cursor-agent` 2026.10.01 cannot ASK from `preToolUse`; git-guard DENIES there

Source: read-only greps of `/opt/homebrew/Caskroom/cursor-cli/2026.10.01-e373342/dist-package/190.index.js`
on the host. It was not run live (keychain locked, as in phase 37 F2).

- The `preToolUse` output validator accepts `permission` ∈ `allow|deny|ask`.
- Merging across hooks is `deny` > `ask` > `allow`. The telemetry marks ask as "blocked".
- BUT the tool-execution path only acts on `"deny"===a?.permission`, and then rejects the call.
  `ask` is never checked there, so a `preToolUse` ask lets the Shell call RUN.
- (`beforeShellExecution` does handle `ask`. It is not used, to stay on phase 37's single
  `preToolUse` event.)
- Cursor stamps `hook_event_name:"preToolUse"` on every payload, including Claude-imported hooks
  (phase 37 F2). The script's Cursor detection therefore fires on both the native entry and the
  Claude import, and both get `{permission:"deny", user_message, agent_message}`.

Result: **Claude asks, Cursor denies.** `ac mods status` states the verdict per row (P5, C10, C11).

### F4 — code fixed points (read from `c247e1d`)

`GUARD_SCRIPTS` derives from `GUARD_HOOKS`, so these pick up the new script automatically:
- `claude.stripGuards`;
- Cursor `stripScripts`/`removeOurs`;
- `unregisterHooks`;
- `guardFeatures`.

Also automatic:
- `installClaude` copies every `hooks/*.mjs`, so the script ships with no list edit.
- Claude `registerGuard`/`unregisterGuard` strip only `[spec.script]`, so the two guards coexist and
  each removes only itself.
- `guardState` needs the matcher to cover every `|`-token of `spec.claude.matcher`, and the script
  to exist under `<astroHome>/hooks`.

Phase-36/37 assertions that pin git-guard as unbuilt, rewritten in t4 and t6:
- `tests/mods.test.mjs:88`, the built list `['canon-guard']`;
- `tests/mods.test.mjs:440`, "enableMod git-guard (not built)";
- `tests/mods.test.mjs:478`, `sync({only:'git-guard'})` → `[]`;
- `tests/mods_cli.test.mjs:110-111`, `/not built yet/`;
- `tests/guards_spec.test.mjs:14`, `GUARD_SCRIPTS` deep-equal `[S]`.

`tests/hosts.test.mjs`'s `FEATURE_MOD` regex is unaffected: it only scans command and agent bodies,
and no body names git-guard.

## Decisions this plan pins

### P1 — the refused set: one constant, `REFUSED`, in `hooks/astro-git-guard.mjs`

`REFUSED` is an exported frozen array of `{ id, form, test }`. Each `form` is the human spelling
shown in the reason. Each `test(sub, args)` gets the git subcommand and its argument words, after
global options are removed.

`stash`:
- REFUSED:
  - no args;
  - only flags (`-u`/`--include-untracked`, `-a`/`--all`, `-k`/`--keep-index`, `-q`, `-p`, …);
  - `save …`;
  - `push` whose argument list has no pathspec after `--`;
  - a pathspec after `--` (for bare `stash` or `push`) that is whole-tree.
- ALLOWED:
  - `pop|apply|list|show|drop|branch|clear|create|store`;
  - `push … -- <scoped path>…`;
  - bare `stash -- <scoped path>…`, which git treats as push;
  - `push --pathspec-from-file[=]…`.
- Per CONTEXT, `git stash push src/a.js` WITHOUT `--` is refused. Its reason names the
  `-- <path>` form. `-m`/`--message` consume their value.

`clean`:
- REFUSED, unless `-n`, `--dry-run`, or a short-flag cluster containing `n` (`-nd`, `-fdn`) is
  present.

`reset`:
- REFUSED iff `--hard` appears anywhere in its args.
- `--soft`, `--mixed`, `--keep`, `--merge` and `reset HEAD <path>` are allowed.

`checkout`:
- REFUSED iff a pathspec operand is whole-tree, either after `--` or as a bare operand.
- Covers `checkout .`, `checkout -- .`, and `checkout HEAD -- .`.
- `checkout main`, `checkout -b x` and `checkout -- src/a.js` are allowed.

`restore`:
- REFUSED iff a pathspec operand is whole-tree.
- `-s`/`--source` consume their value, and `--source=X` is one word.
- `restore --staged .` and `--staged --worktree .` are refused. `restore src/a.js` is allowed.

Whole-tree pathspec:
- `.`, `./`, `:/`, `:/.`, `:(top)`, `*`, or any word ending `/.` that resolves to `.`.
- Keep it literal: no glob or path resolution.

Every other git subcommand is ALLOWED. That includes `push --force`, `branch -D` and
`worktree remove --force`, which are out of scope without an ADR (CONTEXT 1).

`cwd` never affects the verdict (CONTEXT 2: everywhere), and the script does no fs access.

### P2 — parsing: catching mistakes, not a sandbox (ADR-071)

`segments(command)` is the script's OWN tokenizer. Why it is copied and adapted from canon-guard's
`tokenize` rather than imported:
- each guard is registered independently;
- canon-guard's tokenizer expands HOME and tracks redirects for paths, which git-guard must not do.

The header comment says this.

It handles:
- single quotes, double quotes and backslash escapes;
- `#` comments at word start;
- heredoc bodies, which are skipped;
- segment split on unquoted `&&`, `||`, `;`, `|`, `&` and newline.

`$(…)` and backticks are not descended into.

Per segment, leading words are stripped in a loop:
- `NAME=value` assignments;
- `command`, `exec`, `nohup`, `time`;
- `env`, with its own `-i`/`-u NAME` flags and assignments;
- `sudo`, with its flags;
- `nice`, with `-n N`.

Then:
- If the command word's basename is `git`:
  - skip global options: `-C <d>`, `-c <k=v>`, `--git-dir[=]`, `--work-tree[=]`, `--namespace[=]`,
    `--config-env[=]`, `--exec-path[=]`, `--no-pager`, `-P`, `-p`, `--paginate`, `--bare`,
    `--no-replace-objects`, `--literal-pathspecs`, `--no-optional-locks`;
  - the next word is the subcommand, judged by P1.
- If the basename is `bash|sh|zsh|dash` with `-c` (or a short cluster containing `c`, such as
  `-lc` or `-ec`) followed by a string, or `lean-ctx` with `-c` followed by a string: recurse into
  that string. The total depth is capped at 3, so lean-ctx wrapping `bash -c` is still seen.
- Anything else is ignored. A git command merely quoted inside `echo`, `grep` or
  `git commit -m "…"` is one word, so it never trips the guard.

Aliases, `eval`, scripts, `xargs`, `$(…)` and `ctx_shell` are out of scope. The header comment says
so in those words.

### P3 — the hook protocol (mirror of canon-guard P2)

`decide(input)` returns `{ reason, hit } | null`. `hit` is `{ id, segment }`.

Tool dispatch:
- `Bash` → `tool_input.command`.
- `Shell` (Cursor) → `tool_input.command`.
- Anything else, or a non-string command → `null`.

Verdict constants: `export const VERDICT = 'ask'` (Claude, F1) and
`export const CURSOR_VERDICT = 'deny'` (F3). A fallback is a one-line change.

`main()`:
- Runs only when the script is the entrypoint: the `isEntry` realpath compare, as in canon-guard.
- Steps:
  1. `readFileSync(0,'utf8')`.
  2. `JSON.parse`.
  3. `decide`.
  4. On a hit, write ONE JSON object to stdout:
     - Cursor, when `process.argv[2]==='cursor' || input.hook_event_name==='preToolUse'`:
       `{permission: CURSOR_VERDICT, user_message, agent_message}`.
     - Otherwise:
       `{hookSpecificOutput:{hookEventName:'PreToolUse', permissionDecision: VERDICT, permissionDecisionReason}}`.
  5. Exit 0.
- The whole body sits in try/catch. On any failure, exit 0 with empty stdout and stderr, and never
  print a stack (C8).
- An allowed call prints NOTHING. The script never emits `allow`.

Imports are `node:fs` (`readFileSync`, `realpathSync`) and `node:url` (`pathToFileURL`) only. It
uses no `child_process`, does no switch or config read, and reads no file but stdin (C3, C9).

### P4 — the reason: at most 6 lines, one wording, ADRs cited and not copied

`reasonFor(hit, verdict)`:

```
git-guard: `<segment, trimmed to 120 chars>` is an unscoped destructive git command (<form>).
Rule: no bare stash, git clean, git reset --hard or whole-tree checkout/restore (ADR-035, ADR-038).
Why: refs/stash is repository-wide even from a worktree; a finished plan was destroyed this way.
Use instead: `git stash push -- <path>…` then `git stash pop`; a broken task is dropped and re-run (ADR-014).
Escape: <ask: "approve this call if you meant it, or"> run `ac mods disable git-guard` (re-enable with `ac mods enable git-guard`).
```

- There is no env-var escape.
- Under `deny`, the first escape clause is omitted.

### P5 — spec and status (`lib/hosts/guards.mjs`, `lib/mods.mjs`, `bin/ac.mjs`)

`GUARD_HOOKS['git-guard']`:

```js
{ script: 'astro-git-guard.mjs',
  claude: { event: 'PreToolUse', matcher: 'Bash', timeout: 10, verdict: 'ask' },
  cursor: { event: 'preToolUse', matcher: 'Shell', arg: 'cursor', timeout: 10, verdict: 'deny' } }
```

`canon-guard` gains `verdict: 'deny'` on both hosts. The field is additive: `registerGuard`'s
idempotency check compares only event, matcher, command and timeout, so existing entries stay
`already`. The spec is the single statement of the verdict per host. A test in t1 pins the
script's `VERDICT`/`CURSOR_VERDICT` to `GUARD_HOOKS['git-guard'].claude.verdict`/`.cursor.verdict`.

`lib/mods.mjs`:
- `git-guard` becomes `built: true`.
- `enforcementOf` adds `verdict` to every row:
  - claude rows get `spec.claude.verdict`;
  - cursor rows get `spec.cursor.verdict`, for both `enforced` (native) and `via-claude-import`,
    because the script answers in Cursor's shape either way (F3);
  - a `not-enforced` row has no verdict.

`bin/ac.mjs` `enforcementLine`:
- Appends the verdict to an enforced row: `enforced (asks)` or `enforced (denies)`, and for
  Cursor `enforced (native preToolUse, denies)` or `via Claude Code import, denies`.
- `--json` already carries the rows.
- The existing `/enforced/` and `/via Claude Code import/` matches still hold.
- No other CLI change: `mods enable` and `disable` and install/update re-sync are already generic.

### Test strategy (ADR-018, stated)

The plan is test-first.

RED tasks are t1, t4 and t6:
- t1 reaches the script only through `await import('../hooks/astro-git-guard.mjs')` inside async
  test bodies, or through `spawnSync(process.execPath, [HOOK, …])`. A missing file fails only the
  new tests.
- t4 and t6 rewrite the phase-36/37 assertions that pin git-guard as unbuilt (F4). They stay RED
  until t5 and t7 land, which is the sanctioned phase 37 t7/t9 pattern.

t3 is test-in-task: the spec entry and its tests land together and are green on landing, because
the machinery already exists.

Turning RED green:
- t2 turns t1 green.
- t5 turns t4 green.
- t7 turns t6 green.

Isolation:
- Temp `HOME`, with `CLAUDE_CONFIG_DIR`/`CURSOR_CONFIG_DIR` unset unless set by the test.
- `PATH` pinned.
- `realpathSync(mkdtempSync(…))`.
- Unit calls into `lib/mods.mjs` pass explicit `targets`/`cursorTargets`.

## Tasks

### t1 — RED: git-guard script behaviour tests
- **file:** `tests/git_guard.test.mjs` (new)
- **depends_on:** —
- Harness, modelled on `tests/canon_guard.test.mjs`:
  - `HOOK = hooks/astro-git-guard.mjs`.
  - `feed(event, {args, env})` = `spawnSync(process.execPath, [HOOK, ...args], {input, env:{HOME:tmp, PATH:'/usr/bin:/bin'}, encoding:'utf8'})`.
  - REFUSED / ALLOWED predicates exactly as in CRITERIA "Shared harness". ALLOWED means stdout is
    empty: no `ask`, no `deny`, no `allow`.
  - Repo R: real `git init`, commit `src/a.js`, untracked `notes.txt`, and
    `git worktree add R/.claude/worktrees/agent-1 -b wt1`.
  - After each table, `git -C R stash list` is empty and `notes.txt` exists.
- Tables:
  - C3: every refused form from CRITERIA, with `cwd` = R and with `cwd` = the worktree.
  - C4: every wrapped, compound and prefixed form, plus:
    - the RECORDED lean-ctx form from F2, `/usr/local/bin/lean-ctx -c 'git stash -u'`;
    - the F2 quote-escaped compound;
    - `lean-ctx -c 'bash -c "git stash -u"'`.
  - C5: every allowed form, plus:
    - `git stash -- src/a.js`;
    - a heredoc whose body says `git stash -u`;
    - `git log --grep=stash`;
    - `git stash push -- .` (REFUSED);
    - `git stash push src/a.js` (REFUSED, P1).
  - C8: the malformed inputs. The first seven are ALLOWED. None prints `    at ` or `Error:`, and
    every exit status is 0.
  - C9: `$S/bin` stubs `git`, `ac`, `jq`, `lean-ctx` that log their name. With
    `PATH=$S/bin:<node dir>:/usr/bin:/bin`, every C3/C4/C5 event leaves the log empty. 20
    `git status` events run in under 20 s.
- C3 switch: with `$HOME/.astro/config.json` = `{"mods":{"git-guard":false}}`, `git stash -u` is
  still REFUSED.
- C6: the reason for `git stash -u`, `git clean -fd`, `git reset --hard`, `git checkout .`:
  - matches `ADR-035|ADR-038`;
  - matches `repository-wide|destroyed`;
  - contains `git stash push -- <path>` and `git stash pop`;
  - contains `ac mods disable git-guard`;
  - is ≤ 8 lines, with no `ASTRO_`.
- C7: every refused case returns the same `permissionDecision`, and it equals `VERDICT`.
- Cursor: with the arg `cursor`, and separately with `hook_event_name:'preToolUse'`, a
  `{tool_name:'Shell', tool_input:{command:'git stash -u', cwd}}` payload gives stdout
  `permission:"deny"` with a non-empty `user_message`. `git status` gives empty stdout.
- Single source (via `await import`):
  - `VERDICT`/`CURSOR_VERDICT` equal `GUARD_HOOKS['git-guard'].claude.verdict`/`.cursor.verdict`.
    This also goes RED until t3 lands.
  - Drift guard: read `workflows/execute-phase.mjs` as text, slice the `NO_BROAD_STASH`
    literal, extract every backticked `git …` spelling, and assert `decide` refuses each.
  - Importing the module does not block on stdin.

### t2 — The hook script `hooks/astro-git-guard.mjs`
- **file:** `hooks/astro-git-guard.mjs` (new)
- **depends_on:** t1
- Implement P1–P4, with shebang `#!/usr/bin/env node`. No imports from `lib/` or from other hooks.
- House header comment, in canon-guard's voice, covering:
  - the rule and its sources (ADR-035/038, `NO_BROAD_STASH`);
  - why it asks on Claude and denies on Cursor (F1, F3);
  - "it never reads the switch" (ADR-072);
  - "catching mistakes, not a sandbox", with the out-of-scope list;
  - why it unwraps lean-ctx even though it sees the original command (F2);
  - why the tokenizer is copied, not imported;
  - fail open.
- Done when `node --test tests/git_guard.test.mjs` is green, except the spec-verdict parity case,
  which needs t3. t3 lands in wave 1, so that case is green at the wave-2 boundary.

### t3 — Guard spec entry, verdict field, and host-level coexistence tests
- **file:** `lib/hosts/guards.mjs`, `tests/guards_spec.test.mjs`, `tests/guard_hooks.test.mjs`
- **depends_on:** —
- `GUARD_HOOKS`: add `'git-guard'` and the `verdict` fields per P5, all frozen. Update the header
  comment: two guards, and what verdict means per host.
- `guards_spec.test.mjs` (static import, test-in-task):
  - `GUARD_SCRIPTS` deep-equals `['astro-canon-guard.mjs','astro-git-guard.mjs']`.
  - The git-guard spec: script, `PreToolUse`/`Bash`, `preToolUse`/`Shell`/arg `cursor`, verdicts
    `ask`/`deny`.
  - canon-guard verdicts are `deny`/`deny`.
  - `ownsCommand` never confuses the two scripts, in either direction.
- `guard_hooks.test.mjs`: `installHome` stubs BOTH scripts. Add:
  - Claude: register both guards into one settings.json holding a user `Bash` hook. There are two
    guard entries, and `guardState` is `enforced` for each. `unregisterGuard(git-guard)` leaves
    canon-guard's entry and the user hook byte-for-byte. Unregistering both is JSON-equal to the
    original.
  - Claude: `guardState(git-guard)` is `missing` when only canon-guard is registered.
  - Cursor native: both guards register, and each unregisters only itself.
- Done when this is green:
  `node --test tests/guards_spec.test.mjs tests/guard_hooks.test.mjs tests/cursor_hooks.test.mjs tests/canon_guard.test.mjs tests/mods.test.mjs tests/mods_cli.test.mjs tests/mods_lifecycle.test.mjs`.
  - `cursor_hooks` iterates `GUARD_HOOKS` generically.
  - git-guard is still `built:false` here, so mods syncing ignores it.
  - The mods suites are as green as their wave-1 RED edits allow: t3 must not ADD failures.

### t4 — RED: mods registry, fan-out, re-sync and status tests
- **file:** `tests/mods.test.mjs`
- **depends_on:** —
- Line 82-88: rename the test to "…canon-guard and git-guard built…". The built list becomes
  `['canon-guard','git-guard']`.
- Lines 178-206 (`setMod` with git-guard) stay as they are: `setMod` ignores `built`.
- Replace the line-440 "not built" test with:
  - `enableMod git-guard`, with two temp Claude dirs (one holding a user PreToolUse hook) and
    `cursorTargets: new Map()`:
    - `result.hooks` is `added` ×2;
    - one `Bash`-matcher entry per dir;
    - a second enable gives `already`;
    - there is no `claude` spawn.
  - Then `enableMod canon-guard`: both entries are present.
  - `disableMod git-guard`: canon-guard's entry is intact.
  - `disableMod canon-guard`: JSON-equal to the pre-enable copies.
- Line 478: `sync({only:'blindfold'})` → `[]`, because it is not a hook. Add `sync({only:'git-guard'})`:
  `added` per dir with the switch on, `removed` with it off.
- `modsStatus`:
  - git-guard on gives `enforcement` rows `enforced` with `verdict:'ask'`;
  - canon-guard rows carry `verdict:'deny'`;
  - a Cursor native row for git-guard carries `verdict:'deny'`;
  - off and built gives `why` `off`, not "not built yet".

### t5 — `lib/mods.mjs`: flip git-guard built, verdict on enforcement rows
- **file:** `lib/mods.mjs`
- **depends_on:** t3, t4
- Set `built: true` on the `git-guard` row. Add `verdict` to `enforcementOf` rows per P5. Update the
  FEATURES comment ("flips to true as phases 37-44 land").
- Done when `node --test tests/mods.test.mjs tests/hosts.test.mjs tests/mods_plugin.test.mjs` is green.

### t6 — RED: CLI and install/update re-sync tests for git-guard
- **file:** `tests/mods_cli.test.mjs`, `tests/mods_lifecycle.test.mjs`
- **depends_on:** —
- `mods_cli.test.mjs`:
  - Line 110-111: `enable git-guard` no longer prints `not built yet`. Assert
    `ac mods status blindfold` still says it, which proves the unbuilt path stays covered.
  - Lines 121 and 213 stay as they are.
  - New tests, in the two-profile box (each profile pre-seeded with `echo user-hook` and an
    unrelated key; `ac install` first so the hooks dir is seeded). C1:
    - `enable git-guard` twice gives exactly one `Bash`-matcher git-guard entry per profile.
    - Fed `git stash -u` via `sh -c`, that entry gives stdout `permissionDecision:"ask"`.
    - Fed `git stash push -- src/a.js`, it gives empty stdout.
    - `enable canon-guard` adds its entry.
    - The canon-guard entry gives no decision on `git stash -u`, and the git-guard entry gives no
      decision on `echo x > .astrocode/state.json`.
    - `disable git-guard` leaves canon-guard working.
    - `disable canon-guard` leaves both files JSON-equal to the saved copies.
  - C10:
    - `status git-guard` (human and `--json`) shows it available and off before enable, with no
      "not built yet".
    - After enable it shows on and enforced in both profiles, and the human line says `asks`.
    - After hand-deleting one entry, that profile reads `missing`.
    - With `CURSOR_CONFIG_DIR` created, a Cursor row states its position, and if enforced says `denies`.
  - C11, Cursor-only box (no `$T/.claude`, `CURSOR_CONFIG_DIR` created, `echo mine` seeded):
    - `install` + `enable git-guard` twice gives one `preToolUse` `Shell` git-guard entry, with
      `echo mine` intact.
    - Fed a Cursor `preToolUse` Shell payload for `git stash -u`, the entry gives
      `permission:"deny"`.
    - `status` says `denies`.
    - `disable` removes only that entry.
  - C11, both hosts present: after enable, Cursor's hooks.json has no native git-guard entry, and
    Claude's settings.json has one.
- `mods_lifecycle.test.mjs`, C2. Add git-guard cases beside the canon-guard ones, sharing the
  existing box helpers:
  - a profile added later gets exactly one working entry on `ac install`;
  - a hand-deleted entry is restored, with no duplicates;
  - with the switch off, a planted entry is removed;
  - the `ac update` variant;
  - `ac uninstall` leaves no git-guard entry.

### t7 — `bin/ac.mjs`: verdict word in `ac mods status`
- **file:** `bin/ac.mjs`
- **depends_on:** t2, t5, t6
- Implement P5's `enforcementLine` change, and nothing else in the CLI.
- Done when this is green:
  `node --test tests/mods_cli.test.mjs tests/mods_lifecycle.test.mjs tests/install.test.mjs tests/install_cursor.test.mjs tests/cli.test.mjs tests/flags.test.mjs`.

### t8 — Document git-guard, record the probe, file the follow-up, full-suite gate
- **file:** `MANUAL.md`, `ARCHITECTURE.md`, `.astrocode/phases/38-git-guard-pretooluse-settings-hook/PROBE.md` (new), `.astrocode/backlog.json` (via `ac backlog add` only)
- **depends_on:** t7
- `MANUAL.md` "Enforcement mods":
  - In the table row, `git-guard` is "phase 38 (built)".
  - Change "the other seven are not built yet" to "the other six".
  - Add a **git-guard** section after canon-guard's, with the same bullets:
    - Refused (P1).
    - Allowed (P1).
    - Parsing ("a mistake-catcher, not a sandbox": compound commands, prefixes, `git -C/-c`,
      `sh -c` and the lean-ctx wrapper are seen; aliases, `eval`, scripts, `$(…)` and lean-ctx's
      `ctx_shell` are not).
    - Verdict: Claude Code asks, and a headless or Workflow agent treats that as a refusal; Cursor
      denies, because it cannot ask from `preToolUse`.
    - Escapes: approve the prompt, or `ac mods disable git-guard`.
    - Where it is enforced.
    - Re-sync.
    - `ac`'s and the workflow's own git calls are never seen. That is why `NO_BROAD_STASH` stays
      in the prompts.
- `ARCHITECTURE.md`: one sentence beside the canon-guard paragraph saying that git-guard is a
  second `GUARD_HOOKS` entry, and that the spec carries the per-host verdict.
- `PROBE.md`: F1–F3 with their method, plus one live recheck against the SHIPPED script.
  - Setup: scratch HOME, `ac install`, `ac mods enable git-guard`. Copy that entry alone into a
    `--settings` file.
  - Run `claude -p --settings <file> --permission-mode bypassPermissions` in a scratch repo, asking
    for `git stash -u`, `git reset --hard`, and a Task subagent's `git clean -fd`.
  - Record the denials, the relayed reason, exit time and the untouched tree.
  - Skip it with a stated reason if `claude` is unavailable.
- Run
  `ac backlog add "/astro-mods slash command over ac mods (status/enable/disable)" --note "phase 38 CONTEXT out-of-scope: principle give-every-user-facing-capability-a-2310"`.
  Never hand-edit `backlog.json`.
- Gate, C12: `npm test` (or `node --test tests/`) exits 0 with zero failures before committing.

## Wave shape

- Wave 1: t1, t3, t4 and t6. They are independent and their files are disjoint.
- Wave 2: t2 (after t1) and t5 (after t3, t4). Their files are disjoint.
- Wave 3: t7.
- Wave 4: t8.

Same-file check:
- `tests/mods.test.mjs`: t4 only.
- `tests/mods_cli.test.mjs` and `tests/mods_lifecycle.test.mjs`: t6 only.
- `lib/hosts/guards.mjs`, `tests/guards_spec.test.mjs` and `tests/guard_hooks.test.mjs`: t3 only.
- `lib/mods.mjs`: t5 only.
- `bin/ac.mjs`: t7 only.
- Docs: t8 only.

Destructive edits: no task deletes or renames a symbol.
- The `verdict` fields, the new spec key, the `built` flip and the row field are all additive.
- Their only pinned-value consumers (F4) are rewritten in t3, t4 and t6.
- Every wave boundary loads and compiles. The only failing tests are the declared RED ones, and
  wave 3 closes them.
