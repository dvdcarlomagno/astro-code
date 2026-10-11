# Plan — phase 43: phase-band mod (band with next-command buttons, id autocomplete)

This plan follows:
- `.astrocode/CONVENTIONS.md`:
  - ESM only, zero dependencies, named exports only;
  - `node:test` against a real fs and real git;
  - comments that are dense and say why.
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-018: RED tests use `await import`;
  - ADR-020: every wave boundary is green;
  - ADR-021: CRITERIA.md is the bar;
  - ADR-071 (a)–(e) and its file-type exception (plugin modules are `.js`, the ONE engine test is `register.test.tsx`);
  - ADR-033 and ADR-074: buttons fill, never submit.
- This phase's `CONTEXT.md`, decisions 1–5 and out-of-scope.

It aims at `CRITERIA.md` C1–C10.

**Test-first choice.** Every behaviour task is test-first **within the task**: write the test, watch it fail, implement, then green. No wave boundary carries a red test. New modules reach tests only through `await import(...)` inside async test bodies (ADR-018). t7 is test-after by design: an engine scenario suite over t6's wiring, with `depends_on: [t6]`.

Principles brief (`--stage plan --by planner`), applied:
- `state-each-rule-in-exactly-one-place-9173`:
  - The primary next command is the EXISTING `nextAction(readContext(root))` in `hooks/_astro-ctx.mjs`, which the SessionStart banner already prints. `ac status --json` returns it verbatim, and the mod never re-derives it.
  - Freshness of the activity line reuses `readContext`'s `ACTIVITY_TTL_SECONDS`.
  - Open debt, backlog and fix filtering stays in the existing `ac … list --json` commands.
- `for-in-app-notifications-prefer-a-quiet-dffe`: zero toasts, one quiet line when idle.
- `optional-or-auxiliary-capabilities-b940`: when `ac` fails, one dim line names the reason. It never throws.
- `keep-tooling-deterministic-and-leave-333f`: no text scraping. The phase data is a new `--json`, and sibling rules are a pure function.

## Facts settled during planning (static; t5 confirms the live part)

- **F1 — `ac status` has no JSON.**
  - `bin/ac.mjs:1698` prints text only, and `--json` is ignored.
  - It reads the registry (git fetch, about 3 s).
  - `ac roadmap` prints raw `roadmap.json`, with no planned/discussed flags and no recommendation.
  - So t2 adds `ac status --json`, which **skips the registry read**.
- **F2 — the next-step rule already exists once.**
  - Primary: `hooks/_astro-ctx.mjs` `nextAction(ctx)` over `readContext(root, now)`.
    - The current phase is `state.active_phase`, else the lowest non-complete phase.
    - pending: planned → execute, discussed → plan, otherwise discuss.
    - executing → execute; verified → accept; rejected → plan; otherwise `/astro-status`.
  - Pinned by `tests/statusline.test.mjs:133`.
  - `lib/stats.mjs` and `lib/statuslinegauges.mjs` already import from `hooks/_astro-ctx.mjs`, so `lib/` may too.
  - `hooks/_astro-ctx.mjs` is **not edited**: the statusline must stay byte-identical (C10).
- **F3 — list sources (verified by running them).**
  - `ac debt list --json`, `ac backlog list --json` and `ac fix list --json` already return only open items, as `[{id,title,status,…}]`.
  - The band offers exactly what they return and does no filtering of its own.
- **F4 — host API (typings `/tmp/claude-1001/bundled-skills/2.1.292/*/plugin-authoring/types/claude-code.d.ts`, `reference.md`).**
  - **Render:** `on('ui.render', { component: 'AbovePrompt' }, fn)`.
    - Props: `hasSurvey` (yield to it), `isWorking`, `maxRows`, `bodyColumns`.
    - Elements come from `$.ui.resolve(e)`, and `h` is the JSX factory global.
    - A render hook never writes, so data is fetched outside render. `$.ui.invalidate('ui.render')` redraws.
  - **`$.prompt.fill({ text, mode })`:**
    - It resolves `{ isFilled, refusal? }`. The engine sets origin, and it never submits.
    - `$.process.run(argv, { cwd, timeoutMs })`.
    - `$.fs.stat(path)` exists.
  - **`prompt.autocomplete`:**
    - Input `{ text, cursor, token, start }`, result `{ suggestions: [{ text, label?, description? }] }`.
    - `text` replaces the token and must be non-empty.
- **F5 — validator (phase 36 F3).**
  - Every registration is a literal `on('<event>', …, fn).catch(failOpen)`.
  - `$` is followed only into functions declared in the same file, so every `$.…` call lives in `hooks/features/phase-band.js`. `hooks/lib/*.js` helpers take results and never touch `$`.
- **F6 — the band must not throw on an `ac` failure.**
  - `failOpen` resets **every** switch.
  - A flaky `ac` read for the band must not switch off witness or blindfold for the session.
  - So band refreshes catch internally and set an `unavailable` reason. `.catch(failOpen)` stays as the registration backstop for genuine hook bugs.
- **F7 — `$.agent.list()` and workflow agents.**
  - The typings (phase 40 PLAN S3) say a workflow's agents are not listed.
  - That is documentation, not observation. C1 needs a live run, which is t5.
  - t6 implements whichever branch t5 records.

## `ac status --json` contract (t2 produces it; t3, t6 and t7 consume it)

```json
{
  "root": "/abs/project",
  "project": "name",
  "milestone": 12,
  "phase": { "number": 38, "slug": "38-…", "name": "…", "status": "pending" },
  "next": "/astro-execute 38",
  "siblings": ["/astro-discuss 44"],
  "phases": [{ "number": 38, "name": "…", "slug": "…", "status": "pending", "planned": true, "discussed": true }],
  "activity": "⚙ executing"
}
```

- `phase` is `null` when there is no current phase.
- `next` is `nextAction(readContext(root, now))` **verbatim**.
- `siblings` comes from `lib/nextstep.mjs`.
- `phases` is in number order:
  - `planned` is `isPhasePlanned`;
  - `discussed` is `phaseContextStatus === 'ready'`.
- `activity` is `readContext`'s fresh activity text, or `null`.
- Exit code 0. Outside a project, `root()` dies non-zero, as today.

## Tasks

### t1 — Probe instrumentation: `$.agent.list()` snapshots and the autocomplete input
- **id:** t1
- **file:** `scripts/mods-probe/hooks/probe.js`
- **depends_on:** []
- **What to add:**
  - On `agent.spawn` and on `turn.complete`: log a `$.agent.list()` snapshot as rows of `{id, type, status, parentId, name}`, alongside the event's `subagentType`, `workflow` and `agentId`.
    - Cut descriptions the way the existing fields are cut.
    - Wrap the call in try/catch and log a failure as `{listError}`.
  - A `prompt.autocomplete` hook that logs `{text, cursor, token, start}` and passes through. It shows whether slash commands arrive bare or namespaced.
  - A `prompt.fill` hook (observer) that logs `origin` and `mode`, and passes through.
- **If phase 40 t1 has already landed the agent.spawn snapshot,** keep it and add only what is missing. Do not duplicate it.
- **Rules the edit must keep:**
  - Every registration stays a literal `on('<event>', fn).catch(pass)`.
  - `$` is never handed to an import.
  - Redaction is unchanged.
- **Gate:** `claude plugin validate --strict scripts/mods-probe` exits 0. Use `host` if the container has no `claude`, and report it.
- **Commit:** `chore(mods-probe): agent.list snapshots and autocomplete input for phase 43 (phase 43 t1)`.

### t2 — `ac status --json` and a `Next:` line, from the existing next-step rule
- **id:** t2
- **file:** `lib/nextstep.mjs` (new), `bin/ac.mjs`, `tests/status_json.test.mjs` (new)
- **depends_on:** []
- **Test first, in `tests/status_json.test.mjs`.**
  - Setup: a scratch project, the `tests/flags.test.mjs` way (`initPlanning`, `addPhase`, `setPhaseStatus`, real git, no origin remote). Reach `lib/nextstep.mjs` through `await import` (ADR-018). The CLI is spawned with `node bin/ac.mjs`.
  - (a) `ac status --json` exits 0, prints parseable JSON with exactly the contract's keys, and `next === nextAction(readContext(root, now))`. Import those two statically from `hooks/_astro-ctx.mjs`, which already exists.
  - (b) It moves with real state across these states, each matching `nextAction`:
    - undiscussed;
    - a ready CONTEXT.md;
    - a PLAN.md;
    - `setPhaseStatus` to `executing`, then `verified`, then `complete`.
  - (c) `siblings`:
    - at most 2;
    - none equals `next`, and no duplicates;
    - every entry passes `admits(phase, verb)`;
    - every entry names an existing phase number, never a slug.
  - (d) Pure `siblingCommands(ctxPhases, next)` cases:
    - **pipeline feed (astro-status.md 3b):** when `next` is `execute N` or `accept N`, the first non-complete phase numbered after N that is pending and unplanned gets `/astro-discuss M` if undiscussed, `/astro-plan M` if discussed;
    - **waiting human gate:** the lowest `verified` phase other than N gets `/astro-accept K`;
    - none when `next` is `/astro-status`;
    - empty phases;
    - several mid-flight phases;
    - a rejected phase.
  - (e) `admits(phase, verb)`:
    - discuss and plan: `pending` or `rejected`;
    - execute: (`pending` and `planned`) or `executing`;
    - verify: `executing`;
    - accept: `verified` only.
  - (f) Outside a project, `ac status --json` exits non-zero.
  - (g) Text `ac status` prints one `Next:` line carrying `next`, plus siblings as `(also …)` when there are any. Existing `ac status` regexes in other tests stay green.
  - (h) `--json` does not read the registry: it succeeds in a project with an unreachable origin and prints no registry text.
- **Then implement.**
  - **`lib/nextstep.mjs`.** Named exports `admits`, `siblingCommands` and `statusJson(root, nowSeconds)`.
    - `statusJson` builds the contract from `readContext` and `nextAction`, imported from `../hooks/_astro-ctx.mjs` (never copied), plus `loadRoadmap`, `isPhasePlanned` and `phaseContextStatus`.
    - Header comment: the primary rule lives in `nextAction` (the one place); this module adds only siblings and admissibility.
  - **`bin/ac.mjs` `case 'status'`.**
    - If `flags.json`: print `json(statusJson(r, now))` and return before `readRegistry`.
    - In text mode, add the `Next:` line just before `Phases:`.
  - **Do not touch** `hooks/_astro-ctx.mjs` or `commands/astro-status.md`.
- **Gate:** `node --test tests/status_json.test.mjs tests/statusline.test.mjs tests/cli.test.mjs` is green.
- **Commit:** `feat(status): ac status --json and a Next line from the existing next-step rule (phase 43 t2)`.

### t3 — Band view model: pure helpers for parsing, root walk, freshness and the drawn lines/buttons
- **id:** t3
- **file:** `mods/astro-mods/hooks/lib/band.js` (new), `tests/mods_phase_band.test.mjs` (new)
- **depends_on:** []
- **Test first, in `tests/mods_phase_band.test.mjs`.** Every symbol arrives through `await import('../mods/astro-mods/hooks/lib/band.js')` inside the test. Fixtures follow the contract above, with no fs access in the module.
- **`readJsonResult(ran)`.**
  - It returns the parsed value, or `null`, for each of these: exit ≠ 0, non-JSON, truncated JSON, `isStdoutTruncated`, or a non-object result.
  - It never throws.
- **`rootCandidates(cwd)`** lists `cwd/.astrocode`, then each parent's, up to `/`. It is pure path math; phase-band.js stats them.
- **`signature(stats)`.** It builds a stable string from `[{path, mtimeMs|null}]`.
  - It changes when any mtime changes, and it ignores order.
  - `stalePaths(root, status)` lists what to stat: `.astrocode/{state,roadmap,debt,backlog,fixes}.json`, plus `.astrocode/phases/<slug>` for each non-complete phase. Nothing outside `.astrocode/` is included (C6).
- **`bandView(status, live, { unavailable })`** returns `{ lines: string[], buttons: [{ key, label, command }] }`.
  - **Buttons:**
    - `next` first, then `siblings`, at most 3 in total;
    - only commands matching `^/astro-(discuss|plan|execute|verify|accept) \d+$`;
    - `label` is like `Execute 38`, and `command` is the exact string;
    - de-duplicated.
  - **Idle** gives exactly one line, `M<n> · P<n> <status>`, plus the activity when present.
  - **Live** (see `live` below) gives the idle line plus one line per agent `name — running|done|failed`. When `live.agents === null` it gives one line saying workflow agents are not individually visible, then the `activity` text and the source label.
  - **`unavailable`** gives exactly one dim line, `astro-code status unavailable (<reason ≤ 60 chars>)`, and no buttons.
  - **`status == null` and not unavailable** gives nothing at all: no lines, no buttons.
  - `live` is the normalized `{ live: boolean, agents: [{name, state}] | null, source: 'agent.list' | 'activity' }`. The view never guesses a wave shape.
- **`liveFrom(agentRows, activity, workflowAgentsListed)`.** It normalizes `$.agent.list()` rows to `{name, state}`.
  - Only `astro-executor` and `astro-verifier` count.
  - A status maps to running, done or failed; an unknown status reads as running.
  - `live` is true if any such row is running, or if `activity` is non-null.
  - When `workflowAgentsListed` is false, the result keeps any Agent-tool rows, sets `agents: null` if there are none, and uses source `activity`.
- **Module header:** why no `$` here (F5); why `null` and never a throw (F6).
- **Gate:** `node --test tests/mods_phase_band.test.mjs` is green.
- **Commit:** `feat(mods): phase-band view model, freshness signature and fail-soft parsing (phase 43 t3)`.

### t4 — Autocomplete matcher: pure command detection and row building
- **id:** t4
- **file:** `mods/astro-mods/hooks/lib/complete.js` (new), `tests/mods_phase_band_complete.test.mjs` (new)
- **depends_on:** []
- **Test first,** through `await import('../mods/astro-mods/hooks/lib/complete.js')`.
- **`commandSource(text, start)`.**
  - It reads `text.slice(0, start)` and matches the whole command token, with an optional `<ns>:` prefix allowed (t5 records which form arrives).
  - Matches:
    - `/astro-(discuss|plan|execute|verify|accept)` followed by whitespace gives `phases`;
    - `/astro-debt-pay` followed by whitespace gives `debt`;
    - `/astro-backlog-promote` followed by whitespace gives `backlog`;
    - `/astro-fix-accept` followed by whitespace gives `fix`.
  - Everything else gives `null`. Required negatives:
    - `/astro-fix `;
    - `/astro-debt `;
    - `/astro-status `;
    - `/other 4`;
    - plain text;
    - no space after the command (`/astro-plan`);
    - a second argument (`/astro-plan 4 x`).
  - Multiple spaces after the command are fine.
- **`completionRows(source, data, token)`.**
  - **phases:** one row per phase, in number order, with `text: String(number)`. The label is the name cut to 40 characters. `description` is the `status` exactly as `ac` reports it, plus ` · planned` or ` · discussed` when true. The number is never a slug.
  - **debt:** `text: id`, `label: title` cut to 48, `description: cost`.
  - **backlog:** `text: id`, `label: title` cut to 48.
  - **fix:** `text: id`, `label: title` cut to 48, `description: status`.
  - Rows are filtered by `token` as an id prefix; an empty token keeps all.
  - `data` that is `null`, non-array or malformed gives `[]`. A row with an empty `text` is dropped. It never throws.
- **Gate:** `node --test tests/mods_phase_band_complete.test.mjs` is green.
- **Commit:** `feat(mods): phase-band autocomplete matcher and rows (phase 43 t4)`.

### t5 — Live probe on Claude Code ≥ 2.1.292: what the band can see of an /astro-execute run
- **id:** t5
- **file:** `.astrocode/phases/43-phase-band-mod-phase-band-with-next/PROBE.md` (new)
- **depends_on:** [t1]
- **Setup, the phase-36 and phase-40 way.**
  - A scratch dir from `mktemp -d`, outside the repo, with a throwaway `HOME`. Nothing in it is committed.
  - `git init`, `ac init`, then one phase whose PLAN has ≥ 3 independent tasks on distinct files.
  - Load the probe with `claude --plugin-dir <repo>/scripts/mods-probe` and `ASTRO_MODS_PROBE_LOG` set.
  - Record `claude --version`, which must be ≥ 2.1.292.
- **Runs:**
  - **R1:** `/astro-execute 1` through the Workflow tool, under `-p`. This records `agent.spawn` events (`subagentType`, `workflow.runId`) and the `$.agent.list()` snapshots taken at those spawns and at `turn.complete`.
  - **R2:** one Agent-tool `astro-executor` spawn. This records what `$.agent.list()` shows for it, including `status` values over its life.
  - **R3, if an interactive session is reachable** (phase-36 run 3 did it):
    - type `/astro-plan ` and record the `prompt.autocomplete` input, bare or namespaced;
    - record whether a `prompt.fill`, then a human Enter, gives `prompt.submit` `origin.kind === 'composer'`.
    If no interactive session is reachable, write `not observed` and point to ACCEPTANCE item 3. Never infer it.
- **Write PROBE.md** dense and machine-read: a runs table with commands, and separate "observed (with example value)" and "documented (typings)" columns.
- **Verdict line, exactly:** `workflowAgentsListed: true|false`, decided only by R1 evidence. Add the `AgentInfo.status` values seen.
- **Report every `host` command used.**
- **Commit:** `docs(phase-43): live probe of agent.list during /astro-execute (phase 43 t5)`.

### t6 — Wire the phase-band feature: hooks, registration, and the node-side plugin tests
- **id:** t6
- **file:** `mods/astro-mods/hooks/features/phase-band.js` (new), `mods/astro-mods/hooks/register.js`, `tests/mods_plugin.test.mjs`
- **depends_on:** [t2, t3, t4, t5]
- **Test first, in `tests/mods_plugin.test.mjs`.**
  - Extend `boot` so that `on(name, matcherOrHook, hook?)` records an optional matcher.
  - Replace the "registers session.start and nothing else" assertion: the registered names are now `session.start` plus phase-band's hooks. Every one has a `.catch` handler, and every one passes through untouched with every switch off. In that case `runs` holds **only** the switches read (C8b).
  - Add a source guard over `features/phase-band.js`:
    - it never mentions `prompt.submit`, `command.run`, `$.tool` or `$.state.set`;
    - every `ac` argv literal in it is a read-only query (`status --json`, `debt list --json`, `backlog list --json`, `fix list --json`) (C3).
- **`features/phase-band.js`.** Every `$.…` call is spelled here (F5); pure work goes to `lib/band.js` and `lib/complete.js`. The module-level cache is session memory only and never persisted (ADR-071 c): `{ cwd, root, interactive, status, lists, sig, unavailable, live }`. Named exports:
  - **`phaseBandStart($, e, next)` on `session.start`.**
    - It is the one deliberate exception to "open with `isOn`": it does `const r = await next(e)` first. That way the switches are read whatever order the engine chains same-plugin hooks in. Comment why.
    - Then it does `if (!isOn('phase-band')) return r`, and records `e.cwd` and `e.isInteractive`.
    - When interactive, it finds the root by `$.fs.stat` over `rootCandidates`. If there is no root, it stops: no `ac` call (C8a).
    - Then it starts a refresh.
  - **`phaseBandTurn` on `turn.start` and `turn.complete`, and `phaseBandSpawn` on `agent.spawn`.**
    - Each opens with `if (!isOn('phase-band')) return next(e)`.
    - Skip when headless or there is no root.
    - Stat `stalePaths`, then refresh **only if** `signature` changed or the last refresh failed.
    - On `agent.spawn` and `turn.complete`, also re-read `$.agent.list()` when the live source needs it.
    - Do not await. Return `next(e)`.
  - **The refresh itself.**
    - Run `$.process.run(['ac','status','--json'], { cwd: root, timeoutMs: 5000 })`, plus the three list commands, in parallel.
    - Parse each through `readJsonResult`.
    - If status is `null`, set `unavailable` with the reason (exit code, not JSON, timeout, `ac` missing).
    - Then `$.ui.invalidate('ui.render')`.
    - Everything sits in a try/catch. It never throws (F6), raises no toast, and writes no file.
  - **`phaseBandRender` on `ui.render`, matcher `{ component: 'AbovePrompt' }`.**
    - It opens with the `isOn` guard. `hasSurvey`, headless, or no root returns `next(e)`.
    - It calls `bandView(...)`. When there are no lines and no buttons, it returns `next(e)`.
    - Otherwise it builds `h(Box, …, h(Text, { dimColor }, line)…, h(Button, { key, label, onPress }))` from `$.ui.resolve(e)`.
    - `onPress` is `() => $.prompt.fill({ text: command, mode: 'replace' })` and nothing else. If the fill is refused, do nothing.
    - It makes no `ac` call and no write.
  - **`phaseBandComplete` on `prompt.autocomplete`.**
    - It opens with the `isOn` guard.
    - `commandSource(e.text, e.start)`, with no cache, returns `next(e)`.
    - Otherwise it returns `{ suggestions: [...(await next(e)).suggestions, ...completionRows(src, data, e.token)] }`.
    - It never calls `ac` (C6: no per-keystroke queries).
  - **Live source.** A constant `WORKFLOW_AGENTS_LISTED` is set from t5's verdict, with a comment citing PROBE.md. When it is false, `liveFrom` gets the `activity` fallback and the band says so in its text (C1). Never fake rows.
- **`register.js`.**
  - One line per hook, each `on('<event>', <fn>).catch(failOpen)`. The render one is `on('ui.render', { component: 'AbovePrompt' }, phaseBandRender).catch(failOpen)`.
  - Update the header's convention note (session.start exception).
  - It keeps registering its own `sessionStart` first.
- **Gates:**
  - `node --test tests/mods_plugin.test.mjs tests/mods_phase_band.test.mjs tests/mods_phase_band_complete.test.mjs` is green.
  - `claude plugin validate --strict mods/astro-mods` and `claude plugin validate --strict mods` exit 0.
  - `claude plugin test mods/astro-mods` exits 0 (the existing tests).
- **Commit:** `feat(mods): phase-band band, buttons and autocomplete wired (phase 43 t6)`.

### t7 — Engine scenarios in `register.test.tsx` (test-after, over t6)
- **id:** t7
- **file:** `mods/astro-mods/hooks/register.test.tsx`
- **depends_on:** [t6]
- **Fixtures.** Real `ac` output, byte-for-byte, captured once from a scratch project built the `tests/flags.test.mjs` way:
  - the phases are verified, planned, pending-discussed and pending-undiscussed;
  - there are 2 debt items, 2 backlog items and 1 fix.
  Paste the outputs as string constants, with a comment naming the generating commands. The `process.run` stub answers by argv, and the `fs.stat` behaviour is stubbed the same way the engine exposes it.
- **Scenarios** (the `on(...)` stubs stand for the engine):
  - **switch on, project cwd:** the band draws one idle line plus buttons; the primary fills `next` and the rest fill `siblings`.
  - **pressing each button:** exactly one `prompt.fill` with the shown command; no `prompt.submit`, no `command.run`; a filled `/astro-accept N` is plain text, with no `--agent` or `--by` (C3).
  - **autocomplete:** rows for each listed command; a partial `/astro-plan 4` narrows them; none for `/astro-status `, `/other 4` or plain text (C5).
  - **20 autocomplete calls in one turn:** the count of `ac` invocations does not grow (C6).
  - **a changed signature at `turn.start`:** the new state is drawn.
  - **`ac` exit 1, non-JSON, or rejecting at timeout:** one dim line, no buttons, no autocomplete rows, no toast, and nothing thrown. After `ac` is restored and the next turn arrives, the band recovers (C7).
  - **switch off; non-project cwd; `isInteractive: false`:** nothing drawn, no rows, no band `ac` calls (C8).
  - **live (per `WORKFLOW_AGENTS_LISTED`):** the band expands while live and collapses after (C4).
  - **zero `ui.toast` across all of it.**
- **Gate:** `claude plugin test mods/astro-mods` and `claude plugin validate --strict mods/astro-mods` exit 0.
- **Commit:** `test(mods): phase-band engine scenarios (phase 43 t7)`.

### t8 — phase-band is built: registry flag, tests, and docs
- **id:** t8
- **file:** `lib/mods.mjs`, `tests/mods.test.mjs`, `tests/mods_cli.test.mjs`, `MANUAL.md`, `ARCHITECTURE.md`
- **depends_on:** [t6]
- **Test first.**
  - In `tests/mods.test.mjs:88`, the built set becomes `['canon-guard','git-guard','phase-band']`, and the phase-band description matches `/autocomplete/`.
  - In `tests/mods_cli.test.mjs`: `ac mods enable phase-band` does not print `not built yet`; `status --json --switches-only` reads `true`; after `disable`, `false`. Profile `settings.json` files are byte-unchanged across enable/disable, because it is a mod, not a settings hook (C9).
- **`lib/mods.mjs:68`.** Set `built: true` and the description `phase band with next-command buttons and id autocomplete`. Update the `FEATURES` doc comment.
- **`MANUAL.md`.**
  - The phase-band row gets `phase 43 (built)` and the new description.
  - The "built" sentence now names three features.
  - Add a short subsection: what the band shows, that buttons only fill the composer and you press Enter, the autocomplete commands, and that it is off by default (`ac mods enable phase-band`).
  - Do **not** say any command needs it (ADR-071 b, `tests/hosts.test.mjs`).
- **`ARCHITECTURE.md`, astro-mods section.** One line: `hooks/features/phase-band.js` reads `ac status --json` and the list `--json`s, caches them in session memory keyed by the mtimes under `.astrocode/`, and fills but never submits. Point to phase 43 `PROBE.md` for the live-wave source.
- **Gate:** `node --test tests/mods.test.mjs tests/mods_cli.test.mjs tests/hosts.test.mjs` is green.
- **Commit:** `feat(mods): phase-band built (phase 43 t8)`.

### t9 — Close-out gates, recorded in PROBE.md
- **id:** t9
- **file:** `.astrocode/phases/43-phase-band-mod-phase-band-with-next/PROBE.md`
- **depends_on:** [t5, t7, t8]
- **Append a "Gates" section with counts:**
  - `node --test tests/` has 0 failures (C10).
  - `claude plugin test mods/astro-mods` exits 0, and `claude plugin validate --strict` passes on `mods`, `mods/astro-mods` and `scripts/mods-probe`.
  - **Statusline byte-identity (C10).** `git archive <phase base> | tar -x -C $S`. Feed the same input JSON, in a scratch project under a sandbox `HOME`, to `$S/hooks/astro-statusline.mjs` and to the current one. The `sha256` of each stdout is equal.
  - **In a sandbox `HOME`,** `ac mods status --json` shows phase-band `built: true`, `kind: 'mod'`, Claude-only, floor 2.1.292. Every profile's `settings.json` `sha256` is equal before enable and after disable (C9).
  - **No-persistence check (C6).** After t7's suite runs, list files under the sandbox `HOME` and the scratch project. Only `ac`-written paths changed.
- **Do not fix code here.** A failure means re-running the owning task.
- **Report every `host` command used.**
- **Commit:** `docs(phase-43): gates (phase 43 t9)`.

## Waves

| Wave | Tasks | Why grouped |
|---|---|---|
| 1 | t1, t2, t3, t4 | Their files are disjoint. |
| 2 | t5 | Needs t1. |
| 3 | t6 | Needs t2, t3, t4 and t5. |
| 4 | t7, t8 | Each needs t6. Their files are disjoint. |
| 5 | t9 | Needs t5, t7 and t8. |

## Rule checks

- **RED-import rule.**
  - t2, t3 and t4 reach their new modules only through `await import` in their test bodies.
  - t2's static imports (`hooks/_astro-ctx.mjs`, `lib/planning.mjs`, `lib/roadmap.mjs`) already exist.
  - t6 imports `isOn` from `switches.js`, which already exists, and the feature through `await plugin()`.
  - t7 is test-after (`depends_on: [t6]`).
- **Wave-green rule.**
  - Nothing is deleted or renamed.
  - t6 changes the registered-hook set, and folds the `tests/mods_plugin.test.mjs` assertion that pins it into the same task.
  - t8 flips `built` and folds every test that pins the built set into the same task.
  - Each task is test-first within itself, so no boundary carries a red test.
- **Same-file rule.**
  - `PROBE.md`: t5, then t9 (t9 depends on t5).
  - `register.js` and `tests/mods_plugin.test.mjs`: t6 only.
  - `register.test.tsx`: t7 only.
  - `bin/ac.mjs`: t2 only.
  - `lib/mods.mjs` and `MANUAL.md`: t8 only.
  - No two tasks in one wave share a file.
- **Every task declares its file(s) and commits.** There are no `commits: none` gates.
- **Out of scope, untouched:**
  - `hooks/astro-statusline.mjs`, `hooks/_astro-ctx.mjs`, and the EPIPE debt;
  - `commands/astro-status.md`;
  - Cursor and Codex UI;
  - any submit or run from a button.
