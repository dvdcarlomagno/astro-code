# Plan — phase 44: live-capture (mod: offer principle capture from human-typed prompts)

This plan follows:
- `.astrocode/CONVENTIONS.md`: zero dependencies (ADR-001), named exports only, no classes, no
  semicolons in the plugin's `.js` (match `mods/astro-mods/hooks/*`), `node:test` with a real
  fs, and dense comments that say why.
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-018: RED tests reach new symbols only by `await import`.
  - ADR-020: every wave boundary is green.
  - ADR-021: CRITERIA.md is the bar.
  - ADR-057 and ADR-058: the personal store; propose and `sight` are the only way in.
  - ADR-064: only human-typed turns are capture material.
  - ADR-071 (a)–(e): no state except in memory, off by default, fail open, no command or agent
    depends on it, plugin modules are `.js`.
  - ADR-073: Haiku is allowed.
- This phase's `CONTEXT.md`, decisions 1–8. It aims at `CRITERIA.md` C1–C12.

Principles brief (`--stage plan --by planner`), applied:
- `state-each-rule-in-exactly-one-place-9173`: `templates/principle-capture.md` gains the live
  moment (t1). The mod carries only a condensed judge rubric with a pointer comment, and a
  parity test ties its kinds, cap, ref shape and notice shape to the spec (t3).
- `keep-tooling-deterministic-and-leave-333f`: there is no word list. A Haiku judge decides
  meaning. The only deterministic filters are structural (origin, slash-command shape, length).
- `automation-may-only-propose-a-human-act-1a0d` (ADR-058): only `add --propose` and `sight`
  are ever run.
- `when-mining-conversation-history-treat-f8d0`: composer origin only.
- `for-in-app-notifications-prefer-a-quiet-dffe`: one dim `$.ui.log` line or a band count,
  never a toast.
- `optional-or-auxiliary-capabilities-b940`: fail soft, with at most one visible line per
  session.
- `enforce-critical-agent-behavior-with-a-ce7b`: the cap and the origin gate are code.
- `scans-over-personal-or-client-data-2a45`: off by default; skip prompts over a size bound.

## Facts settled during planning

Static facts, from `scripts/mods-probe/.claude-plugin/types/claude-code/index.d.ts` (2.1.292
typings) and phase-36 `PROBE.md`.

- **F1 Gate.** `PromptOrigin` is a closed set: `composer | bridge | sdk | task-notification |
  scheduled-trigger | peer | …`. Only `composer` is the user's own Enter. A typed slash command
  is observed as `command.run` (composer) followed by `prompt.submit` of the expanded text,
  also composer (PROBE). The origin alone therefore does not exclude command bodies (see D3).
- **F2 Model.** `$.model.classify(text, labels, {model})` returns a label only and takes no
  system prompt. `$.model.complete({model, prompt, system, maxTokens, effort, timeoutMs})`
  returns `{isAnswered, text}` or `{reason}`. Its `model` takes the alias `haiku`, resolved and
  allowlist-checked like `--model`; a blocked model rejects. The time of a `$` call never counts
  against the hook's 10 s budget.
- **F3 Session id.** No observed event field carries one (PROBE: `session.start` has `cwd`,
  `surface` and `isInteractive` only). `$.session.id()` (a Promise of string, "the transcript
  file's name") is the source. The mod never reads `e.sessionId`: the existing PROBE-field test
  in `tests/mods_plugin.test.mjs` forbids unobserved fields.
- **F4 Surfaces.** `$.ui.log(text)` appends one dim, system-notice-styled transcript line that
  is not sent to the model. That is the "dim one-line notice". `turn.complete`'s `{text}` is the
  assistant's answer and is never rewritten. `e.agentId` (observed) marks a subagent turn.
- **F5 Engine.**
  - `ac principles add --propose` prints `✓ principle <id> (proposed)` for a new entry, and
    `• seen again: <id> …` when an exact repeat was recorded as a sighting.
  - `match --json` gives `{exact:[{id,status}], overlap:[{id,status,shared}]}`. An overlap
    entry carries no statement, so it is read with `ac principles show <id> --json --no-sync`.
  - `lib/principles.mjs` redacts statement, why and excerpt at the single write (L98-117).
    `lib/redact.mjs` covers `sk-…`, `AKIA…`, `ghp_…` and `password=` pairs. This answers
    CONTEXT open question 2 for the store.
  - `parseArgs` takes any argv value starting with `--` as a flag, so the mod drops a
    candidate whose lifted, why or excerpt starts with `--`.
  - `Project:` is printed as `Project:   <name>` (or `?`).
- **F6 Validator.** `$` is followed only into functions declared in the same file (PROBE
  defect note). Every `$.*` call is therefore spelled in `features/live-capture.js`, including
  in same-file helpers. `$` is never passed across an import. Registrations stay the literal
  `on('<event>', fn).catch(failOpen)` (F3).

## Design decisions made here

- **D1 One judge call, not classify-then-lift.**
  - One `$.model.complete({model:'haiku', system: JUDGE_RUBRIC, prompt: <typed text as data>,
    maxTokens: 400, effort:'low', timeoutMs: 15000})` per qualifying prompt.
  - It must answer strict JSON: `{"rule":false}`, or
    `{"rule":true,"lifted":"…","kind":"…","why":"…"}`.
  - Why: `classify` cannot carry the §1/§2/§4 rubric (it has no system prompt) and cannot lift.
    One call makes the same "Haiku judges, then lifts" judgement as CONTEXT decision 2, at one
    call per prompt.
  - Validation, all deterministic:
    - JSON that does not parse is a **failure** (D7).
    - `rule:false`, an empty lifted or why, a kind outside the four, or a value starting with
      `--` means **propose nothing, silently**.
- **D2 Dedup** follows §5 exactly:
  - `match --json`;
  - `exact` → `add --propose` anyway (the engine records the sighting);
  - `overlap` only → read the statements of at most the top 3 candidates, then make a second
    Haiku `complete` call that answers `{"same":"<id>"}` or `{"same":null}`. The id is valid only
    if it is one of those candidates. A valid id → `sight <id>`; anything else → propose;
  - none → propose.
  - Never rephrase to dodge a match.
- **D3 Exclusions**, beyond origin `composer`:
  - a `command.run` arms a one-shot skip of the next `prompt.submit` within
    `COMMAND_WINDOW_MS = 5000`;
  - text whose trimmed form starts with `/` or `<` is skipped (an expanded command or a
    notification shape);
  - empty or whitespace-only text is skipped;
  - text over `MAX_PROMPT_CHARS = 4000` is skipped (cost and narrowest scope);
  - subagent turns never reach `prompt.submit` (PROBE run 1).
- **D4 Per-session state**, held in memory only (ADR-071 c):
  - fields: `proposed`, `reserved`, `shown`, `failedOnce`, `commandAt`, `project`;
  - reset by the feature's own `session.start` hook, so a new session or a plugin reload starts
    a fresh count;
  - the cap check and the `reserved++` are synchronous and adjacent, with no `await` between
    them, so concurrent prompts never exceed 3;
  - a proposal is counted only on `✓ principle … (proposed)`;
  - sightings never count;
  - after the cap, judging continues and an exact or same-overlap repeat is still sighted, but a
    would-be new proposal is dropped silently.
- **D5 After the primary effect** (§6):
  - `livePromptSubmit` awaits `next(e)`, so the prompt enters unchanged;
  - only then, and only if the result is not a `{drop}`, does it start the capture **detached**,
    with its own `.catch`;
  - it returns `next(e)`'s value untouched;
  - in-flight captures are tracked so tests can await `liveSettled()`.
- **D6 Surfacing.**
  - `liveTurnComplete` awaits `next(e)`.
  - On a main-loop turn (no `e.agentId`), when `proposed > shown` and the band did not claim the
    badges, it sets `shown = proposed` and makes one `$.ui.log(noticeText(proposed))` call.
  - `noticeText(n)` is `` `${n} proposed — /astro-principles-review` ``.
  - The count is always published to the in-memory badge registry (`hooks/lib/badges.js`).
    `phase-band` draws it and calls `claimBadges()` when it draws, so exactly one surface shows
    it: no band drawn (switch off, off-project, `-p`, band not built) means the notice.
  - Nothing is shown at zero, and there is never a toast.
- **D7 Fail open, inside the feature.**
  - Covered failures: model reject, `isAnswered:false`, unparsable JSON, `ac` missing, a nonzero
    exit, a timeout, and `$.session.id()` rejecting.
  - Each means no proposal plus, at most once per session, `$.ui.log('⚠ principle capture
    failed: <first error, ≤80 chars>')` (the §7 wording), wrapped in try/catch.
  - `failOpen` is NOT used for these: it toasts and turns every mod off.
  - The hooks themselves never throw. `.catch(failOpen)` stays only as the engine's backstop.
- **D8 Argv.**
  - Every `ac` call is `$.process.run([...], {timeoutMs: AC_TIMEOUT_MS = 10000})` with argv
    elements, never a shell string.
  - The add invocation is
    `['ac','principles','add',lifted,'--kind',kind,'--why',why,'--propose', …(project ? ['--from-project',project] : []),'--from-ref',`live ${sessionId}`,'--excerpt',text]`.
  - The project comes from `ac status`'s `Project:` line, read lazily on the first hit and cached
    per session. It is omitted when there is no line, the value is `?`, or the call fails.
  - `--from-session` is never passed.

## Test strategy (stated per ADR-018)

- **t3 is test-first.**
  - It adds a new node file that reaches `hooks/features/live-capture.js` only through
    `await import(...)` inside async test bodies.
  - It statically imports only modules that already exist: `node:*` and
    `hooks/lib/switches.js`.
  - It is RED until t5.
- **t4 is test-first** for the engine. It imports only `claude-code/testing`, which exists, and
  is RED until t6 wires the hooks.
- **t1 and t2 are test-first within the task**: write the assertion, watch it fail, then edit.
- **t7's test edits are test-after**, serialized on t6 by design. They pin the `built` flip and
  docs that only make sense once the feature is wired.

## Tasks

### t1 — The single spec names live capture as a moment
- **id:** t1
- **file:** `templates/principle-capture.md`, `tests/principle_capture.test.mjs`
- **depends_on:** []
- **Test first.** In `tests/principle_capture.test.mjs`, add tests that assert the spec:
  - names `Live capture` in §1, with `composer` in that bullet;
  - contains the evidence row text `"live <session-id>"`;
  - contains `at most **3** proposals per session`;
  - contains `N proposed — /astro-principles-review`.
  Run them and watch them fail.
- **Then edit the spec.** State each rule once; nothing elsewhere is copied.
  - **§1** gets a bullet: **Live capture (astro-mods `live-capture`, off by default)**.
    - Its gate: only a prompt the human typed at the composer (`prompt.submit` with `origin.kind`
      `composer`).
    - Never: a slash command or its expanded body, `-p`/SDK input, notifications, peer,
      scheduled or plugin prompts, assistant text or tool output.
    - A Haiku judge decides whether the prompt states a standing rule of the user's own, with no
      word list. It lifts (§2), kinds (§4) and gives the why (§3).
  - **§3** gets one sentence: live capture counts a session as one moment, at most **3**
    proposals per session.
    - Sightings do not count.
    - Each prompt yields at most one proposal, so strongest-first reduces to first-come.
    - Reaching the cap is silent.
    - A plugin reload starts a fresh count.
    - Keep every existing sentence, including the transcript-sweep exception the existing regexes
      read.
  - **§5:**
    - Add the evidence row `| Live capture | "live <session-id>" (the plugin's own session id) | the prompt as typed |`.
    - Add that `--from-project` is omitted when `ac status` names no project.
    - Extend "Elsewhere no session id reaches a command, so do not probe for one" with: live
      capture is a plugin, reads its own session id for its `--from-ref` only, and still omits
      `--from-session`. Keep the sentence the `--from-session … omitted in every moment except
      the transcript sweep` regex reads.
    - Add a one-line redaction note: the engine redacts statement, why and excerpt before they
      are written. The typed prompt reaches the Haiku judge as typed, as it already reached the
      main model.
  - **§6:** live capture starts only after `prompt.submit` passed the prompt through unchanged.
    It runs detached and never delays or alters the prompt.
  - **§7:** live capture prints no command line. Its bound:
    - one dim transcript line `N proposed — /astro-principles-review` at the first turn end
      after its session count rises, **or** the same count in the phase band when the band draws
      it, never both;
    - never a toast;
    - nothing at zero;
    - a failure gives at most one `⚠ principle capture failed: <first error>` line per session.
- **Gate:** `node --test tests/principle_capture.test.mjs tests/mine.test.mjs tests/mine_command.test.mjs tests/commands.test.mjs` is green.
- **Commit:** `docs(principles): live capture as a §1 moment in the capture spec (phase 44 t1)`.

### t2 — In-memory badge registry the band draws and live-capture feeds
- **id:** t2
- **file:** `mods/astro-mods/hooks/lib/badges.js` (new), `tests/mods_badges.test.mjs` (new)
- **depends_on:** []
- **Test first.** `tests/mods_badges.test.mjs` reaches the module by
  `await import('../mods/astro-mods/hooks/lib/badges.js')` in each body. It asserts:
  - `setBadge(name, text)` then `badges()` lists texts in insertion order;
  - `setBadge(name, undefined)` removes the entry;
  - `claimBadges()` makes `badgesClaimed()` true;
  - `resetBadges()` clears both;
  - the module source contains no `$` and imports no file.
- **Then the module.** Pure, no `$`, no fs, named exports only:
  `setBadge`, `badges`, `claimBadges`, `badgesClaimed`, `resetBadges`.
  - The header says why: two features in one plugin share a count without a file, which is the
    ADR-071 c in-memory allowance, and the claim makes exactly one surface show it.
- **Commit:** `feat(mods): in-memory badge registry for band counts (phase 44 t2)`.

### t3 — RED: live-capture node tests, the parity guard included
- **id:** t3
- **file:** `tests/mods_live_capture.test.mjs` (new)
- **depends_on:** []
- **Imports.** Static imports only `node:*` and `../mods/astro-mods/hooks/lib/switches.js`
  (`setSwitches`), which exist. The feature module comes from
  `const lc = () => import('../mods/astro-mods/hooks/features/live-capture.js')` inside bodies.
- **Harness.** A fake `$`:
  - `process.run(argv, init)`, recorded:
    - per scenario, either stubbed;
    - or REAL: `argv[0]==='ac'` → `spawnSync(process.execPath, [BIN, ...argv.slice(1)], {cwd, env:{...process.env, HOME:T}})`,
      mapped to `{exitCode, stdout, stderr, isStdoutTruncated:false, isStderrTruncated:false}`;
    - `ac mods status --json --switches-only` is never needed: switches come from `setSwitches`.
  - `model.complete(req)`, recorded and answered by the scenario;
  - `session.id()` resolves `'sess-1'` (or a scenario value);
  - `ui.log` and `ui.toast` recorders.
- **Events and setup.**
  - `next = (x) => x`.
  - Event shapes: `{text, wait:false, origin:{kind}}`, `{command, args, origin}`, and
    `{answer, …, agentId?}`.
  - The scratch project is set up as in `tests/flags.test.mjs` (`initPlanning`); the
    non-project dir is a bare `mkdtemp`.
  - Every test calls `liveSessionStart` first, and awaits `liveSettled()` before reading the
    store (`ac principles list --proposed --json` via the real CLI, HOME=T).
- **Cases (CRITERIA ref):**
  - **C1:**
    - A composer rule, with the stub answering the rule JSON, in the project gives exactly one
      proposed entry. It has the lifted statement, kind and why, source project = the
      `Project:` name, ref `live sess-1`, and the excerpt = the typed text.
    - The non-project dir also gives one entry: no project, and no `.astrocode/` created.
  - **C2:**
    - (a) plain words with the stub answering a rule → a proposal;
    - (b) "always/never/d'ora in poi usa sempre i tab" with the stub answering `{"rule":false}`
      → no add/sight argv;
    - (c) every recorded `req.model` is `haiku`.
  - **C3:** origins `sdk`, `task-notification`, `peer` and `scheduled-trigger` each cause zero
    model calls and zero `ac principles` argv; so does `command.run` followed by a composer
    `prompt.submit`; so does a `/astro-plan 4` text and a `<task-notification>` text. Store
    unchanged.
  - **C4:** with the model (a) normal, (b) never resolving, (c) taking 10 s:
    - `livePromptSubmit` resolves to the exact `e` object (`assert.equal`) in under 200 ms;
    - when `next` returns `{drop:'x'}`, no model call is made.
  - **C5:**
    - empty why, empty lifted, kind `rule`, and a lifted starting with `--` each give no add;
    - a prompt carrying `sk-ant-api03-`+40 chars, `AKIA`+16, `ghp_`+36 and `password=hunter2xyz`
      lands a proposal, and `grep`-equivalent recursive reads of `T/.astro/principles` find none
      of the four values.
  - **C6:**
    - seed S via the real `ac principles add … --propose`;
    - (a) exact lift → count unchanged, S's sightings +1;
    - (b) an overlap with the second model call answering `{"same":"<S>"}` → `sight` argv and
      S +1;
    - (c) `{"same":null}` → a new entry;
    - (d) S accepted, then (a) → still accepted;
    - over the whole file, no argv contains `accept|amend|reject|retire|reopen|merge`.
  - **C7:**
    - 5 distinct rules in one session → exactly 3 adds with `--propose` that minted entries, and
      the 4th and 5th give no add, no `ui.log`, no toast;
    - after the cap, an exact repeat still adds as a sighting;
    - sightings before the cap leave 3 slots;
    - a new `liveSessionStart` proposes again.
  - **C8:**
    - after 2 proposals, `liveTurnComplete` logs exactly one line matching
      `/^2 proposed — \/astro-principles-review$/`;
    - the next turn with no new proposal logs nothing;
    - zero proposals log nothing;
    - `agentId` set logs nothing;
    - with `claimBadges()` called (the band drew), nothing is logged and `badges()` holds the
      same text;
    - a sighting-only turn does not raise the count;
    - `ui.toast` is never called.
  - **C9:**
    - model throws, model returns non-JSON, process.run rejects (ENOENT), add exits 1, and
      process.run rejecting at timeout: each returns the prompt untouched and fast, and makes no
      partial store write;
    - three failing prompts in one session log exactly one `⚠ principle capture failed:` line;
    - a new session with things restored proposes again.
  - **C10 (off):** with `setSwitches` answering `live-capture:false`, every hook returns
    `next(e)`, with zero model calls and zero `$.process.run`.
  - **C11 parity:** read `templates/principle-capture.md`.
    - `lc().LIVE_KINDS` equals §4's `principle | pattern | preference | antipattern` list.
    - `LIVE_CAP` equals the number in `at most **N** proposals per session`.
    - The spec contains `"live <session-id>"`, and `` `${LIVE_REF_PREFIX}<session-id>` `` matches
      it.
    - `noticeText(2)` equals the spec's `N proposed — /astro-principles-review` with N=2.
    - The feature source contains no word list: no regexp literal and no array of English
      trigger words such as `always` or `never`.
  - **ADR-071 b:** no file under `commands/` or `agents/` mentions `live-capture`.
- **RED check:** run the file. Every live-capture test fails at call time with "Cannot find
  module"; the file itself loads.
- **Commit:** `test(mods): RED live-capture behaviour and spec parity (phase 44 t3)`.

### t4 — RED: engine scenarios through `claude plugin test`
- **id:** t4
- **file:** `mods/astro-mods/hooks/register.test.tsx`
- **depends_on:** []
- **What to add.** Append tests in the existing shape (`import { test, expect } from
  'claude-code/testing'`, `ran(...)`). These are hooks beneath the plugin standing for the
  engine:
  - `process.run`: switches `{'live-capture':true}` for the switches argv, and canned answers
    for `ac status`, `ac principles match … --json`, and `ac principles add …` (`✓ principle
    p-1 (proposed)`), all recorded;
  - `model.complete` recorded, answering the rule JSON;
  - `session.id` answering `'sess-1'`, if the harness raises it; if not, say so in a comment and
    assert the ref matches `/^live \S+$/`;
  - `ui.log` and `ui.toast` recorders;
  - `prompt.submit` and `turn.complete` echoing.
- **Scenarios:**
  - (i) a composer prompt resolves to the echoed prompt unchanged; after a bounded settle, one
    `model.complete` with `model:'haiku'` and an add argv carrying `--propose` and
    `--from-ref live sess-1`;
  - (ii) an `sdk` prompt → no model call;
  - (iii) `command.run` then a composer prompt → no model call;
  - (iv) after (i), `turn.complete` → exactly one `ui.log` matching
    `/^1 proposed — \/astro-principles-review$/`, and zero `ui.toast`;
  - (v) switch off → no model call and no `ac principles` argv.
- **RED check.** Run `host claude plugin test mods/astro-mods` (the container may lack
  `claude`). The new tests fail because no live hook is registered. The two existing tests
  still pass.
- **Commit:** `test(mods): RED engine scenarios for live-capture (phase 44 t4)`.

### t5 — The live-capture feature module
- **id:** t5
- **file:** `mods/astro-mods/hooks/features/live-capture.js` (new; creates `hooks/features/` if no
  earlier phase did)
- **depends_on:** [t1, t2, t3]
- **Header comment.** Say why, densely:
  - the gate (F1, D3);
  - one judge call (D1);
  - the pointer `$(ac path templates)/principle-capture.md` as the single spec, so the rubric
    below is a condensed copy guarded by the parity test, not a second source;
  - memory-only state (D4);
  - detached after `next` (D5);
  - surfacing (D6);
  - fail open without `failOpen` (D7);
  - every `$` call spelled in this file (F6).
- **Exports.**
  - Hooks: `liveSessionStart`, `liveCommandRun`, `livePromptSubmit`, `liveTurnComplete`.
  - Constants: `LIVE_KINDS`, `LIVE_CAP = 3`, `LIVE_REF_PREFIX = 'live '`.
  - `noticeText(n)` and `liveSettled()`.
- **Hook rules.**
  - Each hook opens with `if (!isOn('live-capture')) return next(e)`.
  - Exception: `liveSessionStart` resets the session memory and its own badge
    (`setBadge('live-capture', undefined)`) unconditionally, then returns `next(e)`. The comment
    says why: a reset is not a feature action and costs nothing.
- **Validation and argv:** exactly D1–D8. In particular:
  - the JSON is fence-stripped before `JSON.parse`;
  - the model input is the typed text as data in `prompt`, with the rubric in `system`;
  - the second (same?) call lists the candidate ids and statements as data;
  - `setBadge('live-capture', noticeText(proposed))` is called after each counted proposal.
- **Reads only observed event fields:** `e.origin`, `e.text`, `e.agentId`. No `e.sessionId` and
  no `e.turnId`.
- **Gate:**
  - `node --test tests/mods_live_capture.test.mjs` is green, except tests that need the
    registration (none should: t3 drives the exports directly);
  - `node --test tests/mods_badges.test.mjs tests/principle_capture.test.mjs` is green.
- **Commit:** `feat(mods): live-capture feature module (phase 44 t5)`.

### t6 — Wire live-capture into the plugin
- **id:** t6
- **file:** `mods/astro-mods/hooks/register.js`, `tests/mods_plugin.test.mjs`
- **depends_on:** [t5]
- **`register.js`:**
  - import the four hooks from `./features/live-capture.js`, and `resetBadges` from
    `./lib/badges.js`;
  - `register()` also calls `resetBadges()` (clean slate);
  - add exactly four lines, in this order after the existing session.start line:
    - `on('session.start', liveSessionStart).catch(failOpen)`
    - `on('command.run', liveCommandRun).catch(failOpen)`
    - `on('prompt.submit', livePromptSubmit).catch(failOpen)`
    - `on('turn.complete', liveTurnComplete).catch(failOpen)`
  - keep the header's convention text true.
- **`tests/mods_plugin.test.mjs`:**
  - The "registers session.start and nothing else" assertion becomes the actual list on the
    branch: the skeleton's `session.start` plus any earlier phase's hooks, plus the four above.
  - The pass-through loop invokes each hook with an event of its own shape:
    - `prompt.submit` `{text:'x', wait:false, origin:{kind:'composer'}}`;
    - `command.run` `{command:'astro-status', args:'', origin:{kind:'composer'}}`;
    - `turn.complete` `{answer:'a', reason:'answer'}`.
  - Add one test: with every switch off, invoking all four live hooks makes zero `$` calls and
    zero toasts.
  - The PROBE-field test stays unchanged and green.
- **Gate:**
  - `node --test tests/mods_plugin.test.mjs tests/mods_live_capture.test.mjs` is green;
  - `claude plugin validate --strict mods/astro-mods` and `claude plugin test mods/astro-mods`
    exit 0, via `host` if the container has no `claude`. t4's scenarios turn green here.
- **Commit:** `feat(mods): register live-capture hooks (phase 44 t6)`.

### t8 — The band draws the live count, or the contract is filed for phase 43
- **id:** t8
- **file:** `mods/astro-mods/hooks/features/phase-band.js` and its existing test file(s) when
  phase 43 has landed; otherwise `.astrocode/backlog.json` (via `ac backlog add` only)
- **depends_on:** [t2]
- **Branch on the branch state at execution.**
  - **`hooks/features/phase-band.js` exists** (phase 43 landed first, the roadmap order):
    - test first in the band's test file: when it draws, the band calls `claimBadges()` and its
      idle line contains every `badges()` text;
    - then make the edit: on draw, `claimBadges()` and append `badges().join(' · ')` to the idle
      line.
    - No other change to the band.
  - **It does not exist:**
    - run `ac backlog add "phase-band draws hooks/lib/badges.js counts and calls claimBadges() when it draws (phase 44 contract)"`;
    - commit the backlog entry;
    - report `C8(b) waits on phase 43` as its last line.
- **Commit:** `feat(mods): phase band shows live-capture count (phase 44 t8)` or
  `chore(backlog): …`.

### t7 — Flip built, document, full gate
- **id:** t7
- **file:** `lib/mods.mjs`, `tests/mods.test.mjs`, `tests/mods_cli.test.mjs`, `MANUAL.md`,
  `ARCHITECTURE.md`
- **depends_on:** [t4, t6, t8]
- **Test-after** (serialized by design).
  - In `tests/mods.test.mjs`, the built list (~L88) gains `'live-capture'` (plus whatever
    earlier phases flipped).
  - In `tests/mods_cli.test.mjs`, `ac mods enable live-capture` prints no `not built yet`,
    `status --json` shows it built, kind `mod`, off before enable; then disable it again.
  - Any test using an unbuilt example keeps using one that is still unbuilt.
- **`lib/mods.mjs`:** `live-capture` gets `built: true`, and the `FEATURES` doc comment is kept
  accurate.
- **`MANUAL.md` "Enforcement mods":**
  - the row says `phase 44 (built)`;
  - the built/not-built sentence matches the branch;
  - add a short **live-capture** section:
    - what it reads (composer-typed prompts only);
    - its cost (one Haiku call per typed prompt; that is why it is off by default);
    - privacy (the typed text goes to Haiku; the store is redacted by the engine);
    - where proposals go and how to review them (`/astro-principles-review`);
    - the 3-per-session cap;
    - the quiet count;
    - the escape (`ac mods disable live-capture`);
    - a pointer to `templates/principle-capture.md` for the rules, which are not restated.
- **`ARCHITECTURE.md`:** one sentence in the astro-mods section: features live in
  `hooks/features/`, `hooks/lib/badges.js` is the in-memory band contract, and live-capture is
  the capture moment the spec names.
- **Full gate:**
  - `node --test tests/` exits 0;
  - `claude plugin validate --strict mods/astro-mods` and `claude plugin test mods/astro-mods`
    exit 0 (via `host` if needed);
  - `grep -rn live-capture commands agents` is empty.
- **Commit:** `feat(mods): live-capture built, documented (phase 44 t7)`.

## Waves

| wave | tasks | why parallel-safe |
|---|---|---|
| 1 | t1, t2, t3, t4 | disjoint files; t3/t4 are RED by design and load cleanly (ADR-018) |
| 2 | t5, t8 | `features/live-capture.js` vs `features/phase-band.js` or the backlog |
| 3 | t6 | `register.js` and `mods_plugin.test.mjs` need t5's exports |
| 4 | t7 | the flip and docs after wiring and the band contract; final full gate |

Rule checks:
- **RED imports:** t3 and t4 import only existing modules; the feature arrives by
  `await import`.
- **Wave-green:** nothing is deleted or renamed. Each task's build loads on its own, and the new
  module has no consumer until t6, which lands with it imported.
- **Same file:**
  - `register.js` is only in t6;
  - `mods_plugin.test.mjs` is only in t6;
  - `register.test.tsx` is only in t4;
  - `features/live-capture.js` is only in t5;
  - `lib/badges.js` is only in t2;
  - the template is only in t1.
- **Every task commits;** none is verification-only.
