# Phase 44 — pre-registered success criteria (plan-blind)

Goal: live-capture mod: offer principle capture from human-typed prompts.
Derived from the goal, CONTEXT.md (decisions 1-8, out of scope, open questions) and canon
(ADR-057, ADR-058, ADR-061, ADR-064, ADR-071 a-e, ADR-073, ADR-074; the single spec
`templates/principle-capture.md`). Plan-blind.

## Harness used by the criteria below

**Sandbox.** A throwaway `HOME` (`T=$(mktemp -d); export HOME=$T; unset CLAUDE_CONFIG_DIR`)
so the personal principle store is a scratch `~/.astro/principles/`, and
`AC="node /Users/buu/Development/astro-code/bin/ac.mjs"`. A **scratch project** is a
throwaway git repo set up the way `tests/flags.test.mjs` sets one up (`initPlanning`),
whose `ac status` prints a `Project:` line. A **non-project dir** has no `.astrocode/`
root anywhere above it. Store state is read only through `$AC principles list --json`
(and `--proposed`) / `$AC principles show <id>`, plus a recursive read of the scratch
store for the redaction check.

**[engine]** means the scenario runs through the plugin's real engine harness: `claude
plugin test` in `mods/astro-mods` (through `host` if the container has no `claude`). The
verifier writes a scenario test shaped like the existing `*.test.tsx` there. In it:

- `process.run` reaches the real `ac` with `HOME=$T` (so proposals land in the scratch
  store), except that `ac mods status --json --switches-only` answers
  `live-capture: true` unless a criterion says off.
- The model is **stubbed**: every `$.model.*` call (classify/complete, whichever the mod
  uses) is intercepted, its arguments (including the model id) recorded, and answered with
  a judgement the scenario chooses: "not a rule", or "a rule" with a chosen lifted
  statement, kind and why. Stubbing is what lets the verifier separate the model's
  judgement from anything the mod decides on its own.
- Each turn is `session.start` (carrying a session id), optionally `command.run`, then
  `prompt.submit` with the stated `origin.kind` and text, then `turn.complete`.
- Record: the value `prompt.submit` returns and when it returns, every model call, every
  `ac` argv, every `ui.toast`/notice/band text, and every file written outside the store.

Wait for any fire-and-forget work to settle (bounded, e.g. 5 s) before reading the store.

---

### C1 — A composer-typed prompt the model judges a standing rule becomes exactly one PROPOSED principle in the personal store, carrying the lifted statement, kind, why, project and a live session reference
- **Observe:** [engine] In the scratch project, fire a composer `prompt.submit` whose text
  states a rule in project-specific words (e.g. "in the checkout service never mock
  Postgres in tests, it hid the 2024 migration bug"). Stub the model to answer "a rule"
  with a lifted statement free of project nouns, kind `antipattern`, and a non-empty why.
  Then `$AC principles list --proposed --json` (and `show <id>`):
  - exactly one new entry, status **proposed** (never accepted);
  - its statement is the model's lifted statement, not the raw prompt;
  - kind and why are the model's;
  - its source records the scratch project (as `ac status`'s `Project:` names it) and a
    from-ref that identifies a **live** capture and the session id from `session.start`;
  - its excerpt is the user's own words from the prompt.
  Repeat in the non-project dir: an entry is still proposed, with no project recorded
  (or an explicit none), and nothing is written under any `.astrocode/`.
- **Fails if:** no entry appears; the entry is accepted rather than proposed (ADR-058);
  the raw prompt is stored as the statement; kind/why are missing or invented by the mod;
  the from-ref is absent, does not mark the capture as live, or carries no session id; the
  project is missing inside a project; or the non-project session proposes nothing or
  writes project state.

### C2 — Meaning is judged by the model alone, on a Haiku model: the mod has no word-list pre-filter that overrides or replaces the model
- **Observe:** [engine] (a) A composer prompt with no rule-like wording at all (e.g. "the
  build on my laptop feels slow today, whatever") with the model stubbed to answer "a
  rule" (with a lifted statement, kind and why): a proposal lands. (b) A composer prompt
  full of rule words ("always", "never", "from now on", in English and in Italian, e.g.
  "d'ora in poi usa sempre i tab") with the model stubbed to answer "not a rule": nothing
  is proposed and no `ac principles add`/`sight` is issued. (c) In every scenario where a
  model call happened, the recorded model id is a Haiku model.
- **Fails if:** (a) proposes nothing, which means a keyword gate sits in front of the
  model; (b) proposes anything, which means words override the model's judgement; the
  model is never called for a qualifying prompt; or the model id is not Haiku.

### C3 — Only what the human typed at the composer is ever judged; every other origin causes zero model calls and zero store writes
- **Observe:** [engine] With the model stubbed to answer "a rule" for anything it sees,
  fire each of these and record model calls and `ac principles` argv:
  (a) `prompt.submit` with `origin.kind` `sdk` (a `-p` session); (b) `task-notification`;
  (c) a prompt submitted by a mod / any non-composer origin; (d) a composer-typed slash
  command (`command.run {command:"astro-plan", origin:{kind:"composer"}}`) followed by
  the expanded command body as `prompt.submit`: the expanded body is never sent to the
  model; (e) assistant text and tool output in the same turns (`turn.complete` text,
  tool results containing rule wording). Store contents before and after are identical
  (`$AC principles list --json`).
- **Fails if:** any of (a)-(e) produces a model call whose input contains the non-typed
  text, an `ac principles add`/`sight`, or a store change; or the expanded body of a slash
  command is judged as if the human typed it.

### C4 — The typed prompt is never delayed or altered
- **Observe:** [engine] For a qualifying composer prompt, stub the model to (a) answer
  normally, (b) never resolve, (c) take 10 s. In each case `prompt.submit` returns the
  prompt byte-identical to what was submitted (text and every other field), and returns
  without waiting on the model or on `ac` (well under the stub's delay; in (b) it returns
  at all). No deny, no rewrite, no inserted context.
- **Fails if:** the returned prompt differs in any byte, `prompt.submit` blocks on the
  model or on `ac`, or a slow or hung model holds up the turn.

### C5 — Nothing is proposed unless it lifts to a true general rule with a non-empty why, and secrets typed in the prompt never reach the store
- **Observe:** [engine] With the model stubbed to answer "a rule" but (a) an empty or
  whitespace-only why, (b) an empty or vacuous lifted statement (the model's own "nothing
  survives the lift" answer), or (c) a kind outside `principle|pattern|preference|antipattern`:
  nothing is proposed and the store is unchanged. Separately, a qualifying composer prompt
  that also contains secret-shaped text (e.g. `sk-ant-api03-` followed by 40 random
  characters, `AKIA` followed by 16, `ghp_` followed by 36, a `password=…` pair) yields a
  proposal, and a recursive read of the scratch store (`grep -rF` for each secret value
  under `$T/.astro/principles`) finds none of them in any file, including the excerpt.
- **Fails if:** an entry with an empty why, an empty/vacuous statement or an invalid kind
  lands; or any secret value typed into the prompt appears anywhere in the store
  (the open question in CONTEXT is answered "no").

### C6 — Dedup goes through the engine: an exact repeat becomes a sighting and an overlap the model calls "same" is sighted, never a second entry; the mod never accepts, amends, rejects, retires or writes the store directly
- **Observe:** [engine] Seed the scratch store through `$AC principles add … --propose`
  with one entry S. (a) A qualifying prompt whose lifted statement equals S's statement
  exactly: the entry count is unchanged and S's sighting count rises by one
  (`$AC principles show <S>`). (b) A lifted statement that only overlaps S (shares at
  least two content words, per `$AC principles match … --json`) with the model stubbed to
  judge it the same principle: count unchanged, S gains a sighting. (c) The same overlap
  judged different: a new proposed entry. Across every scenario in this file, no `ac` argv
  is `principles accept|amend|reject|retire|reopen|merge`, and every store change is one
  `ac` made (the plugin writes no file under `$T/.astro/principles/` itself). Also
  separately accept S with `$AC principles accept <S>`, then repeat (a): S stays accepted
  with its history unchanged except the sighting.
- **Fails if:** an exact or same-judged repeat creates a second entry; a sighting is not
  recorded; a different-judged overlap is swallowed; any lifecycle verb is called; or the
  plugin writes store files itself (ADR-058, ADR-071 c).

### C7 — At most 3 proposals per session, sightings excluded, and hitting the cap is silent
- **Observe:** [engine] In one session fire 5 qualifying composer prompts, each with a
  distinct lifted statement: exactly 3 new proposed entries land, and the 4th and 5th
  produce no `ac principles add`, no notice, no toast and no error. In the same session,
  after the cap, a prompt whose lift exactly matches an existing entry still records a
  sighting (or, with sightings interleaved before the cap, they do not use up any of the
  3). A new `session.start` with a different session id proposes again.
- **Fails if:** a 4th proposal lands in one session; sightings consume the cap; reaching
  the cap prints or toasts anything; or the cap never resets for a new session.

### C8 — Surfacing is a quiet count of this session's proposals pointing at review: in the band when phase-band is on, otherwise one dim line at turn end, never a toast, nothing when zero
- **Observe:** [engine] (a) phase-band off: after a turn that proposed 2, `turn.complete`
  yields one dim one-line notice naming the count (2) and pointing at
  `/astro-principles-review`; the next turn with no new proposal does not repeat a fresh
  notice saying something new, and a session with zero proposals shows nothing at all.
  (b) phase-band on (switches answer both true): the count appears in the band text and no
  separate turn-end notice is added. (c) A sighting-only turn shows no "proposed" count
  increase. Across all scenarios in this file, `ui.toast` is called zero times by
  live-capture, and no inline accept prompt or question is raised.
- **Fails if:** a toast or popover appears; the notice spans several lines or omits the
  count or the review pointer; it shows with zero proposals; the count is not this
  session's own (e.g. the store's whole proposed queue or a lifetime total); or both band
  and notice show it when phase-band is on.

### C9 — Fail open: a model or `ac` failure means no proposal, at most one notice per session, and the prompt untouched
- **Observe:** [engine] Repeat C1's scenario with (a) the model stub throwing, (b) the model
  stub returning malformed output, (c) `ac` missing from PATH, (d) `ac principles add`
  stubbed to exit 1, (e) `ac` stubbed to hang past any timeout. In every case
  `prompt.submit` returns the prompt byte-identical and promptly (C4), no stack trace or
  contained-error report surfaces, nothing is half-written to the store, and across three
  such failing prompts in one session at most one notice is shown. Restore the model/`ac`
  in a new session: proposals work again.
- **Fails if:** any failure alters, delays or blocks the prompt; an exception reaches the
  user; the notice repeats per prompt; a partial entry lands; or the feature stays dead
  after recovery.

### C10 — live-capture is a real, switchable, off-by-default, Claude-only mod, and when off it costs nothing
- **Observe:** In the sandbox, `$AC mods status` and `$AC mods status --json` list
  live-capture as built, kind `mod`, Claude-only, floor 2.1.292, and it reads `false` in
  `$AC mods status --json --switches-only` before anything is enabled. `$AC mods enable
  live-capture` exits 0 and the switch reads `true`; after `disable`, `false`. Record
  `sha256sum` of every Claude profile's `settings.json` and Cursor's hooks file before
  enable and after disable: unchanged (a mod, not a settings hook). [engine] With the
  switch answering `false`, repeat C1: zero model calls, zero `ac principles` argv, store
  unchanged, no notice.
- **Fails if:** it still reads as unbuilt, is on by default, cannot be enabled, is wired
  as a settings hook or installed for Cursor/Codex, or an off switch still calls the model
  or `ac principles`.

### C11 — The single capture spec names live capture as a moment, and the shipped behaviour matches what it says
- **Observe:** Read `templates/principle-capture.md`. Its human-answered-moments section
  lists live capture with its gate (composer-typed prompts only), its evidence row gives
  the live `--from-ref` shape, and it states live capture's reporting bound and per-session
  cap. Compare to the behaviour observed above: the from-ref recorded in C1 matches the
  stated shape; the cap observed in C7 matches the stated number; the surfacing observed
  in C8 matches the stated bound. Read the mod's user-facing text (notice and band strings
  as recorded in C8): it points at the spec or review command rather than restating the
  lift/volume/kind rules.
- **Fails if:** the spec does not name the live moment, its from-ref shape or cap
  disagrees with what the mod actually does, or the spec and the mod state two different
  versions of a rule.

### C12 — Nothing that already worked regresses, and no command or agent depends on the mod
- **Observe:** `node --test tests/` exits 0, and `claude plugin test` in `mods/astro-mods`
  exits 0 (via `host` if needed). The ADR-071(b) parity guard still passes. The existing
  capture moments still behave as before: in a scratch project/store, a `$AC principles
  add … --propose` with a fixed from-ref and `$AC principles mine --json` produce the same
  output with live-capture on as with it off. `/astro-principles-review` and
  `$AC principles list --proposed` list live-captured entries like any other proposal.
- **Fails if:** any existing test fails, the plugin suite fails to load, a command or agent
  body references or requires live-capture, or live-captured entries cannot be reviewed
  through the existing review path.
