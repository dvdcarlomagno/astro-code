# Plan — phase 39: blindfold mod (plan-blind verifier and criteria-author enforced per agent)

This plan follows:
- `.astrocode/CONVENTIONS.md`: Node ≥22 ESM, zero deps (ADR-001), named exports, `node:test`, real fs,
  `⚠`/`•`/`✓` glyphs, and the house comment voice. Plugin files are `.js` with single quotes and no
  semicolons (ADR-071 file-type exception, as in `mods/astro-mods/hooks/`).
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-018: RED tests reach new symbols by `await import`.
  - ADR-020: every wave boundary is green.
  - ADR-021: the rule being enforced. CRITERIA.md is the bar.
  - ADR-041: a task that does not land a stamped commit stops its dependents.
  - ADR-071: off by default, quotes the canon, keeps no state of its own, fails open, no command or
    agent depends on it.
- This phase's `CONTEXT.md`, decisions 1–5 and both folded-in debt items.

It aims at every criterion in `CRITERIA.md`, C1–C12, under whichever branch C1's evidence selects.

**Baseline.** Phase 38 is complete on `develop`, so git-guard is built and phase 38 t6's assertion
(`ac mods status blindfold` says "not built yet") exists in `tests/mods_cli.test.mjs`. Never edit
`.claude/worktrees/`, which is a stale copy.

Principles brief (`--stage plan --by planner`), applied:
- `enforce-critical-agent-behavior-with-a-ce7b`: this phase is that guardrail. The agent prose stays
  as the doctrine it quotes.
- `optional-or-auxiliary-capabilities-b940`: fail open and say so once (P6). The debt fixes replace
  a raw error with a fix line.
- `state-each-rule-in-exactly-one-place-9173`: `FORBIDDEN` is the only table of forbidden files.
  `RULE` quotes the agent files, and a drift test ties it to them.
- `keep-tooling-deterministic-and-leave-333f`: there is no inferred identification. A missing join
  stops the build (P1).

## Facts settled during planning

These were observed live on 2026-10-11 in a throwaway `HOME`. Executors build on them; t1 copies
them into PROBE.md.

### F1 — what creates `~/.claude` is `claude plugin …`, not `claude --version`

- `HOME=<tmp> claude --version` printed `2.1.292 (Claude Code)` and left `HOME` empty.
- `HOME=<tmp> claude plugin marketplace list --json` printed `[]` and created both `~/.claude/` and
  `~/.claude.json`.
- `HOME=<tmp> ac mods status` created both too, through `pluginState`'s
  `claude plugin marketplace list`, which runs once the version meets the floor.
- So `claudeVersion` stays as it is. The fix is that no `claude plugin` command ever runs against a
  config dir that does not exist (P7).

### F2 — `ac install` on a fresh `HOME` with `claude` on PATH wires Claude and creates `~/.claude`

With no host detected, it falls back to Claude. So after `ac install`, a plain `ac mods enable` finds
the dir. C9's "afterwards" step therefore takes the normal install path.

### F3 — the bundled 2.1.292 typings name a join, and t1 must observe it

Source: `scripts/mods-probe/.claude-plugin/types/claude-code/index.d.ts`.

- `AgentSpawnResult.agentId` is "the same string its loop's `tool.call` events carry as `agentId`".
  `agent.spawn`'s `workflow` field says "`next` settles with the first attempt's `agentId`".
  This is source **S2**: an `agent.spawn` hook awaits `next(e)` and pairs `r.agentId` with
  `e.subagentType`.
- `$.agent.list()` returns `AgentInfo { id, type, … }`, but "a workflow's are not" listed, and a
  workflow agent's id is one "no list names". This is source **S1**: stateless, but per the typings
  it misses Workflow-spawned agents.
- `tool.check`'s result is `{ decision: 'allow'|'ask'|'deny', reason? }`, and on a deny the model
  reads `reason`.
- The hook budget is 10 000 ms, and a `.catch` replays `next`.
- `$.session.cwd()` and `$.fs.exists(path)` exist.
- The tools typings list no `Grep`/`Glob`/`NotebookRead` input types (only `NotebookEdit`).

The typings are documentation, not observation. C1 accepts only what t1 observes.

## Decisions this plan pins

### P1 — two outcomes, one gate

t1 ends PROBE.md with exactly one machine-read line, either:
- `Verdict: join found — source: S1` or `… source: S2` (or `S1+S2`), naming the observed fields; or
- `Verdict: no join`.

A source counts only if, on BOTH spawn paths (Workflow-spawned and Agent-tool-spawned
`astro-verifier`), the SAME agent's id from that source equals the `agentId` on its own later
`tool.check`, and its type equals the agentType string the spawner passed. That covers S1 on its
very first tool call, or S2's `r.agentId`.

Preference (CONTEXT 1):
- Use S1 if it covers both paths.
- Otherwise use S2: an in-memory `Map`, never persisted, cleared by `register()`.
- Otherwise, no join.

**Gate.** t4 opens by reading that line. On `no join`, t4 stops **BLOCKED and uncommitted**, with the
reason `PROBE.md verdict: no join (CONTEXT decision 1)`.
- The executors skip every task whose `depends_on` reaches it (t5, t6, t7).
- The stamp audit then fails the phase to the human (ADR-041). This is CONTEXT 1's "stop, report,
  the user decides".
- Nothing approximate ships, and `blindfold` stays `built: false`.
- t2 and t3 (the debt) do not depend on t1, so they land in both branches.

### P2 — the module: `mods/astro-mods/hooks/features/blindfold.js`

Exports:
- `FORBIDDEN`, frozen: `{ 'astro-verifier': ['plan.md','spec.md'], 'astro-criteria-author': ['plan.md','acceptance.md','spec.md'] }`.
  This is the one table.
- `RULE`, frozen: `{ 'astro-verifier': 'Do NOT read \`PLAN.md\`. Do NOT read \`SPEC.md\`.', 'astro-criteria-author': 'Do NOT read \`PLAN.md\`, \`ACCEPTANCE.md\`, or \`SPEC.md\`' }`.
  Each value is the verbatim substring of `agents/astro-verifier.md:17` /
  `agents/astro-criteria-author.md:23`, and a drift test pins it.
- `LOOKUP_TIMEOUT_MS = 2000`, under the 10 s hook budget.
- Named hook functions:
  - `toolCheck`;
  - with S2, `agentSpawn`;
  - `resetBlindfold()`, which clears the S2 map. `register()` calls it beside `resetSwitches()`.

Every hook function opens with `if (!isOn('blindfold')) return next(e)`.

The `$.agent.list()`, `$.session.cwd()` and `$.fs.exists()` calls are spelled inside functions
declared in `blindfold.js` itself. A helper never receives `$` (phase 36 validator finding).

`register.js` gains one line per hook, in the literal form:
- `on('tool.check', toolCheck).catch(failOpen)`;
- with S2, `on('agent.spawn', agentSpawn).catch(failOpen)`.

There is no matcher argument, so the tool filter lives inside `toolCheck`.

### P3 — `toolCheck` order (cheap first)

1. If the switch is off, return `next(e)`. The join source is never consulted (C7).
2. No `e.agentId` (the main loop): return `next(e)`.
3. Judge the call against the UNION role (all three names). A null result returns `next(e)` with no
   lookup, so most calls cost nothing.
4. Look up the role:
   - S1: `$.agent.list()` raced against `LOOKUP_TIMEOUT_MS`, then the entry whose `id === e.agentId`
     gives its `type`.
   - S2: `map.get(e.agentId)`.
5. If there is no entry, or the type is not a `FORBIDDEN` key, return `next(e)` silently. That covers
   executors, planners, researchers, `workflow-subagent` and non-astro types (C6).
6. Re-judge with the real role. A hit returns `{ decision: 'deny', reason }` without calling `next`.
   No hit returns `next(e)`.

The plugin never answers its own `allow`. ALLOWED means the value `next(e)` resolved to.

S2's `agentSpawn`:
- If the switch is off, return `next(e)`.
- Otherwise run `const r = await next(e)`. If `FORBIDDEN[e.subagentType]` and `r && r.agentId` are
  both set, `map.set(r.agentId, e.subagentType)`.
- Return `r` untouched. It is never denied and never rewritten.

### P4 — what a hit is (CONTEXT 2), all string logic, no Node

Normalising:
- `\` becomes `/`;
- runs of `/` collapse;
- `.` and `..` segments are resolved lexically;
- a trailing `/` is dropped;
- comparisons are lowercased (the C3 lesson).

Matching:
- A "phase dir" is any `<…>/.astrocode/phases/<dir>`.
- `globRe(g)` is a tiny glob-to-RegExp that handles `**`, `*`, `?`, `[…]` and `{a,b}`, matches
  case-insensitively, and lets dots match.

Read rule (Read, Edit, any tool's `file_path` / `notebook_path`, and a non-Grep/Glob tool's `path`):
- HIT when the path has a phase-dir ancestor and its basename is, or glob-matches, a forbidden name.
- `<P>/docs/PLAN.md` is not a hit.
- NotebookRead is covered by `notebook_path`/`file_path`, whatever the tool is called.

`reaches(root)` asks whether a search rooted at `root` could walk into a phase dir. It is TRUE for:
- empty, `.`, `./`, or `..`-only (the agent's cwd or above);
- a path whose last segment is `.astrocode`, or which equals `.astrocode/phases`, a phase dir, or a
  subdir inside one (a basename with no extension);
- an absolute path equal to, or an ancestor of, `await $.session.cwd()`;
- an absolute path where `await $.fs.exists(root + '/.astrocode/phases')`.

A relative root is resolved against the session cwd first.

Both `$` helpers are wrapped in their own try/catch. A failure there reads as "unknown, no
widening" and never reaches `failOpen`, because only the JOIN lookup is fail-open-with-notice.

`<P>/.astrocode/phases/39-x/CRITERIA.md` is a file (it has an extension), so it is judged by the read
rule and is allowed.

Grep:
- A `path` naming a file falls to the read rule.
- Otherwise it is a HIT when `reaches(path ?? '.')` holds and there is no narrowing.
- Narrowing is either:
  - a `glob` that cannot match a forbidden name (negations such as `!**/.astrocode/**` count as
    excluding); or
  - a `type` other than `md`/`markdown`.

Glob:
- The root is `path ?? '.'`, and the `pattern` is relative to it. An absolute pattern is its own root.
- HIT when `globRe(pattern)` matches a candidate path from the root to a forbidden file in a phase
  dir. The candidates are:
  - `F` when the root is a phase dir;
  - `00-x/F` when the root is `.astrocode/phases`;
  - `phases/00-x/F` when the root is `.astrocode`;
  - `.astrocode/phases/00-x/F` and `y/.astrocode/phases/00-x/F` when `reaches(root)` holds by
    cwd/ancestor/exists.
- So `**/*.md` under the phases dir is a HIT, and `src/**/*.js` is not.

Bash (and any tool's string `command`): this is the script's OWN quote-aware tokenizer. The header
explains why it is not imported from `hooks/astro-canon-guard.mjs`: the plugin ships separately, and
mods are `.js`.
- It handles single and double quotes and backslash escapes.
- It splits segments on unquoted `;`, `&&`, `||`, `|`, `&` and newline.
- It strips leading words: `NAME=v`, `env`, `command`, `exec`, `time`, `nohup` and `sudo`.
- It recurses into `bash|sh|zsh|dash -c <str>` and `lean-ctx -c <str>`, to depth ≤ 3.

Bash checks:
- **Word rule (any command).**
  - A word, or the part after its last `:` or `=` (`HEAD:…/PLAN.md`, `--file=…`), is a HIT under
    the read rule.
  - A bare forbidden basename is a HIT when the same command names a phase dir anywhere, as in
    `cd .astrocode/phases/39-x && cat PLAN.md`.
- **Search rule.**
  - It applies to `grep`/`egrep`/`fgrep` with a recursive flag (`-r`, `-R`, `--recursive`,
    `-d recurse`, or a short cluster containing `r`/`R`), and to `rg`, `ag`, `ack`, `fd`, `find` and
    `git grep`.
  - The roots are the path operands:
    - after the pattern operand, unless `-e`/`-f`/`--regexp` supplied the pattern;
    - for `find`, the words before its first expression word;
    - with none given, `.`.
  - HIT when a root `reaches()` and no filter narrows the search. The narrowing filters are:
    - `--include=G`;
    - `-g`/`--glob G` (positive and unable to match a forbidden name, or negative excluding
      `.astrocode`/`phases`);
    - `--exclude-dir=.astrocode|phases`;
    - `-t`/`--type T` with T ≠ md;
    - `-name`/`-iname G`;
    - fd `-e EXT` with EXT ≠ md.

Results this rule must give, from CRITERIA C4 and C5:

| Example | Result |
|---|---|
| `cat .astrocode/phases/39-x/PLAN.md` | HIT |
| `head -n 5 "$P/.astrocode/phases/39-x/SPEC.md"` | HIT |
| `grep -n foo …/PLAN.md` | HIT |
| `sed -n 1p …/plan.md` | HIT |
| `cp …/PLAN.md /tmp/x` | HIT |
| `rg TODO .astrocode/phases` | HIT |
| `grep -r foo .astrocode/phases/39-x` | HIT |
| `node --test tests/` | allowed |
| `cat …/CRITERIA.md` | allowed |
| `git log --oneline -5` | allowed |
| `ls src` | allowed |

The header says, in these words, that this is "a mistake-catcher, not a sandbox". Not seen:
- `$(…)`, backticks, `eval`, `xargs`, and `python -c`/`node -e` reads;
- symlinks;
- a search rooted at a worktree path that neither contains `.astrocode` nor exists on disk from the
  plugin's view;
- MCP search tools without a `path`/`command` field.

### P5 — the deny reason: at most 4 lines, no escape named

```
blindfold: <tool> refused — <file or "a search that reaches .astrocode/phases (<root>)"> is closed to <role> (ADR-021: the bar is the goal and CRITERIA.md, never the plan).
Your own rule: "<RULE[role]>"
<verifier>  Grade against CRITERIA.md in the phase dir, with evidence you gather yourself.
<criteria-author>  Derive the criteria from the goal, CONTEXT.md and the canon; CRITERIA.md is what you write.
[search hits only] Narrow it: a path outside .astrocode/phases, or a glob such as *.mjs.
```

The reason never contains `ac mods`, `disable`, or any other way to switch the guard off (C3).

### P6 — fail open (CONTEXT 5, ADR-071 e)

There is one mechanism.
- A join lookup that throws, or loses the `LOOKUP_TIMEOUT_MS` race, THROWS out of `toolCheck`.
- The registered `.catch(failOpen)` then:
  - returns `next(e)`;
  - toasts once per session;
  - turns every switch off until the next `session.start`, which is its existing promise.
- An empty or no-entry answer is a silent pass-through, because that is the normal case for every
  non-plan-blind agent.
- An unidentified agent is never denied.

### P7 — debt fixes (`lib/mods.mjs`)

**Debt `…-status-creates-claude-as-a-side`** (F1):
- `pluginState`, `ensurePlugin`, `updatePlugin` and `removePlugin` run no `claude` command for a
  target dir that does not exist.
  - `pluginState` gives `{ …base, noDir: true }` (marketplace `absent`, not installed).
  - `ensurePlugin` gives `outcome: 'skipped'` with the message
    `no Claude Code config dir here yet — start Claude Code once, then re-run ac mods enable <feature>`.
  - `updatePlugin` and `removePlugin` give `skipped`.
- `modsStatus`: a mod that is on, where the base row is `noDir`, has `why` set to
  `no Claude Code config dir (<dir>)`.
- `claudeVersion` is unchanged (F1).

**Debt `…-enable-of-a-mod-feature-before`**, in `enableMod` for `kind: 'mod'`. The order is:
1. Record the switch.
2. `claude` absent → `claude: 'absent'`.
3. Old or unreadable version → `'old'`/`'unknown'`. The floor line is unchanged.
4. `!existsSync(modsMarketplacePath({home}))` → `{ …, claude: 'ok', plugin: null, install: 'needed' }`,
   and no `claude plugin` call is made.
5. Otherwise `ensurePlugin`.

`bin/ac.mjs` renders `install: 'needed'` as one line:
`⚠ astro-mods is not shipped yet (~/.astro/code/mods missing) — run \`ac install\` first, then re-run \`ac mods enable <feature>\` (switch recorded)`.
Exit 0.

### Test strategy (ADR-018, stated)

**Mixed.**
- t4 is a RED task. It reaches `features/blindfold.js` only through
  `await import('../mods/astro-mods/hooks/features/blindfold.js')` inside async test bodies. It
  drives the hooks only through `register()` via a fixture that imports `register.js`, which already
  exists. A missing hook or module fails only the new tests. They stay RED until t5.
- t2 and t3 are test-in-task: the lib change and its tests land together, green.
- t6 is test-in-task. It rewrites the assertions that pin blindfold as unbuilt, together with the flip.
- The engine test (`register.test.tsx`, run by `claude plugin test`) is test-in-task in t5, because
  it cannot run against a missing hook without failing the live `claude plugin test` gate.

Isolation:
- temp `HOME`, with `CLAUDE_CONFIG_DIR`/`CURSOR_CONFIG_DIR` unset unless a test sets them;
- `PATH` pinned;
- unit calls pass explicit `targets`.

## Tasks

### t1 — Live probe: is there an agentId→type join? Record PROBE.md
- **file:** `scripts/mods-probe/hooks/probe.js`, `.astrocode/phases/39-blindfold-mod-plan-blind-verifier-and/PROBE.md` (new)
- **depends_on:** —
- **Extend the probe.** It stays observe-only unless the deny env below is set, and it is never
  installed: load it with `--plugin-dir`. Add:
  - `agent.spawn`: log `await next(e)`'s `{ agentId, model, teammateId }` beside the event, and
    return it untouched.
  - `tool.check` inside an agent loop: on that agent's FIRST call, log `$.agent.list()` entries
    (`id`, `type`, `name`, `status`, `parentId`, `description` cut to 80 chars) and the call's
    duration in ms. Also log `next.origin`, and a depth-4 key walk of `e` and of `next`.
  - `tool.check` input:
    - key NAMES for every tool;
    - VALUES of `file_path`, `notebook_path`, `path`, `pattern`, `glob` and `type`, cut to 200 chars;
    - `command` stays reduced to its first 40 chars plus its length.
  - `ASTRO_MODS_PROBE_DENY_AGENT=<subagentType>`: the probe keeps its own spawn-result map, and
    answers `{ decision: 'deny', reason: 'probe deny' }` to that type's first Bash or Read call. This
    shows whether a hook deny is honoured inside a `bypassPermissions` subagent on each path.
  - `claude plugin validate --strict scripts/mods-probe` must still exit 0.
- **Runs**, in a scratch project set up as in phase 36 PROBE.md: `ac init`, a bare-remote registry,
  and one throwaway phase holding CRITERIA.md and PLAN.md.
  1. **Workflow path.** `/astro-execute 1` (phase 36 run 1, which spawns `astro-verifier` from
     execute-phase), with `ASTRO_MODS_PROBE_DENY_AGENT` unset.
     - Optionally also `/astro-plan`, for a Workflow-spawned `astro-criteria-author`.
  2. **Agent-tool path.** `claude -p --permission-mode bypassPermissions "Use the Agent tool with subagent_type astro-verifier: list the phase dir, then read its CRITERIA.md and report the first criterion id."`
  3. **Deny check.** Run 2 again with `ASTRO_MODS_PROBE_DENY_AGENT=astro-verifier`. Then run 1 again
     the same way, or a cheaper single-verifier Workflow if one can be driven. Record:
     - whether the call was refused;
     - the relayed reason;
     - `permission_denials`;
     - no hang.
     If a Workflow-path deny cannot be provoked, mark it `not observed` and say why.
  4. **F1 recheck.** A fresh `HOME`: run `claude --version`, then `claude plugin marketplace list --json`, and
     `ls -a` after each.
- **Write PROBE.md** in phase 36's format: dense, machine-read, every field marked observed (with an
  example value) or `not observed`, nothing copied from docs. It must contain:
  - Claude Code version (≥ 2.1.292), date, method and the runs table.
  - Sections in CONTEXT 1's order:
    1. `$.agent.list()` per path, including whether the agent is present on its first tool call;
    2. `agent.spawn` / `next(e)` result / `tool.check` / `next.origin` per path;
    3. any other event examined.
  - Tool input keys actually seen (whether `Grep`/`Glob`/`NotebookRead` appeared).
  - Deny-honoured result per path.
  - F1–F3 (planning facts).
- **End with the P1 verdict line.** For a join, state:
  - the exact linking fields, with the SAME agent's id shown on both sides for each path;
  - the chosen source.
- **On `no join`:**
  - add `## Decision for the user`: no reliable join on 2.1.292, so blindfold stays unbuilt. The
    options are waiting for a Claude Code that links them, or retiring blindfold. CONTEXT 1 forbids
    approximations.
  - run `ac backlog add "blindfold: no agentId→agent-type join on Claude Code <ver> — decide: wait or retire" --note "phase 39 PROBE.md verdict; CONTEXT decision 1"`.
  - Never hand-edit `backlog.json`.
- Never use the real `~/.astro` switches. Never touch the astro-forge stack.

### t2 — Debt: no `claude plugin` call against a missing config dir (`ac mods` never creates `~/.claude`)
- **file:** `lib/mods.mjs`, `tests/mods.test.mjs`, `tests/mods_cli.test.mjs`, `tests/mods_lifecycle.test.mjs`
- **depends_on:** —
- Implement P7 part 1, with a header comment citing F1.
- Test helpers keep every existing test's intent:
  - `tests/mods.test.mjs` `twoDirs(h)` creates both dirs.
  - Both `box()` helpers create `$T/.claude` by default, and take `{ claudeHome: false }` for a bare
    machine.
  - The phase 38 Cursor-only boxes pass `claudeHome: false`.
- New tests:
  - **unit:**
    - `pluginState`/`ensurePlugin`/`updatePlugin`/`removePlugin` on targets whose dirs do not exist
      make ZERO `run` calls;
    - the rows read `noDir` / `skipped`;
    - `modsStatus`'s mod `why` names the missing dir.
  - **CLI, bare box:**
    - `mods status`, `status --json`, `status blindfold`, `enable canon-guard` and
      `disable canon-guard` all exit 0;
    - the stub log has no `plugin` line;
    - `$T/.claude` and `$T/.claude.json` are absent after each command;
    - status JSON still carries `claude.found` and `claude.version`.
  - **live** (`{ skip }` unless a real `claude` ≥ 2.1.292 is on PATH, mirroring
    `mods_plugin.test.mjs`'s `claudeAtFloor`):
    - real PATH with temp `HOME`: `ac mods status` and `--json` leave `HOME/.claude` and
      `HOME/.claude.json` absent;
    - with `HOME/.cursor` created, `ac install` gives the same Cursor outcome as on a sandbox where
      `ac mods status` was never run (C10).
- Close the debt with `ac debt drop 2026-10-11-ac-mods-status-creates-claude-as-a-side --reason "fixed in phase 39 t2: no claude plugin call against a missing config dir"`.
- Done when this is green:
  `node --test tests/mods.test.mjs tests/mods_cli.test.mjs tests/mods_lifecycle.test.mjs tests/install.test.mjs tests/install_cursor.test.mjs`.

### t3 — Debt: `ac mods enable <mod>` before `ac install` says "run `ac install` first"
- **file:** `lib/mods.mjs`, `bin/ac.mjs`, `tests/mods.test.mjs`, `tests/mods_cli.test.mjs`
- **depends_on:** t2
- Implement P7 part 2, and render it in the `mods enable` branch.
- Tests:
  - **unit:** `enableMod blindfold` with no marketplace dir gives `install: 'needed'`, no
    `plugin …` call, and the switch is recorded. With the dir present it still installs. Old and
    absent claude keep their outcomes.
  - **CLI, box without `seedMarketplace`:** `enable blindfold` and `enable witness` each:
    - exit 0;
    - print exactly one line matching `/run `ac install` first/`;
    - print no `marketplace add` text;
    - leave the stub log with no `plugin` line;
    - show the switch on in `status --json`.
  - Then `ac install` + `enable blindfold`: no such line, and the plugin is installed.
- Close the debt with `ac debt drop 2026-10-11-ac-mods-enable-of-a-mod-feature-before --reason "fixed in phase 39 t3: install-first line, switch recorded"`.
- Gate (C12, which holds in both P1 branches):
  - `node --test tests/` exits 0;
  - it exits 0 again under `PATH="$(dirname "$(command -v node)"):/usr/bin:/bin"`, with the claude
    tests skipped;
  - `package.json` has no deps.

### t4 — RED: blindfold behaviour through the plugin's hooks, plus the shared engine fixture
- **file:** `tests/fixtures/mods_engine.mjs` (new), `tests/mods_blindfold.test.mjs` (new), `tests/mods_plugin.test.mjs`
- **depends_on:** t1
- **Gate (P1).** Read PROBE.md's `Verdict:` line first. On `no join`, stop BLOCKED with nothing
  committed. Report the reason as given in P1.
- **`tests/fixtures/mods_engine.mjs`.** Move `boot()` out of `mods_plugin.test.mjs`, unchanged in
  behaviour, and extend it:
  - `$.agent.list` is a recorder backed by a settable impl;
  - `$.session.cwd` and `$.fs.exists` are settable;
  - `invoke(name, e, { beneath })` lets a test choose what `next` resolves to: a frozen
    `BENEATH = { decision: 'allow', hook: 'PreToolUse' }` for `tool.check`, and
    `{ model, agentId }` / a rejecting or never-settling promise for `agent.spawn`;
  - `invoke` tolerates a missing hook name by returning `undefined`, so RED fails on the assertion
    and not with a TypeError crash.
  - `mods_plugin.test.mjs` imports the fixture statically; the fixture exists in this task.
- **`mods_plugin.test.mjs` edits.**
  - The hooks-list test asserts `session.start` and `tool.check` are registered (and allows
    `agent.spawn`). Every hook has a `.catch`, and with every switch off each passes the event
    through.
  - The PROBE-fields test reads phase 36 AND phase 39 PROBE.md together.
- **`identify(eng, agentId, role, path)`**, source-agnostic:
  - fires `agent.spawn` shaped as PROBE.md records it per path (`workflow: { runId, agentIndex }` and
    a shared `tool_use_id` for Workflow; neither for Agent-tool), with `next` resolving
    `{ model: 'opus', agentId }`;
  - AND adds `{ id: agentId, type: role, description: '', status: 'running' }` to the list stub;
  - so S1 and S2 implementations both resolve it.
- `<P>` is the stubbed session cwd. `fs.exists(<P>/.astrocode/phases)` is true.
- **Tables.** Each runs for both spawn paths. DENIED means `decision === 'deny'`, never `ask`.
  ALLOWED means `result === BENEATH`.
  - C3:
    - the verifier and criteria-author Read matrix, including `07-other/plan.md`, `Plan.MD`, and a
      `notebook_path` PLAN.md;
    - the verifier is ALLOWED `ACCEPTANCE.md`.
  - Reason: matches `ADR-021`, contains `RULE[role]`, the refused basename and `CRITERIA.md`, and
    does not match `/ac mods|disable/i`.
  - C4: every Bash row in CRITERIA C4 and in P4's table, plus `cd .astrocode/phases/39-x && cat PLAN.md`,
    `git show HEAD:.astrocode/phases/39-x/PLAN.md` and `bash -c 'cat .astrocode/phases/39-x/SPEC.md'`
    (all DENIED), and `cat docs/PLAN.md` (ALLOWED). It also covers criteria-author `cat …/ACCEPTANCE.md`.
  - C5, every row. Plus:
    - Grep with no path → DENIED;
    - Grep `glob: '*.mjs'` with path `<P>` → ALLOWED;
    - Glob `**/*` with no path → DENIED;
    - Glob `.astrocode/phases/*/CRITERIA.md` → ALLOWED.
  - C6:
    - allowed files, and `<P>/docs/PLAN.md`, are ALLOWED for both roles;
    - PLAN.md read by `astro-executor`, `astro-planner`, `astro-researcher`, `workflow-subagent`,
      `general-purpose` and the main loop (no `agentId`) is ALLOWED;
    - for the main loop, the list stub records ZERO calls.
  - C7: with the switch OFF, every DENIED row above is ALLOWED, the list stub records zero calls, and
    `agent.spawn` returns `next`'s value by identity.
  - C8: three variants, each failing on BOTH sources so either implementation is exercised:
    - throw: the list rejects AND the spawn `next` rejects;
    - hang: the list never settles AND the spawn `next` never settles;
    - no entry: the list is `[]` AND the spawn resolves `{ model }`.

    Each variant fires PLAN.md Read ×3. Results:
    - every call is ALLOWED within 5 s, with no escaping rejection;
    - at most one toast per session for throw and hang;
    - zero toasts for no entry.
- **Single source** (via `await import`):
  - `FORBIDDEN` deep-equals P2's table;
  - each `RULE[role]` appears verbatim in its agent file;
  - neither agent file names `blindfold` or `ac mods` (ADR-071 b).

### t5 — `features/blindfold.js`, its `register.js` lines, and the engine test
- **file:** `mods/astro-mods/hooks/features/blindfold.js` (new), `mods/astro-mods/hooks/register.js`, `mods/astro-mods/hooks/register.test.tsx`
- **depends_on:** t4
- Re-check the PROBE.md verdict, and stop BLOCKED on `no join`.
- Implement P2–P6 with the source the verdict names.
- House header comment covering:
  - the rule and its sources (ADR-021, the two agent lines);
  - why the join source is the one PROBE.md observed (F3);
  - the S2 map, if used: in memory only, cleared on `register()`, never persisted (ADR-071 c);
  - fail open (P6);
  - "a mistake-catcher, not a sandbox", with P4's list of what is not seen;
  - why the tokenizer is the module's own.
- `register.js`:
  - `register()` calls `resetBlindfold()`;
  - add the one or two `on(…).catch(failOpen)` lines;
  - update the header ("This skeleton ENFORCES NOTHING" becomes a one-line feature list).
- `register.test.tsx`:
  - stub `process.run` with blindfold ON;
  - stub the join source (`agent.list`, and/or `agent.spawn` beneath answering `{ model, agentId }`);
  - stub `session.cwd`;
  - then an `astro-verifier` `tool.check` Read of `/w/.astrocode/phases/01-x/PLAN.md` gives
    `decision: 'deny'`;
  - the same call with no `agentId` returns what the stub beneath answered.
- Done when all of these pass:
  - `node --test tests/mods_blindfold.test.mjs tests/mods_plugin.test.mjs` is green;
  - `claude plugin validate --strict mods` and `… mods/astro-mods` exit 0;
  - `claude plugin test mods/astro-mods` exits 0.

### t6 — Flip `blindfold` built, and rewrite the assertions that pinned it unbuilt
- **file:** `lib/mods.mjs`, `tests/mods.test.mjs`, `tests/mods_cli.test.mjs`, `tests/mods_lifecycle.test.mjs`
- **depends_on:** t3, t5
- `FEATURES`: blindfold gets `built: true`. Update the comment ("true for phases 37–39").
- Tests, using `witness` wherever a still-unbuilt feature is needed:
  - `mods.test.mjs`:
    - the "not built yet" `why` assertion moves to `witness`;
    - `enableMod blindfold` asserts `built: true`;
    - add: blindfold on + plugin installed gives `canTakeEffect: true`.
  - `mods_cli.test.mjs`: phase 38's "an unbuilt feature still says so" uses `witness`. Add:
    `status blindfold` with no `not built yet`.
  - `mods_lifecycle.test.mjs`: only if an assertion relies on blindfold being unbuilt.
- Done when this is green:
  `node --test tests/mods.test.mjs tests/mods_cli.test.mjs tests/mods_lifecycle.test.mjs tests/hosts.test.mjs tests/mods_plugin.test.mjs tests/mods_blindfold.test.mjs`.

### t7 — Document blindfold, live recheck against the shipped plugin, full-suite gate
- **file:** `MANUAL.md`, `ARCHITECTURE.md`, `.astrocode/phases/39-blindfold-mod-plan-blind-verifier-and/PROBE.md`
- **depends_on:** t6
- `MANUAL.md` "Enforcement mods":
  - the table row reads `phase 39 (built)`;
  - "the other six" becomes "the other five";
  - add a **blindfold** section with:
    - who it binds (`astro-verifier`, `astro-criteria-author`; nobody else);
    - the forbidden files;
    - tools covered;
    - search narrowing;
    - deny-not-ask, and why;
    - fail open;
    - P4's not-seen list;
    - that the switch is read at session start (`/reload-plugins` after `ac mods enable|disable`);
    - that Codex and Cursor keep the prose rule.
  - Phrase it "optionally, on Claude Code", per the `tests/hosts.test.mjs` modDependency guard. No
    agent or command body changes.
- `ARCHITECTURE.md`: one sentence in the astro-mods paragraph saying that blindfold is the first
  `features/*.js` mod, and naming the join source and where PROBE.md lives.
- PROBE.md: append `## Recheck (shipped plugin)`.
  - Setup: a scratch `HOME`, then `ac install` and `ac mods enable blindfold`.
  - Run `claude -p --plugin-dir <HOME>/.astro/code/mods/astro-mods --permission-mode bypassPermissions`
    in a scratch project, asking an Agent-tool `astro-verifier` to read the phase's PLAN.md and
    CRITERIA.md.
  - Record:
    - PLAN.md refused, with the relayed reason;
    - CRITERIA.md read;
    - the same main-session read of PLAN.md allowed;
    - no hang.
  - Skip it with a stated reason if no `claude` ≥ 2.1.292 is available.
- Gate (C11, C12):
  - `claude plugin validate --strict mods` and `… mods/astro-mods` exit 0;
  - `claude plugin test mods/astro-mods` exits 0;
  - `node --test tests/` exits 0, and again under the no-claude PATH.

## Wave shape

| Wave | Tasks | Why |
|---|---|---|
| 1 | t1, t2 | Independent; disjoint files. |
| 2 | t3 (after t2), t4 (after t1) | Disjoint files. |
| 3 | t5 | After t4. |
| 4 | t6 | After t3 and t5. |
| 5 | t7 | |

Under `no join`: t1, t2 and t3 land, t4 stops BLOCKED, and t5–t7 are skipped. That is the
deliberate stop in P1.

Same-file check:
- `lib/mods.mjs`: t2 → t3 → t6, serialized.
- `bin/ac.mjs`: t3 only.
- `tests/mods.test.mjs` and `tests/mods_cli.test.mjs`: t2 → t3 → t6.
- `tests/mods_lifecycle.test.mjs`: t2 → t6, via t3.
- `tests/mods_plugin.test.mjs` and `tests/fixtures/mods_engine.mjs`: t4 only.
- Plugin files: t5 only.
- PROBE.md: t1 → t7, via t4, t5 and t6.
- `.astrocode/debt.json` (CLI only): t2 → t3.

Destructive edits: only `boot()` moves out of `mods_plugin.test.mjs` into the fixture. Its sole
consumer is rewritten in the same task (t4). Everything else is additive. Every boundary loads and
compiles; the only failing tests are t4's declared RED ones, and t5 closes them.
