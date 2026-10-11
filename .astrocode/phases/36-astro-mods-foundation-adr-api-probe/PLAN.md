# Plan — phase 36: astro-mods foundation (ADR, API probe, plugin skeleton, `ac mods` toggles)

Obeys `.astrocode/CONVENTIONS.md` (Node ≥22 ESM, zero deps, named exports, `die`/`json()`/
glyphs, `node:test` with a real fs, house comment voice), `.astrocode/DECISIONS.in-force.md`
(ADR-001 zero deps, ADR-018 red-test imports, ADR-020 wave-green, ADR-021 CRITERIA is the bar,
ADR-029 flag allowlists, ADR-030 optional integrations are silent when absent, ADR-034/039
decisions only via `ac decision add`, ADR-057 `~/.astro/` outside `.astrocode/`, ADR-068
per-user `~/.astro/config.json`), this phase's `CONTEXT.md` (D1–D9) and aims at every
criterion in `CRITERIA.md` (C1–C15). Principles brief (`--stage plan --by planner`): nothing
in scope.

## Facts settled during planning (live `claude` 2.1.292, scratch `CLAUDE_CONFIG_DIR`)

The open question in CONTEXT is closed. Executors must not re-derive these facts. Build on
them.

- **F1 — `CLAUDE_CONFIG_DIR` is honoured by `claude plugin marketplace add|list|remove`,
  `install`, `update`, `uninstall` and `list`.** Marketplaces, plugins and `settings.json`
  `enabledPlugins` land in that dir. The multi-profile fan-out in D2 is therefore built. It is
  not a recorded gap.
- **F2 — JSON shapes the wrapper parses.** Every command gets `--json`. `update` and
  `uninstall` also get `-y`, because stdin is not a TTY.
  - `plugin marketplace list --json`: `[]`, or `[{name, source:"directory", path, installLocation}]`.
  - `plugin list --json`: `[{id:"astro-mods@astro-code", version, scope:"user", enabled, installPath, readFromFolder, folderVersion, …}]`.
  - `plugin marketplace add <path> --json`: `{"command":"marketplace-add","outcome":"ok","marketplace":"astro-code","message":…}`.
    - Re-adding the SAME path is idempotent: `outcome ok`, message "already on disk".
    - Adding a DIFFERENT path under an existing name silently re-points it and exits 0. `ac`
      must therefore compare `path` itself (C7) and never rely on `claude` to refuse.
  - `plugin install astro-mods@astro-code --json`: `{"command":"install","outcome":"ok","pluginId":…,"scope":"user"}`.
    - Failure: exit 1, `{"outcome":"failed","failureCode":"not_found",…}`, plus a `✘` line on stderr.
  - `plugin update astro-mods@astro-code -y --json`: `{"command":"update","outcome":"ok","updateOutcome":"up_to_date"|…}`.
  - `plugin uninstall astro-mods@astro-code -y --json`: `{"command":"uninstall","outcome":"ok",…}`.
  - `plugin marketplace remove astro-code --json`: `{"command":"marketplace-remove","outcome":"ok"}`.
- **F3 — the plugin validator's static rules.**
  - `export function register(on, options)` is the required export.
  - Every registration must be literally `on("<event>", <function literal or function name>)`.
    A wrapper call such as `on('x', failOpen(fn))` FAILS `validate`.
  - Fail-open is therefore the engine's own mechanism: `on('session.start', sessionStart).catch(failOpen)`,
    with `failOpen` a named function in a sibling module. This passed `validate --strict`, and
    the validator follows sibling imports ("calls: $.process.run, $.ui.toast").
  - `hooks/hooks.json` = `{"modules":["./register.js"]}`. A `.js` module needs no build.
  - The `$` I/O surface is `$.process.run(argv, { timeoutMs })`. It rejects when the command
    cannot start or is still running at the timeout (default 30 s).
  - `session.start` fires at session start and again on each `/reload-plugins` reload.
- **F4 — `claude plugin test <dir>` runs only `*.test.ts` / `*.test.tsx`.** It exits 1 with no
  test file.
  - A `.test.ts` file is ALSO collected by a bare `node --test` on Node ≥23 (type stripping)
    and crashes there on `import 'claude-code/testing'`.
  - A `.test.tsx` file is run by `claude plugin test`, and ignored by `node --test` (verified,
    Node 26). The plugin's one engine test is therefore `register.test.tsx`.
- **F5 — local-directory marketplaces are read from the folder** (`readFromFolder`).
  - `ac install` / `ac update` refresh `~/.astro/code/mods`, and a session picks the change up
    on `/reload-plugins`.
  - `claude plugin update` is then mostly `up_to_date`. Run it anyway (D2, C9).

## Decisions this plan pins

- **P1 — feature registry.** `lib/mods.mjs` exports `MOD_FLOOR = '2.1.292'` and a frozen
  `FEATURES` array, in this order. Each entry is `{ name, kind, phase, built: false, description }`:

  | name | kind | phase | description |
  |---|---|---|---|
  | canon-guard | hook | 37 | refuse hand edits to generated and registry-owned state |
  | git-guard | hook | 38 | refuse unscoped destructive git in the shared tree |
  | blindfold | mod | 39 | keep the verifier and criteria-author plan-blind |
  | spawn-policy | mod | 40 | refuse haiku, pin role models, isolate parallel waves |
  | witness | mod | 41 | tell a human acceptance from an agent's |
  | brief-section | mod | 42 | principles brief as one cached system-prompt section |
  | phase-band | mod | 43 | phase band with next-command buttons |
  | live-capture | mod | 44 | offer principle capture from human-typed prompts |

  Phases 37–44 flip `built` to `true`.
- **P2 — `lib/mods.mjs` API.** Named exports only, and no module-load capture of the home.
  Every function takes `{ home = homedir(), run = runClaude, targets = configTargets() }` as
  needed.
  - **`runClaude(args, { env })`**
    - Calls `spawnSync('claude', args, { encoding:'utf8', timeout: 60000, windowsHide: true, env })`.
    - Returns `{ status, stdout, stderr, missing }`. `missing: true` on ENOENT. It never throws.
  - **`claudeEnvFor(dir, { home })`**
    - Returns `process.env` with `CLAUDE_CONFIG_DIR=dir`.
    - Exception: when `dir === join(home,'.claude')`, `CLAUDE_CONFIG_DIR` is DELETED. The default
      profile keeps Claude's own default layout; `~/.claude.json` is not relocated.
  - **`parseClaudeVersion(text)`**: returns the leading `X.Y.Z`, or `null`.
  - **`compareVersions(a, b)`**: numeric per segment, so `2.1.1000 > 2.1.9`.
  - **`claudeVersion({ run })`**: returns `{ found, version }`. `found:false` when missing;
    `version:null` when unparseable.
  - **`readMods({ home })`**
    - Returns `{ switches: {<8 names>: boolean}, warnings, configured }`. It never throws and
      never writes. It does not create `~/.astro`.
    - A missing file or a missing `mods` key means all off.
    - Invalid JSON, or `mods` that is not an object, gives a warning and all off.
    - A non-boolean value counts as off. Unknown keys are ignored here.
  - **`setMod({ home, feature, on })`** → `{ ok:true, switches }` or `{ ok:false, error }`.
    - This is the only writer of the `mods` key.
    - An unknown name is refused BEFORE any read or write, with the message
      `unknown feature "<x>" — use one of: <8 names>`.
    - Invalid JSON, or a non-object file, is refused with
      `<file> is not valid JSON — fix it first; nothing was changed`.
    - Sibling keys and unknown `mods` keys are preserved.
    - Off is stored as `false`, not deleted, so the switch is visible in the file.
    - `mkdirSync` runs only on a write. The write is atomic: `${file}.${pid}.tmp` then `renameSync`.
    - It mirrors `updateAgentTools`. No shared-helper extraction: that would be out of scope.
  - **`modsMarketplacePath({ home })`** = `join(home,'.astro','code','mods')`. Paths are
    compared via `realpathSync` when they exist, `resolve` otherwise.
  - **`pluginState({ home, run, targets })`**
    - Returns one entry per target: `{ dir, label, marketplace:'ours'|'other'|'absent'|'unknown', marketplacePath, installed, enabled, error? }`.
    - `ours` means `name === 'astro-code'` and the path equals `modsMarketplacePath`.
  - **`ensurePlugin({ home, run, targets })`**
    - Per dir, in this order:
      1. List the marketplaces.
      2. `other`: outcome `collision`, with `fix` =
         `CLAUDE_CONFIG_DIR=<dir> claude plugin marketplace remove astro-code` (the
         `CLAUDE_CONFIG_DIR=` prefix is omitted for the default dir), and touch nothing more.
      3. `absent`: `marketplace add <modsMarketplacePath> --json`.
      4. List the plugins. If already installed, the outcome is `already`.
      5. Otherwise `install astro-mods@astro-code --json`. On failure, if THIS call added the
         marketplace, `marketplace remove astro-code` it again. A dir is never left
         half-installed (C10).
    - One dir's failure never aborts the others. Returns
      `[{ dir, label, outcome:'installed'|'already'|'collision'|'failed', message, fix? }]`.
  - **`updatePlugin(...)`**: only where `installed` and `marketplace === 'ours'`, runs
    `plugin update astro-mods@astro-code -y --json`. Returns per-dir `updated`, `skipped` or
    `failed`.
  - **`removePlugin(...)`**: only where the marketplace is `ours`. Runs
    `plugin uninstall astro-mods@astro-code -y --json` if installed, THEN
    `plugin marketplace remove astro-code --json`. A foreign `astro-code` marketplace is never
    touched.
  - **`modsStatus({ home, run, targets })`**
    - Returns `{ floor, claude:{found, version, meetsFloor}, plugin:{ installed, dirs:[pluginState…] }, features:[{ name, kind, phase, built, description, on, canTakeEffect, why }], warnings }`.
    - `plugin.installed` is true if the plugin is installed in ANY target. `plugin.dirs` names
      each dir, so a partial fan-out is visible (C10).
    - `canTakeEffect` is `on && built`, and for `mod` also `meetsFloor && installed` in the
      base dir.
    - `why` is the first failing reason: `off`, `not built yet (phase N)`,
      `no Claude Code found`, `Claude Code X < 2.1.292`, `astro-mods plugin not installed`.
    - It never runs a `plugin` command when Claude is missing or below the floor.
  - **`enableMod({ home, run, targets, feature })`**
    - Steps:
      1. Validate the name.
      2. Call `setMod`. On refusal, return `{ok:false, error}`. Nothing else runs (C3, C4).
      3. `kind:'hook'` makes NO `claude` call at all (C5: not gated, no version warning).
      4. `kind:'mod'` calls `claudeVersion`. Absent → `claude:'absent'`. Below the floor or
         unparseable → `claude:'old'|'unknown'`. In those cases no `plugin` call is made.
         Otherwise it calls `ensurePlugin`.
    - Returns `{ ok:true, feature, kind, phase, built, claude, version, plugin: results|null }`.
- **P3 — CLI `case 'mods'` (thin, modelled on `agent-tools`).**
  - **`ac mods [status [<feature>]] [--json] [--switches-only]`**
    - `status` is the default. It works outside any project and never writes.
    - An unknown `<feature>` dies with `✖`.
    - Human form:
      - One header line: `Claude Code <version|not found> · astro-mods plugin installed in <n>/<m> config dir(s)`.
      - Then one line per feature: name, `on`/`off`, kind, `why` (or `takes effect`).
      - Warnings go to stderr as `⚠`.
  - **`--switches-only`** always prints JSON `{ switches:{…8}, warnings }` and NEVER spawns
    `claude`. It is the cheap read for the plugin's `session.start` and for the settings hooks
    in phases 37–38 (the hot path).
  - **`ac mods enable|disable <feature>`**
    - A missing feature dies with a usage message. `--json` prints the `enableMod` result.
    - `enable` lines:
      - `✓ <f> on — saved to ~/.astro/config.json`.
      - `• not built yet — takes effect when phase <N> lands` while `built:false`.
      - For a `mod`, exactly ONE of these, and only when it applies:
        - `⚠ <f> is a Claude Code mod — no Claude Code found here, so it cannot take effect (switch recorded)`
        - `⚠ <f> needs Claude Code ≥ 2.1.292 (found <v|an unreadable version>) — switch recorded; plugin not installed`
        - then one line per dir: `✓ astro-mods installed → <dir> [<label>]` / `⚠ <dir> [<label>]: <message>` + `  fix: <fix>`. An `already` outcome is silent.
    - A `collision` or `failed` result sets `process.exitCode = 1`. The switch stays recorded and
      `status` reports `canTakeEffect:false` (C7 consistency).
    - `disable`: `✓ <f> off`. For a `mod` it adds ` — the astro-mods plugin stays installed and inert`.
      `disable` never spawns `claude`.
  - `ALLOWED_FLAGS` gains `'mods enable': ['json']` and `'mods disable': ['json']`. `status` is
    read-only and stays unguarded (ADR-029).
  - HELP gains two lines, so `verbHelp('mods')` finds them:
    - `ac mods [status [<feature>]] [--json]`: optional Claude Code enforcement, what is on and whether it can take effect here.
    - `ac mods enable|disable <feature>`: one switch in ~/.astro/config.json; the first mod installs the astro-mods plugin.
- **P4 — install / update / uninstall.**
  - **`lib/install.mjs` `installClaude`**
    - Unless `sameDir(src, dest)` (self-hosted), it runs `rmSync(join(ASTRO_HOME,'mods'), {recursive, force})`
      then `copyTree(join(frameworkRoot,'mods'), join(ASTRO_HOME,'mods'))`.
    - The rm is required: `cpSync` never removes a file deleted upstream. The tree is
      framework-owned. It is copied, not symlinked, so the Windows EPERM debt stays untouched.
    - `uninstallClaude` needs no change: it deletes the home.
  - **`bin/ac.mjs` `install`**
    - After `reportAgentTools(res)`, exactly one line, and only when
      `claudeVersion().version >= MOD_FLOOR`:
      `• optional on Claude Code: enforcement mods — see \`ac mods status\`, turn one on with \`ac mods enable <feature>\``.
    - Never any `plugin` call.
  - **`update`**: after `installClaude(clone)`, call `updatePlugin()` only when `claude` is
    found. Print one `✓ astro-mods refreshed → <dir>` line per updated dir and a `⚠` per
    failure. Otherwise silent.
  - **`uninstall`**: FIRST, before the fleet disconnect and `uninstallClaude()` (the marketplace
    path points into the home), call `removePlugin()` when `claude` is found. Print one line per
    dir where something was removed. Otherwise silent. An absent `claude` is silent.
  - **`package.json` `files`** gains `"mods"`. `scripts` stays unshipped (D7).
- **P5 — plugin skeleton (`mods/astro-mods/`).**
  - `.claude-plugin/plugin.json`: `name` `astro-mods`, `version` from root `package.json`
    (`0.40.2`), `description`, `author.name`. `--strict` needs `description` and `author`.
  - `package.json` `{"type":"module","private":true}`. This makes the `.js` modules ESM for
    Node wherever the tree is copied: `~/.astro/code/mods` has no parent `package.json`.
  - `mods/.claude-plugin/marketplace.json`: `name:"astro-code"`, `description`,
    `owner.name:"astro-code"`, `plugins:[{name:"astro-mods", source:"./astro-mods", description}]`.
  - `hooks/hooks.json` `{"modules":["./register.js"]}`.
  - **`hooks/register.js`**
    - `export function register(on, options)` registers ONLY
      `on('session.start', sessionStart).catch(failOpen)`.
    - `sessionStart` awaits `loadSwitches($)` and returns `next(e)`. It reads NO field of `e`.
    - The header comment states the feature convention. Feature `<name>` is
      `hooks/features/<name>.js`, exporting named hook functions that open with
      `if (!isOn('<name>')) return next(e)`. `register.js` then gains one
      `on('<event>', <fn>).catch(failOpen)` line per hook. This is phases 39–44's
      "one file + one line".
  - **`hooks/lib/switches.js`**
    - `loadSwitches($)` runs `$.process.run(['ac','mods','status','--json','--switches-only'], { timeoutMs: 5000 })`
      (stay under the session.start hook budget in the bundled typings). It throws on a
      non-zero exit or on non-JSON, and fills an in-memory map that starts all-off.
    - `isOn(name)` reads that map.
    - No file I/O. Rule (c): the only state is what `ac` returned this session.
  - **`hooks/lib/failopen.js`**
    - `failOpen($, e, next)` sets a module-level `told` flag. The first time, it shows one
      `$.ui.toast('astro-mods: <hook> failed (<next.error kind/message, short>) — letting the action through; every mod is off until the next session')`,
      wrapped in try/catch because `-p` has no UI. It always returns `next(e)`.
    - The engine routes a throw, a wrong shape or an overrun to `.catch` (F3). A failed
      `session.start` therefore leaves every switch off, with exactly one notice.
  - **`hooks/register.test.tsx`** (F4) uses `claude-code/testing`. Minimum: the plugin loads,
    and a `$.tool.call` or a raised event passes through unchanged. Its API comes from the
    bundled `claude-code.d.ts` (`/tmp/claude-*/bundled-skills/<ver>/*/plugin-authoring/`). If
    no pass-through assertion fits that API, it is a load smoke test with a comment saying so.
  - Recorded in the ADR (t1) as the only exceptions to "every file `.mjs`" (the plugin's `.js`
    modules and one `.test.tsx`).
- **P6 — the probe (`scripts/mods-probe/`, committed, not shipped).**
  - Layout: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/probe.js`. It must pass
    `claude plugin validate --strict scripts/mods-probe`.
  - It observes and never alters: every hook returns `next(e)`.
  - It is OFF unless `ASTRO_MODS_PROBE_LOG` (an absolute path) is set in the session env
    (read through `$`'s env noun).
  - It appends one JSONL line per event: `session.start`, `tool.call`, `tool.check`,
    `agent.spawn`, `prompt.submit`, `command.run`. Each line is
    `{event, at, keys:Object.keys(e), fields}`, where:
    - `fields` copies scalars and short strings in full.
    - `prompt`, `text` and `content` are cut to their first 80 chars plus a length.
    - `tool.*` `input` is reduced to `{key: {type, length}}`. File contents and secrets never
      reach the log.
    - nested objects (`origin`, `workflow`) are kept to depth 2 with the same truncation.
  - It writes through `$.fs` (signature from the typings).
  - The log is never committed. Default it under the scratch dir; `*.log` is already gitignored.
- **Test strategy (ADR-018, stated).** Test-first.
  - t4 is RED and reaches `lib/mods.mjs` ONLY via `await import(...)` in async bodies.
  - t5 and t6 are RED and spawn the CLI only. They import nothing new except their own
    fixture, `tests/fixtures/claude_stub.mjs`, which t5 creates.
  - t11 is RED and reaches `mods/astro-mods/hooks/*.js` ONLY via `await import(...)`.
  - t13 (parity) is test-in-task: its matcher is the test itself, with a negative fixture.
  - Implementations: t7 turns t4 green, t8 turns t5 green, t9 turns t6 green, and t12 turns
    t11 green.
  - Live `claude` tests run in a temp `HOME` and `CLAUDE_CONFIG_DIR`, never the real profile.
    They skip with a reason (`{ skip }`) when `claude` is absent or below 2.1.292 (C11, C15).

## Tasks

### t1 — Record the astro-mods ADR through the shared log
- **file:** `.astrocode/DECISIONS.md`, `.astrocode/DECISIONS.in-force.md`
- **depends_on:** —
- Run `ac decision add` from the repo root. NEVER hand-edit DECISIONS.md (C1, ADR-034/039).
  The registry allocates the id, probably ADR-071.
- Title (one line):
  `astro-mods is an optional, Claude-only enforcement layer: it enforces only rules the canon already states, no command or agent depends on it, it keeps no state of its own, every feature is off by default behind its own switch, and it fails open; canon-guard and git-guard ship as PreToolUse settings hooks, the other six as mods`.
- `--why` must state, in substance:
  - (a) the canon is the source of truth: a mod only enforces a rule the canon already states,
    and its deny message quotes that ADR or convention;
  - (b) no command or agent body may depend on a mod, guarded by a parity test (ADR-030 lineage);
  - (c) a mod holds no state and reads/writes only through `ac`, switches included
    (`ac mods status --json --switches-only` at `session.start`);
  - (d) off by default, one switch per feature in `~/.astro/config.json` `mods`, beside
    `agent_tools` (ADR-068); not plugin `userConfig`, which is per profile and invisible to
    settings hooks;
  - (e) fail open: a failing, overrunning hook or a missing `ac` lets the action through and
    says so once per session (via the engine's `.catch`);
  - the split: features that need no per-agent knowledge (canon-guard, git-guard) are
    `PreToolUse` settings hooks, which Cursor imports too; the rest are mods;
  - one version floor, Claude Code 2.1.292;
  - distribution as the local marketplace `astro-code` under `~/.astro/code/mods`, fanned out
    to every Claude config dir. `claude plugin` honours `CLAUDE_CONFIG_DIR` (F1). A different
    marketplace already named `astro-code` is refused, never re-pointed;
  - file-type exceptions to "every file `.mjs`": the plugin's modules are `.js`
    (`hooks.json` / validator convention, with no build step), and one `register.test.tsx`
    (`claude plugin test` runs only `*.test.ts(x)`; `.tsx` keeps a bare `node --test` on
    Node ≥23 from collecting it).
- `--rejected`: plugin `userConfig` switches; one switch for the whole plugin; a public
  marketplace; making every feature a settings hook.
- It must NOT declare astro-mods an adopter extension point, nor link, close or graduate backlog
  `2026-09-22-a-plugin-surface-for-adopters-with`. The why ends with
  "the adopter plugin surface stays an open question".
- Check: `ac decision list` shows it in force, and `ac backlog list` still shows that item open.

### t2 — The API probe plugin
- **file:** `scripts/mods-probe/.claude-plugin/plugin.json`, `scripts/mods-probe/hooks/hooks.json`, `scripts/mods-probe/hooks/probe.js`
- **depends_on:** —
- Implement P6.
- The header comment covers: why the probe exists (D7: the skeleton's typed assumptions come
  from observation, not docs), how to run it (`ASTRO_MODS_PROBE_LOG=/abs/x.jsonl claude --plugin-dir <abs>/scripts/mods-probe`),
  the redaction rules, and that it is never shipped (`scripts/` is outside `package.json` `files`).
- Event names and the `$.fs` / env API come from the bundled `claude-code.d.ts` of the
  installed version. An event name `validate` rejects is dropped, with a comment.
- Gate: `claude plugin validate --strict scripts/mods-probe` exits 0. Run it with
  `CLAUDE_CONFIG_DIR` set to a temp dir.

### t3 — Run the probe on real Workflow-spawned agents and write PROBE.md
- **file:** `.astrocode/phases/36-astro-mods-foundation-adr-api-probe/PROBE.md`, `scripts/mods-probe/**` (fixes only)
- **depends_on:** t2
- `claude --version` must be ≥ 2.1.292. If it is lower, run anyway, mark every unobserved
  field missing, and flag phases 39/40 as blocked on the upgrade (CONTEXT §Prerequisite).
  Never touch the astro-forge container or compose stack. Never `claude plugin install` the
  probe: use `--plugin-dir` only.
- Scratch project under the session scratch dir: `git init`, `ac init`, and one throwaway phase
  whose PLAN.md has two independent trivial tasks (each writes one file).
- Run 1, a real `/astro-execute`:
  `ASTRO_MODS_PROBE_LOG=<abs> timeout 1800 claude -p --plugin-dir <abs repo>/scripts/mods-probe --permission-mode bypassPermissions "/astro-execute <n>"`
  in the scratch project. This gives Workflow-spawned agents.
- Run 2, the Agent-tool path: a `claude -p` prompt that delegates one read-only question to
  the `astro-researcher` subagent.
- Run 3, interactive, for `prompt.submit` / `command.run` origin. Use `tmux new -d` to start
  `claude --plugin-dir …` in the scratch project, `send-keys` a typed prompt and then a typed
  `/astro-status`, wait, and exit. If the interactive session cannot be driven, record
  "composer origin: not observed" and leave it to ACCEPTANCE item 5.
- PROBE.md (machine-read, dense) contains:
  - the version;
  - the date and the exact commands of each run, with the scratch paths shown as `<scratch>`;
  - per event, the `keys` seen and example values (redacted as logged);
  - a per-field table for `agent.spawn` (agent type/name, model, isolation, isTeammate,
    workflow run/index, id/`tool_use_id`), `tool.check` (agentId with presence per run —
    main loop, Agent-tool agent, Workflow agent — tool, input, decision) and
    `prompt.submit` / `command.run` (origin kind for the typed, slash-expanded and
    Workflow-injected prompts), each `observed (run N)` or `not observed`. Nothing is copied
    from docs;
  - the `session.start` fields (the only event the skeleton touches);
  - a short "what this means for phases 39/40/41" section;
  - an "Install facts" section restating F1–F5. C10's phase-record reads it.
- Do not commit the log or the scratch project.

### t4 — RED: `lib/mods.mjs` unit tests
- **file:** `tests/mods.test.mjs` (new)
- **depends_on:** —
- Every symbol comes from `await import('../lib/mods.mjs')` inside async test bodies. Real
  `mkdtempSync` homes. A hand-written fake `run` (a function that records `args` and `env` and
  answers from a per-dir in-memory state using the F2 shapes) replaces `claude`. No mock library.
- Registry: exactly the 8 names in P1 order, the kinds per P1, all `built:false`, and
  `MOD_FLOOR === '2.1.292'`.
- Versions:
  - `parseClaudeVersion('2.1.292 (Claude Code)') === '2.1.292'`; garbage → `null`.
  - `compareVersions('2.1.1000','2.1.9') > 0`, `('2.1.287','2.1.292') < 0`, and equal → 0.
  - `claudeVersion` with a `run` answering `missing:true` → `{found:false, version:null}`,
    with no throw.
- `readMods`:
  - no file → all off and the file is still absent. `{"agent_tools":{}}` → all off.
  - `{oops` → all off + 1 warning, and the bytes are unchanged.
  - `mods: "x"` → warning, all off.
  - `mods: {blindfold:"yes"}` → off. Unknown keys don't throw.
- `setMod`:
  - Sibling `agent_tools` / `other` keys are deep-equal after enable and disable, and only the
    named switch changes.
  - An unknown name returns `ok:false` listing the 8 names, the file stays absent or
    byte-identical, and `run` is never called.
  - `{oops` is refused and stays byte-identical.
  - An unknown pre-existing `mods.zzz` key is preserved, and no `.tmp` file is left behind.
- `claudeEnvFor`: the default dir has no `CLAUDE_CONFIG_DIR`, and another dir carries it.
- Plugin ops over two targets (base `<home>/.claude`, profile `<home>/p2`):
  - `ensurePlugin` from empty → per dir, add then install, in order, with the right env.
  - Again → `already`, with no second `install`.
  - A foreign `astro-code` path in p2 → p2 `collision` with a fix naming
    `marketplace remove astro-code`, no add or install in p2, and the base dir still installs.
  - An install failure in a dir where this call added the marketplace → that marketplace is
    removed again.
- `updatePlugin`: no `update` where the plugin is not installed, or where the marketplace is
  foreign. `update … -y --json` where it is ours and installed.
- `removePlugin`: `uninstall` before `marketplace remove`, and a foreign marketplace untouched.
- `modsStatus`:
  - With `run` missing: `claude.found:false`, no `plugin` call, every feature `on:false` with
    its kind, and `canTakeEffect:false`.
  - With old `2.1.287`: no `plugin` call.
- `enableMod`:
  - `canon-guard` makes zero `run` calls.
  - `blindfold` on old → `claude:'old'`, the switch is on, and no `plugin` call.
  - On ≥ floor → `ensurePlugin` results.

### t5 — RED: `ac mods` CLI tests + the `claude` stub fixture
- **file:** `tests/fixtures/claude_stub.mjs` (new), `tests/mods_cli.test.mjs` (new)
- **depends_on:** —
- The fixture exports
  `writeClaudeStub(binDir, { version, stateFile, logFile })`.
  - It writes an executable `binDir/claude` with shebang `#!${process.execPath}`, so it works
    under a PATH with no `node`.
  - It appends `${CLAUDE_CONFIG_DIR||'-'}\t${argv.join(' ')}` to `logFile`.
  - It answers `--version` and the F2 subset with the F2 JSON shapes. State is keyed by
    `CLAUDE_CONFIG_DIR||'default'` in `stateFile`.
  - It reproduces the real silent re-point on `marketplace add` of a new path under an existing
    name, and reads the marketplace name from `<path>/.claude-plugin/marketplace.json`.
  - `install` fails (`outcome:"failed"`, exit 1) when the marketplace is missing or does not
    list the plugin, or when `CLAUDE_STUB_FAIL_INSTALL=1`.
- Every spawn is
  `spawnSync(process.execPath, [bin/ac.mjs, …], { cwd: T, env: { HOME: T, PATH: [stubBin,'/usr/bin','/bin'].join(':'), ...extra }, encoding:'utf8' })`.
  This is a clean env: no inherited `CLAUDE_CONFIG_DIR` and no real `claude`.
- Tests, mirroring CRITERIA:
  - C2:
    - `mods status` and `--json` from a non-project cwd exit 0, list the 8 features off with
      their kinds, and have `claude`, `plugin` and per-feature `canTakeEffect`/`why`.
    - `mods status blindfold` covers only that feature.
    - With no config file, the file still does not exist afterwards. With `{"agent_tools":{}}`,
      all are off and the bytes are unchanged.
    - `--switches-only` prints `{switches, warnings}` and the stub log stays empty.
  - C3: the enable/disable sequence. Sibling keys are deep-equal, the "not built yet" line is
    printed, and `{oops` stays hash-identical.
  - C4: `enable blindfolds`, `disable nope` and `status nope` each exit non-zero with `✖` and
    the valid names. The hash is unchanged, and the stub log has no `plugin`.
  - C5:
    - OLD stub (`2.1.287`): `enable blindfold` exits 0 with exactly one stderr/stdout line
      matching `2.1.292`, no `plugin` in the log, and status `on` with `canTakeEffect:false`.
    - `enable canon-guard` prints no floor line.
    - With PATH `[emptyDir,'/usr/bin','/bin']` (assert that `claude` is not resolvable there,
      else skip): `enable witness` says Claude Code-only / not found, exits 0, records the
      switch, and creates no `$T/.astro/code`. `status --json` reports `claude.found:false`.
  - C6 (stub ≥ floor): `enable blindfold` → the log has `marketplace add <T>/.astro/code/mods`
    and `install astro-mods@astro-code`. `enable witness` → no second install. Disabling both
    → no `uninstall` / `marketplace remove`. Status reports the plugin installed.
  - C7: a foreign `astro-code` marketplace is pre-seeded in the stub state → `enable blindfold`
    exits 1 with a `fix:` line, the stub state still points at the foreign path, and status
    shows the switch on with `canTakeEffect:false`.
  - C10: `$T/.claude/.jean-claude/profiles.json` with profile `p2`
    (`mkdir $T/.claude $T/p2`) → the plugin is installed in both stub states. With
    `CLAUDE_STUB_FAIL_INSTALL=1`, no dir is left with the marketplace but without the plugin.
  - ADR-029: `mods enable blindfold --nope` exits non-zero and writes nothing.

### t6 — RED: install / update / uninstall lifecycle tests
- **file:** `tests/mods_lifecycle.test.mjs` (new)
- **depends_on:** t5
- Same clean-env spawn and stub as t5 (static import of the existing fixture). This task tests
  P4.
- `ac install`, stub at the floor:
  - exit 0;
  - exactly one stdout line matching `ac mods enable`;
  - `$T/.astro/code/mods/.claude-plugin/marketplace.json` and
    `…/mods/astro-mods/.claude-plugin/plugin.json` exist;
  - no `plugin` in the log;
  - no `mods` key turned on.
- The same with the OLD stub and with the no-claude PATH: exit 0, and no offer line.
- Re-install after planting `$T/.astro/code/mods/stale.txt` → it is gone (the P4 rm).
- `ac update <clone>`:
  - Reuse `hooks-update.test.mjs`'s bare-remote + clone + stub `npm` pattern.
  - Case A (plugin not installed): no `plugin update`/`install`.
  - Case B (`mods enable blindfold` first): the log has `plugin update astro-mods@astro-code -y --json`.
- `ac uninstall` after case B:
  - the log has `plugin uninstall astro-mods@astro-code` BEFORE `plugin marketplace remove astro-code`;
  - the stub state for each dir has neither;
  - with a foreign `astro-code` marketplace seeded in a second profile, that one is untouched.
- `ac uninstall` with the no-claude PATH: exit 0, the home is deleted, and no error.

### t7 — `lib/mods.mjs`
- **file:** `lib/mods.mjs` (new)
- **depends_on:** t4
- Implement P1 and P2. Use `configTargets` from `./hosts/claude.mjs`, read at call time
  through the default parameter.
- The header comment, in the house voice, covers:
  - why the switches live per user in `~/.astro/config.json` and not in `userConfig`;
  - why the default dir drops `CLAUDE_CONFIG_DIR`;
  - why `ac` compares the marketplace path itself (F2 silent re-point);
  - why a failed install rolls back its own marketplace add;
  - why `--switches-only` exists (the hot path in phases 37/38: no `claude` spawn);
  - that a read never writes.
- `node --test tests/mods.test.mjs` → green.

### t8 — `ac mods` CLI case
- **file:** `bin/ac.mjs`
- **depends_on:** t5, t7
- Implement P3. Import from `../lib/mods.mjs`. Keep the case thin: rendering only, with the
  logic in `lib`.
- `node --test tests/mods_cli.test.mjs tests/flags.test.mjs tests/cli.test.mjs` → green.

### t9 — Ship and wire the marketplace: install copy, install offer, update refresh, uninstall removal
- **file:** `lib/install.mjs`, `bin/ac.mjs`, `package.json`
- **depends_on:** t6, t8, t10
- Implement P4, with a comment on why uninstall removes the plugin before deleting the home.
- `node --test tests/mods_lifecycle.test.mjs tests/install.test.mjs tests/hooks-update.test.mjs tests/agent_tools.test.mjs tests/install_cursor.test.mjs tests/challenge.test.mjs` → green.
  Those suites already isolate PATH, so they never reach a real `claude`. If one does not, pin
  its PATH in this task and add that file to this task's list.

### t10 — Marketplace and plugin manifests
- **file:** `mods/.claude-plugin/marketplace.json`, `mods/astro-mods/.claude-plugin/plugin.json`, `mods/astro-mods/package.json`
- **depends_on:** —
- These are the P5 manifests, with no hooks yet: a hook-less plugin is valid on its own, which
  keeps the boundary green.
- If `claude` is on PATH, run `claude plugin validate --strict mods` and
  `claude plugin validate --strict mods/astro-mods` with a temp `CLAUDE_CONFIG_DIR`. Both
  exit 0.

### t11 — RED: plugin skeleton tests (fail-open driver + live validate/test)
- **file:** `tests/mods_plugin.test.mjs` (new)
- **depends_on:** t3
- Reach `register.js` only through
  `await import('../mods/astro-mods/hooks/register.js?<unique>')`. The unique query resets the
  module-level `told` and switch state per test.
- The engine is a small in-test simulator:
  - `on(name, hook)` records the hook and returns `{ catch(h) {…} }`.
  - `invoke(name, e)` runs the hook with a 10 s budget. On a throw, rejection or overrun it
    calls the recorded catch handler with `next` augmented by `error` and `called`.
  - `$` = `{ process: { run }, ui: { toast } }`, with recorders. `run` honours `timeoutMs` by
    rejecting.
- Event objects use the `session.start` shape recorded in PROBE.md.
- Tests:
  - (a) Switches all off (`run` → `{exitCode:0, stdout: JSON {switches:{…false}}}`): every
    registered handler resolves to exactly `next(e)`'s value, and no deny, rewrite or toast
    happens.
  - Only `session.start` is registered in this phase.
  - (b) `run` rejects as for a missing command.
  - (c) exit 1.
  - (c') non-JSON stdout.
  - (d) `run` never settles before `timeoutMs`.
  - For (b)–(d): pass-through within the bound, no escaping rejection, and across 3
    `session.start` invocations in one module instance exactly one toast.
  - (e) `blindfold:true` → still pass-through.
  - The argv `run` received is exactly `['ac','mods','status','--json','--switches-only']`.
- Live tests, `{ skip }` unless `claude` resolves and `claude --version` ≥ 2.1.292, each in a
  temp `HOME` and `CLAUDE_CONFIG_DIR`:
  - `claude plugin validate --strict mods`, `… mods/astro-mods` and `… scripts/mods-probe`
    exit 0;
  - `claude plugin test mods/astro-mods` exits 0.
- A static check: `register.js` and its modules (scanned by regex) reference no `e.<field>`
  that PROBE.md does not list as observed. With P5 this is none.

### t12 — Plugin skeleton: register, switches, fail-open, engine test
- **file:** `mods/astro-mods/hooks/hooks.json`, `mods/astro-mods/hooks/register.js`, `mods/astro-mods/hooks/lib/switches.js`, `mods/astro-mods/hooks/lib/failopen.js`, `mods/astro-mods/hooks/register.test.tsx`
- **depends_on:** t3, t10, t11
- Implement P5. Any typed assumption beyond F3 must match PROBE.md.
- No semicolon or style rule is imposed beyond the house voice: comments explain rule (c), the
  `.catch` fail-open and the feature convention.
- `node --test tests/mods_plugin.test.mjs` → green. If `claude` ≥ floor, also run
  `claude plugin validate --strict mods/astro-mods`, `… mods` and
  `claude plugin test mods/astro-mods` (temp `CLAUDE_CONFIG_DIR`).

### t13 — Parity guard: no command or agent depends on a mod
- **file:** `tests/hosts.test.mjs`
- **depends_on:** t7
- Add a documented matcher, `modDependency(line)`, near the top of the file.
  - A line is a dependency when it matches `/astro-mods|\bac mods\b/`, or
    `/\b(<8 names from FEATURES, via await import)\b[ -]mod\b/`.
  - It is exempt when the same line matches
    `/\b(optional(ly)?|if installed|if enabled|when enabled)\b/i`.
  - The line is the sentence unit, and the header comment says so. Bare feature words
    ("witness", "blindfold") are deliberately NOT matched, because they are common English.
- Test 1: every `commands/*.md` and `agents/*.md` (read like `readCommand` / `readAgent`) has
  no dependency line. On failure, list `file:line`.
- Test 2 (negative fixtures, in-memory):
  - ``Run `ac mods enable blindfold` before continuing.`` → flagged.
  - `Requires the astro-mods plugin.` → flagged.
  - ``Optionally, on Claude Code, `ac mods enable blindfold` can enforce this.`` → not flagged.
- `node --test tests/hosts.test.mjs` → green.

### t14 — MANUAL + ARCHITECTURE document astro-mods
- **file:** `MANUAL.md`, `ARCHITECTURE.md`
- **depends_on:** t1
- MANUAL gets a new section, "Enforcement mods (optional, Claude Code)", next to the
  `agent-tools` section. It covers:
  - what mods are and that they are off by default, citing the ADR id from t1;
  - the 8 features with kind and landing phase, all "not built yet";
  - `ac mods status|enable|disable`, `--json`, and the `mods` key in `~/.astro/config.json`;
  - the 2.1.292 floor, and that a lower or absent Claude records the switch only;
  - that the first mod install adds the `astro-code` marketplace + plugin to every Claude
    config dir;
  - the collision fix line;
  - `ac update` / `ac uninstall` behaviour;
  - `/reload-plugins` to pick up a change.
- ARCHITECTURE gets one short paragraph:
  - `mods/` is a local marketplace copied to `~/.astro/code/mods`;
  - `lib/mods.mjs` is the only writer of the switches;
  - the plugin reads them through `ac`;
  - `scripts/mods-probe/` is a dev-only probe.
- No command or agent body is touched (C14).

### t15 — Final gate + live lifecycle record
- **file:** `.astrocode/phases/36-astro-mods-foundation-adr-api-probe/PROBE.md`
- **depends_on:** t1, t3, t9, t12, t13, t14
- Run these, all in scratch dirs, never the real `~/.astro` or `~/.claude`:
  1. `node --test tests/` → 0 failures.
  2. The same with the NO-CLAUDE PATH (`$(dirname $(command -v node)):/usr/bin:/bin`, after
     confirming `command -v claude` is empty under it) → 0 failures, live tests reported as
     skipped.
  3. CRITERIA's sandbox recipe, by hand, with the logging wrapper around the real `claude`
     (≥ 2.1.292): C2, C3, C4, C5 (OLD stub + NO-CLAUDE), C6, C7, C8, C9 (local `git clone` of
     this branch) and C10 (jean-claude `p2`). Also `claude plugin validate`/`test` for C11 and
     the probe validate for C13.
  4. C14 mutations in a `cp -r` copy: the command sentence and the agent sentence fail the
     suite, and the optional sentence passes.
  5. C15: a fresh `git clone` of the branch with no `node_modules` gives `node --test tests/`
     green and zero deps in `package.json`.
- Append a `## Live lifecycle check` section to PROBE.md: the version, the per-criterion
  outcome in one line each, and the CLAUDE_CONFIG_DIR fan-out observation for C10.
- A failure is fixed here only if the fix is in this task's file. Otherwise stop and report
  it with the owning task id.

## Wave shape

| wave | tasks |
| --- | --- |
| 1 | t1, t2, t4, t5, t10 |
| 2 | t3, t6, t7, t14 |
| 3 | t8, t11, t13 |
| 4 | t9, t12 |
| 5 | t15 |

Rule checks:
- **Test-first (ADR-018).**
  - t4, t5, t6 and t11 are RED.
  - t4 and t11 reach every new symbol only via `await import(...)` in async bodies.
  - t5 and t6 are subprocess-only. The only static import is t5's own fixture, created in t5,
    which t6 depends on.
  - t13 is test-in-task, and it depends on t7 because its dynamic `FEATURES` import must
    resolve.
  - Green order: t7 ← t4, t8 ← t5, t9 ← t6, t12 ← t11.
- **Wave-green (ADR-020).** There is no deletion or rename anywhere.
  - Every new module is additive.
  - t10's manifests form a valid hook-less plugin. `hooks.json` arrives only with
    `register.js` (t12).
  - `installClaude` copies `mods/` only if present (`copyTree` returns false otherwise).
  - `bin/ac.mjs` imports `lib/mods.mjs` only from t8 on, after t7 exists.
- **One owner per file per wave.**
  - `bin/ac.mjs`: t8 → t9 (t9 depends on t8).
  - `PROBE.md` and `scripts/mods-probe/**`: t2 → t3 → t15.
  - `mods/astro-mods/**`: the t10 manifests and the t12 hooks are disjoint files, and t12
    depends on t10 anyway.
  - Every other file has exactly one owning task: `lib/mods.mjs` t7, `lib/install.mjs` and
    `package.json` t9, `tests/hosts.test.mjs` t13, the docs t14, the decision files t1.
- **Every task declares its files and lands a stamped commit.** The gate is folded into t15,
  which commits the PROBE.md lifecycle section. No task is `commits: none`.
