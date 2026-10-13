# Plan — phase 42: brief-section mod (principles brief as one cached system-prompt section)

This plan follows:
- `.astrocode/CONVENTIONS.md`:
  - Node ≥22 ESM `.mjs`, zero deps, named exports, `node:test` with a real fs, `die`/`json()`;
  - the house comment voice: module headers say why and name the bug each choice prevents.
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-018: RED tests reach new symbols only by `await import(...)` or by spawning.
  - ADR-020: every wave boundary loads and compiles.
  - ADR-021: CRITERIA.md C1–C8 is the bar.
  - ADR-057/062: the brief's content, scope and packing are untouched, and `brief` never syncs.
  - ADR-071 a–e: the mod is off by default, Claude-only, keeps no state of its own, reads only
    through `ac` and fails open. The plugin modules are `.js`, and `register.test.tsx` is the
    engine test.
- This phase's `CONTEXT.md`, decisions 1–6 and its out-of-scope list.

Principles brief (`--stage plan --by planner`). It holds no hard rules. Applied:
- `state-each-rule-in-exactly-one-place-9173`:
  - The brief text comes from `ac principles brief`.
  - The hook parts and the position line come from the SAME functions the hooks call
    (`packBrief` via a no-log sibling of `shortlist`, `renderResumeNote`, `sessionBriefEnabled`,
    `BRIEF_PARTS`), exposed by one `ac` verb.
  - The plugin reimplements none of them.
- `keep-tooling-deterministic-and-leave-333f`: an output is astro-code's only when it is
  byte-equal to what `ac` says the hook printed. No prefix, no similarity, no judgement.
- `optional-or-auxiliary-capabilities-b940`: fail soft, with one visible one-line notice.
- `enforce-critical-agent-behavior-with-a-ce7b`: the rule "suppress only when the section is
  served" is a code invariant with tests, not a comment.
- `client-side-persisted-state-must-fall-6105`: a reload, a failure or a reset falls back to
  today's hook-delivered brief.

## Stop rule (CONTEXT decision 4)

t1 is the live probe. Every other task depends on it.
- PROBE.md ends with one line in this exact form:
  - `Verdict: GO`, or
  - `Verdict: STOP — <(a)-SessionStart | (a)-PreCompact | (b)>: <one-line reason>`.
- On STOP, every later executor reads that line first, makes no change, and reports the phase
  stopped:
  - `built` stays false;
  - no hook is unregistered;
  - nothing ships that would give a duplicate brief.
- The stamp audit then fails the phase. That is the outcome CONTEXT asks for, because the goal is
  unmet.
- Up front, this plan rules that suppressing SessionStart alone, with PreCompact output left
  through, is NOT GO:
  - CONTEXT decision 3 and CRITERIA C3 both require the PreCompact output dropped.
  - The only workaround is a hook script that reads the switch. That cuts across ADR-072 and
    changes what Cursor runs, so this plan rejects it unless the user directs otherwise.

## Decisions this plan pins (executors build on these, they do not re-derive them)

- **D1 — The section.**
  - Appended through `prompt.compose`: `next(e)` resolves to `{ sections }`, and the hook returns
    `{ ...r, sections: [...r.sections, { id: 'astro-mods:brief', text, scope: 'session' }] }` as
    the LAST element. `prompt.section` cannot add a section, it only rewrites core ones.
  - One section, per CONTEXT decision 1 and CRITERIA C2. Its text is BRIEF, then `\n\n`, then the
    position line. When the position is `''`, the text is BRIEF alone.
    - Two sections would cache better, but C2 says "exactly one". The position line is the last
      line, so a real change re-sends only this one trailing section.
  - The section `text` is held in ONE module variable and returned as-is on every render. It is
    rebuilt only when the position string actually changes. This is the cache-stability rule
    (C4).
  - If t1 shows the compose result is cached until invalidated, a position change calls
    `$.ui.invalidate('prompt.compose')`, and nothing else does.
- **D2 — Reads, all through `ac`** (ADR-071 c). Three argv shapes and no others:
  - `['ac', 'principles', 'brief', '--stage', 'session', '--by', 'session']`
    - Gives BRIEF, once per `session.start`. Its stdout is trimmed, with the same trim the hooks
      apply.
  - `['ac', 'mods', 'feed', 'brief-section']`
    - Prints the JSON `{ serve, parts, position }`, once per `session.start`. The fields are
      described under D3.
  - `['ac', 'mods', 'feed', 'brief-section', '--position']`
    - Prints the JSON `{ position }`, at `turn.start` and right before the PreCompact match.
  - The calls run with `cwd` = `session.start`'s `e.cwd` (observed in phase 36), passed the way t1
    shows `$.process.run` accepts it.
  - The plugin never reads `.astrocode/`, `~/.astro/config.json` or the principle store, and
    writes nothing.
  - A per-turn `--position` call is chosen over an mtime stat, for two reasons:
    - A stat means the plugin reads `.astrocode/` itself, against ADR-071 c.
    - Finding the root is `ac`'s job.

    t1 measures the call's wall time.
- **D3 — `ac mods feed brief-section`** (new, read-only, never syncs, never logs usage).
  - `serve`: true when cwd is inside an astro-code project (`findAstroRoot`) AND
    `sessionBriefEnabled()`. That is the hooks' own #116 opt-out, so the mod honours
    `principles.sessionBrief: false` exactly as the hooks do.
  - `parts`: every non-empty part the hooks print as `additionalContext` for this cwd. These are
    `packBrief(...)` parts with `n = BRIEF_PARTS`, trimmed, computed by a new
    `sessionParts({ dir, cwd })` in `lib/retrieval.mjs`.
    - `sessionParts` shares `shortlist`'s selection through one private helper, so it can never
      drift from it.
    - It does not call `logServed`. The hooks still log their part 1 as today, and C8 forbids
      changing their output.
  - `position`: `renderResumeNote(readContext(root, now))`. This is the exact string the
    PreCompact hook puts in `systemMessage`, and it is one line naming the milestone, the phase,
    its state and `Next:`. It is `''` outside a project.
  - `--position` computes only `position` and does not open the store.
  - A failure exits non-zero, so the plugin's call fails and the plugin fails open.
  - It lives in a new `lib/modfeed.mjs` `briefSectionFeed({ cwd, home, dir, positionOnly })`, which
    imports from `hooks/_astro-ctx.mjs` (precedent: `lib/stats.mjs`, `lib/debt.mjs`).
  - In `bin/ac.mjs`, `mods feed` is dispatched before the `enable`/`disable` usage die, with
    `checkFlags('mods feed', …)` allowing `position` and `json`, and a usage line.
- **D4 — Telling astro-code's output apart.**
  - SessionStart: an entry is dropped only when it is byte-equal, after the trim, to a member of
    `parts`.
  - PreCompact: an entry is dropped only when it is byte-equal to `position`, freshly re-read
    with `--position` immediately before the match.
  - The match is never by prefix, never by similarity, and never by the event alone. The types
    expose no command name: `origin` carries only `event`, and t1 confirms this. Exact content
    is the narrowest test available either way.
  - If t1 observes that the engine wraps hook text, for example a leading label, PROBE.md records
    the exact wrapper. The match strips exactly that wrapper and nothing else.
  - The update banner and nudge travel in `systemMessage`, a different field from `parts`, so
    they are never candidates (CONTEXT decision 3).
- **D5 — Interception points.**
  - t1 picks, per output (SessionStart `additionalContext`, PreCompact output), the ONE event
    where dropping one entry is observed to remove it from what the model reads and to leave
    every other entry byte-identical.
  - Candidates, in order of preference:
    1. `classic.SessionStart` — filter `r.additionalContext[]`.
    2. `prompt.attachment` with `origin.kind === 'hook'` — `{ text: null }`.
    3. `session.append` (`door` `hook-context` / `notice`) — rewrite `content`.
  - The types say `classic.PreCompact` reads only `block`, `preventContinuation` and
    `stopReason`. So PreCompact suppression must come from candidates 2 or 3. If neither works,
    the verdict is STOP — (a)-PreCompact.
  - A hook that answers without `next(e)` never counts as suppression: it would also silence
    other users' hooks (C3).
- **D6 — State machine**, in `hooks/features/brief-section.js`. This is module state only.
  `resetBriefSection()` is called from `register()`, as `resetSwitches` is.
  - The variables: `brief`, `parts`, `position`, `section` (`null` until served), `dropped`
    (some astro output was already removed) and `told`.
  - `session.start` (a second registration, after the switches one):
    - It does `const out = await next(e)` FIRST, then its work, and returns `out`. That makes it
      correct whichever order the engine runs the two hooks in; t1 records the order.
    - If `!isOn('brief-section')`, it returns `out`.
    - It runs the feed. If `serve` is false, it sets nothing and is silent: the hooks deliver,
      or the user opted out.
    - It runs the brief. A thrown or rejected run, a non-zero exit or empty stdout makes one
      notice and no section.
    - Only after both calls succeed does it assign `brief`, `parts`, `position` and `section`,
      in one place. A half-built state is never observable (C5).
  - `served()`: `section !== null && (isOn('brief-section') || dropped)`.
    - Every other brief-section hook opens with `if (!served()) return next(e)`. That is the
      convention's guard with one documented widening: once an astro output has been dropped,
      the section stays even after `failOpen` resets the switches. Otherwise the model would be
      left with ZERO copies, the partial state CONTEXT decision 5 forbids.
  - The SessionStart filter and the PreCompact filter:
    - Call `next` first, then filter per D4.
    - Set `dropped = true` only when an entry was actually removed.
    - Run on every source (startup, resume, clear, compact).
    - An unexpected shape throws into `.catch(failOpen)`, which passes the event through (C5).
  - If t1 shows that astro output can reach the model BEFORE the plugin's `session.start` has
    served (for example `classic.SessionStart` fires first on startup), the fetch moves into
    whichever of the two fires first, using the same code path. The invariant "drop only while
    served; serve only if nothing of ours has already passed through" holds in both cases, and
    t3/t4 test both orders.
  - `turn.start`:
    - When `served()`, it runs `--position`.
    - If the result is ok and differs, it rebuilds `section` once.
    - If it fails, it keeps the last section (stale but present) and notifies once.
    - It never re-runs the brief (C4).
  - Reload: `register()` resets everything, and `session.start` fires again, so the brief is
    recomputed exactly once more.
    - Known gap: if that recompute fails, nothing is served until the next compaction re-fires
      the hooks. PROBE.md records it under the reload facts.
- **D7 — Failure and notice.**
  - The feature's own failures do NOT throw. They are caught locally, make no section, suppress
    nothing, and do not reset the other mods' switches.
  - The notice is one `$.ui.toast`, once per registration (`told`), spelled in the feature file.
    The validator never sees `$` handed to an imported helper.
  - The wording leads with the fact:
    `astro-mods: brief-section off this session (<why, ≤60 chars>) — the session hooks deliver the brief as before`.
  - Each `timeoutMs` is chosen from t1's measured `session.start` budget, so that the switches
    call plus both brief-section calls stay at least 1 s under it. An engine overrun would
    otherwise route to `failOpen` and switch every mod off.
  - Only genuine plugin bugs (a malformed event) reach `.catch(failOpen)`.
- **D8 — Untouched:**
  - every file under `hooks/` and `lib/hosts/`;
  - every `settings.json` and Cursor's `hooks.json`;
  - the brief's content, scope and packing (`lib/principlebrief.mjs`).

  `FEATURES` keeps `kind: 'mod'`, so `ac mods enable` registers no settings hook (C6).

**Test strategy, chosen explicitly:**
- Test-first for every behaviour task: t2 → t6, t3/t4 → t8, t5 → t9.
- RED files reach new symbols only via `await import(...)` inside async test bodies, or by
  spawning `ac`.
- `register.test.tsx` is RED by construction: `claude plugin test` loads the plugin at call
  time.

## Tasks

### t1 — Live probe: settle decision 4(a)/(b), event order, budgets and size; write PROBE.md with the verdict
- **file:**
  - `scripts/mods-probe/hooks/probe.js`
  - `.astrocode/phases/42-brief-section-mod-principles-brief-as/PROBE.md` (new)
- **depends_on:** —
- Extend the dev-only probe. It stays inert unless `ASTRO_MODS_PROBE_LOG` is set, and it keeps its
  redaction rules.
  - Log:
    - `classic.*`: `e` keys, plus the result's keys after `next`, with the head and length of each
      `additionalContext` entry;
    - `prompt.compose`: each section's `id`, `scope` and length;
    - `prompt.attachment`: `origin` and the head of the text;
    - `session.append`: `door`, `origin`, `message.type`/`name`/`role` and the content head;
    - `turn.start`, `session.compact` and `session.start`.
  - Add an experiment mode behind `ASTRO_MODS_PROBE_TRY=<abs json>`. The JSON names the exact
    strings to drop and the text of a section to append. In this mode the probe:
    - appends `{ id: 'mods-probe:try', scope: 'session' }` in `prompt.compose`;
    - drops exact-equal entries through each D5 candidate.
  - `claude plugin validate --strict scripts/mods-probe` must still pass.
- Run live on Claude Code ≥ 2.1.292, in a scratch project set up as in CRITERIA "Harness" (seeded
  store > 25,000 chars, so the hooks split into ≥ 3 parts):
  - Register the astro hooks through `--settings <scratch>/settings.json`, written exactly as
    `lib/hosts/claude.mjs` writes them (`partCmd`, `PRINCIPLES_HOOK`, `PRECOMPACT_HOOK`).
  - Register a FOREIGN SessionStart hook and a FOREIGN PreCompact hook alongside them. Each
    quotes one line of BRIEF.
  - Load the probe with `--plugin-dir`.
  - Never `plugin install`, and never modify the real `~/.claude` or `~/.astro`. Use a scratch
    HOME/`CLAUDE_CONFIG_DIR` holding a copied credential, or run on the host through `host`, and
    name which in PROBE.md.
  - Drive these: startup, a 2nd turn, `/compact`, `/clear`, resume, `/reload-plugins`.
- PROBE.md: mirror phase 36/38's format.
  - The header gives the version, date, method and runs table.
  - Facts are labelled F1..Fn, and anything unseen is marked "not observed". It must answer:
    - **(a) SessionStart:**
      - Which D5 event sees the hooks' `additionalContext`.
      - Whether entries arrive byte-equal to the hook's string, and any wrapper.
      - Whether any command or script name is exposed.
      - That a dropped entry is gone from what the model reads, checked in the transcript and by
        asking the model.
      - That the foreign entry and the banner `systemMessage` are unchanged.
    - **(a) PreCompact:**
      - Where `astro-precompact.mjs`'s `systemMessage` lands: model-read, or a user-only notice.
      - Which event can drop or blank exactly it while the foreign PreCompact output survives.
    - **(b):**
      - A `session`-scope section appended via `prompt.compose` reaches the model.
      - Whether it is cached: `cache_read` vs `cache_creation` input tokens on consecutive turns,
        from the transcript usage.
      - That it survives `/compact` and `/clear`.
      - Whether compose re-fires per request, and whether `$.ui.invalidate('prompt.compose')` is
        needed after a change.
    - **Order and budgets:**
      - The order of plugin `session.start` vs `classic.SessionStart` per source.
      - The order of two `session.start` registrations in one plugin.
      - Whether `classic.SessionStart` re-fires on `/reload-plugins`.
      - The `$.process.run` `cwd` option and its default.
      - The `session.start` and `turn.start` budgets.
      - The median wall time of `ac mods status --json --switches-only` and of
        `ac principles brief --stage session --by session`. The feed verb does not exist yet, so
        time `ac state get` as its stand-in.
    - **Size:** `ac principles brief --stage session --by session | wc -c` on this repo and on
      the seeded store, with tokens ≈ chars/4. Flag it in plain words if it is over ~10k tokens.
  - Then one decision line per decision, and the closing `Verdict:` line (Stop rule).
- Commit the probe changes and PROBE.md. The JSONL logs and the scratch project are never
  committed.

### t2 — RED: `ac mods feed brief-section` and `sessionParts` tests
- **file:** `tests/mods_feed.test.mjs` (new)
- **depends_on:** t1
- Set up a sandbox HOME and a scratch project, as in `tests/flags.test.mjs` (`initPlanning`, a
  milestone, `addPhase`). Seed the store so the brief exceeds 25,000 chars.
- `sessionParts` is reached by `await import('../lib/retrieval.mjs')` inside the test. The CLI is
  reached by spawning `bin/ac.mjs`.
- Assert:
  - `sessionParts` equals, element for element, the trimmed `additionalContext` of
    `hooks/astro-update.mjs` (part 1) and `hooks/astro-principles.mjs K/4` (K = 2..4), spawned
    with the sandbox HOME and a SessionStart stdin. Empty parts are omitted.
  - A brief small enough for one part gives `[BRIEF]`.
  - `sessionParts` appends nothing to `<store>/.local/usage.jsonl`.
  - `ac mods feed brief-section`:
    - exits 0 with JSON `{ serve: true, parts, position }`;
    - `parts` equals the hook outputs;
    - `position` equals the `systemMessage` of `hooks/astro-precompact.mjs` for the same project
      and contains no newline;
    - after `$AC` moves the active phase/state, `position` follows.
  - `--position` prints `{ position }` only, and succeeds with the principle store dir made
    unreadable.
  - `serve` is false outside an astro-code project, with `parts: []` and `position: ''`.
  - `serve` is false with `{"principles":{"sessionBrief":false}}` in the sandbox
    `~/.astro/config.json`.
  - An unknown flag is refused by `checkFlags`.
  - `ac mods feed nope` dies naming the feature list.
  - Running the feed writes no file under HOME or the project, other than what `ac` already
    writes. Compare a listing taken before and after.

### t3 — RED: brief-section behaviour in the node engine simulator, and the plugin-wide guards updated
- **file:** `tests/mods_plugin.test.mjs`
- **depends_on:** t1
- Extend the existing `boot()` simulator. Do not fork it.
  - `$` gains the APIs PROBE.md shows the feature uses: `ui.invalidate` if F says so, and
    `process.run` routed per argv to scripted answers.
  - `invoke` drives a hook with a supplied `next` result, to stand for the hooks beneath.
- Update `'with every switch off…'`:
  - The registered list becomes the existing `session.start` plus brief-section's hooks, in
    `register.js` order, exactly as PROBE's GO design names them.
  - Each one has a `.catch`.
  - Each one passes through with every switch off.
- Update `'no module reads an event field PROBE.md does not record'`: a field may come from
  phase 36's OR phase 42's PROBE.md (a union of the two files).
- New tests use `await import` only. With brief-section on and scripted `ac` answers (the C2–C5
  shapes):
  - **Compose:** exactly one section, with id `astro-mods:brief`, `session` scope, appended last,
    and text `BRIEF + '\n\n' + position`. The core sections are unchanged.
  - **Five turns** of `turn.start` plus compose with the same `--position` answer: the text is
    identical every time (`===` on the string). The brief argv was run once.
  - **A changed `--position` answer:** only the position line changes, and the brief was not
    re-run.
  - **Hook output:** entries equal to `parts` are dropped. A foreign entry quoting one BRIEF line
    is kept byte-identical. Order is preserved. This holds on sources startup, clear and compact.
  - **PreCompact path:** the entry equal to the refreshed `position` is dropped, and a foreign
    one is kept.
  - **Failure cases** (C5): `process.run` throws ENOENT, the brief exits 1, the brief prints
    `''`, or the call rejects at its timeout. In each case:
    - `session.start` resolves within a bound;
    - there is no section;
    - hook outputs pass through byte-identical;
    - there is exactly ONE toast across 3 turns and several hook events;
    - `isOn` of the other mods is unchanged.
  - **`serve: false`:** no section, no toast, pass-through.
  - **Switch off:** no section, and everything passes through.
  - **The invariant:** after an astro entry was dropped, a forced `failOpen` (a malformed event)
    still leaves the section served. Before any drop, the same reset removes the section, and
    later hook outputs pass through.
  - **Reload** (a fresh `boot`): the brief argv runs exactly once more.
  - **Event order:** if PROBE records the hook-output event can precede `session.start`, that
    order yields either section-and-drop or neither, never one without the other.

### t4 — RED: brief-section through the real engine (`claude plugin test`)
- **file:** `mods/astro-mods/hooks/register.test.tsx`
- **depends_on:** t1
- Keep the two existing tests. Add scenarios using the engine's own calls:
  - `$.session.start`, `$.turn.start`, `$.prompt.compose()`;
  - the hook-output event PROBE.md chose, e.g. `$.classic.SessionStart({ source, … })`, with an
    `on(<event>, …)` beneath answering HOOKS-OUT;
  - the PreCompact path PROBE.md chose.
- `on('process.run', …)` answers per argv. The switches return `{ 'brief-section': true }`.
- Assert C2–C5 in the engine:
  - one `astro-mods:brief` section;
  - the parts dropped and the foreign entry kept;
  - the same text across repeated compose calls;
  - ENOENT, exit 1 and empty stdout each give no section, pass-through, and one `ui.toast`.
- Also assert the switch-off pass-through.
- Leave it RED until t8. It runs only under `claude plugin test`.

### t5 — RED: registry and CLI say brief-section is built, and enable/disable leave every settings file alone
- **file:**
  - `tests/mods.test.mjs`
  - `tests/mods_cli.test.mjs`
- **depends_on:** t1
- `tests/mods.test.mjs:88`: the built list becomes `['canon-guard', 'git-guard', 'brief-section']`.
  `brief-section` stays `kind: 'mod'` at phase 42, and the floor stays 2.1.292.
- `tests/mods_cli.test.mjs` (sandbox, as the existing tests set it up):
  - `ac mods status brief-section` does not match `/not built yet/`. `--json` shows it `built`,
    kind `mod`.
  - `ac mods enable brief-section` exits 0, and `--switches-only` then reports `true`. After
    `disable` it reports `false`.
  - Before and after the enable/disable pair, `sha256` of every Claude profile's `settings.json`
    and of Cursor's `hooks.json` (when present) is unchanged.
  - The SessionStart and PreCompact astro entries are still registered.
  - `blindfold` still reads "not built yet".

### t6 — `sessionParts` and the brief-section feed in lib/
- **file:**
  - `lib/retrieval.mjs`
  - `lib/modfeed.mjs` (new)
- **depends_on:** t2
- `lib/retrieval.mjs`:
  - Extract `shortlist`'s selection (`projectContext` → `selectBrief`, plus `ctx` and
    `effectiveRulesOnly`) into one private helper. `shortlist` keeps byte-identical output and
    logging.
  - Add an exported `sessionParts({ dir, cwd, n })`, which returns
    `packBrief(...).parts.map(trim).filter(Boolean)` with no `logServed` and no sync.
- `lib/modfeed.mjs` `briefSectionFeed({ cwd, home, dir, positionOnly, now })` implements D3. It
  imports `findAstroRoot`, `readContext`, `renderResumeNote`, `sessionBriefEnabled` and
  `BRIEF_PARTS` from `../hooks/_astro-ctx.mjs`.
- Give it a module header in the house voice, saying why it exists: exact-match suppression needs
  the hooks' exact strings from the one place that makes them.
- Turns t2's lib assertions green.

### t7 — `ac mods feed brief-section [--position]`
- **file:** `bin/ac.mjs`
- **depends_on:** t6
- In `case 'mods'`, before the `enable`/`disable` die:
  - `sub === 'feed'`;
  - `checkFlags('mods feed', flags)` with a `'mods feed': ['json', 'position']` allowlist entry;
  - `ac mods feed nope` dies with the feature list. Only `brief-section` has a feed: any other
    feature dies `no feed for <name>`.
  - It prints `json(briefSectionFeed({ cwd: process.cwd(), positionOnly: flags.position === true }))`
    with the store dir resolved the way `principles brief` resolves it.
- Add `feed brief-section [--position]` to the `ac mods` usage string and the help line.
- Turns t2 fully green.

### t8 — The brief-section feature module and its registrations
- **file:**
  - `mods/astro-mods/hooks/features/brief-section.js` (new)
  - `mods/astro-mods/hooks/register.js`
- **depends_on:** t3, t4
- `features/brief-section.js` implements D1, D2, D4, D6 and D7.
  - It has named hook exports and `resetBriefSection()`.
  - The argv constants are exported, as `switches.js` exports `SWITCHES_ARGV`.
  - Every `$.process.run`/`$.ui.toast` is spelled inside this file's own hook functions. No `$`
    is passed to an import.
  - Reads only event fields recorded in a PROBE.md.
  - Header in the house voice: why one section, why exact match, the served/dropped invariant,
    and the reload gap.
- `register.js`:
  - `register()` also calls `resetBriefSection()`.
  - One literal line per hook, after the existing session.start line:
    `on('<event>', <fn>).catch(failOpen)`.
  - The header's "this skeleton ENFORCES NOTHING" becomes a line listing the features it
    registers.
- Turns t3 and t4 green.
- `claude plugin validate --strict mods/astro-mods` passes.

### t9 — Flip built, document, live recheck of the shipped mod, full gate
- **file:**
  - `lib/mods.mjs`
  - `MANUAL.md`
  - `ARCHITECTURE.md`
  - `CHANGELOG.md`
  - `.astrocode/phases/42-brief-section-mod-principles-brief-as/PROBE.md`
- **depends_on:** t5, t7, t8
- `lib/mods.mjs:67`: set `built: true` for brief-section, and update the `FEATURES` doc comment.
  Turns t5 green.
- `MANUAL.md:118`: the row reads as built. Add a short "brief-section" paragraph covering:
  - what it does on Claude;
  - that Cursor and Codex are unchanged;
  - the opt-out it honours;
  - `ac mods enable|disable brief-section`.
- `ARCHITECTURE.md` astro-mods section: add one paragraph on the feed verb, the exact-match
  suppression and the served/dropped invariant.
- `CHANGELOG.md`: add an entry under the next version heading, written in the existing voice,
  user-facing and leading with the change.
- Live recheck of the SHIPPED plugin, using t1's method with `--plugin-dir mods/astro-mods` and
  the switch on in the scratch HOME. Append it to PROBE.md as a "Shipped recheck" section with
  F-labels:
  - one section, holding BRIEF once;
  - no astro brief part and no PreCompact note in the model context;
  - the banner and the foreign hooks present;
  - after `/compact`, BRIEF exactly once;
  - the token size measured on the real section.
- Gate. All of these must pass, and the counts go in the commit body:
  - `node --test tests/`;
  - `claude plugin validate --strict` on `mods`, `mods/astro-mods` and `scripts/mods-probe`;
  - `claude plugin test mods/astro-mods`;
  - `git diff <phase base> -- hooks/ lib/hosts/ lib/principlebrief.mjs` is empty (D8, C8).
- Afterwards run `ac principles cite` for the principles applied above, with `--stage plan
  --by planner`.

## Wave shape

- Wave 1: t1, the probe gate.
- Wave 2: t2, t3, t4 and t5, all RED. Their files are disjoint.
- Wave 3: t6 (after t2) and t8 (after t3 and t4). Their files are disjoint.
- Wave 4: t7 (after t6).
- Wave 5: t9 (after t5, t7 and t8).

Same-file check. Every file has exactly one owner:

| File | Owner |
|---|---|
| `scripts/mods-probe/hooks/probe.js` | t1 |
| `PROBE.md` | t1, then t9 (serialised by t9 → t8 → t3 → t1) |
| `tests/mods_feed.test.mjs` | t2 |
| `tests/mods_plugin.test.mjs` | t3 |
| `register.test.tsx` | t4 |
| `tests/mods.test.mjs` and `tests/mods_cli.test.mjs` | t5 |
| `lib/retrieval.mjs` and `lib/modfeed.mjs` | t6 |
| `bin/ac.mjs` | t7 |
| `features/brief-section.js` and `register.js` | t8 |
| `lib/mods.mjs` and the docs | t9 |

Wave-green:
- No task deletes or renames an exported symbol.
- The `shortlist` extraction is internal to `lib/retrieval.mjs`, and its output is unchanged.
- `bin/ac.mjs` statically imports `lib/modfeed.mjs` only in t7, which runs after t6 created it.
- `register.js` statically imports `features/brief-section.js` in t8, the task that creates the
  module.
- Every boundary loads. The only failing tests are the declared RED ones, and wave 5 closes the
  last of them.
