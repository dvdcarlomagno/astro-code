# Plan — phase 41: witness mod (human vs agent acceptance provenance, ADR-074 amends ADR-033)

This plan follows:
- `.astrocode/CONVENTIONS.md`:
  - Node ≥22 ESM;
  - zero deps;
  - named exports, no classes;
  - `node:test` with a real fs and real git;
  - `die`/`json()`/glyphs;
  - state only through `lib/` helpers under `withLock`;
  - the house comment voice (why, not what).
  - The plugin's modules are `.js` with no semicolons, and its one engine test is `.test.tsx`
    (ADR-071).
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-018: RED tests reach new symbols by `await import`.
  - ADR-020: every wave boundary is green.
  - ADR-021: CRITERIA.md is the bar.
  - ADR-029: typo'd flags are rejected.
  - ADR-033 and ADR-074: the rule.
  - ADR-071 (a)-(e): the mod enforces only canon. No command depends on it, it keeps no state of
    its own, it is off by default, and it fails open.
- This phase's `CONTEXT.md`, decisions 1-7.

It aims at every criterion in `CRITERIA.md`, C1-C10.

Principles brief (`--stage plan --by planner`), applied:
- `enforce-critical-agent-behavior-with-a-ce7b`: witness is a code guardrail that rewrites the
  call. It does not ask the agent in prose to pass `--agent`.
- `state-each-rule-in-exactly-one-place-9173`:
  - the gate table lives ONCE, in `hooks/lib/gates.js`;
  - `ac` carries only the evidence flag;
  - docs reference the table and do not copy it;
  - the human-marker regex is a copy that cannot be imported (the plugin ships apart from
    `lib/`), so a drift test ties it to `lib/planning.mjs`.
- `unattended-automation-must-never-stall-5116`: rewrite, never deny (decision 3).
- `optional-or-auxiliary-capabilities-b940`: fail open with one visible notice (decision 6).
- `keep-tooling-deterministic-and-leave-333f`: the signal is a deterministic origin and token
  check. It judges no meaning.

## Facts the plan builds on (repo, read at `a48e54d`)

- **F1. Plugin layout.**
  - `mods/astro-mods/hooks/` holds `register.js`, `lib/switches.js`, `lib/failopen.js` and
    `register.test.tsx`. There is no `features/` directory yet, so witness is the first feature.
  - Validator rules (phase 36 PROBE F3 and its "Defect found" note):
    - every registration is literally `on('<event>', fn).catch(failOpen)`;
    - `$` is never passed to an imported helper;
    - a hook function in a sibling file that uses its OWN `$` parameter is fine.
- **F2. Event shapes (phase 36 PROBE.md, 2.1.292).**
  - `command.run` carries `{command, args, origin, presentation}`.
  - `prompt.submit` carries `{text, wait, origin}`.
  - A typed slash command fires `command.run` and then a composer `prompt.submit` of the
    expansion.
  - `tool.call` spreads the tool's arguments onto the event, beside `tool`, `tool_use_id`, and
    `agentId` (subagent only).
  - The bundled typings (`scripts/mods-probe/.claude-plugin/types/claude-code/index.d.ts`) say:
    - `tool.call` is rewritable with `next({...e, <arg>})`;
    - `tool`, `tool_use_id` and `agentId` are pinned;
    - `PromptOrigin.kind` is a closed set: `composer`, `bridge`, `sdk`, `task-notification`,
      `scheduled-trigger`, `peer`, `peer-send-message`, `projects-relay`, `channel`, …,
      `plugin`;
    - `claude-code/testing` raises `$.tool.call`, `$.command.run` and `$.prompt.submit` with
      the test's own `on('tool.call')` beneath every plugin hook.
  - There is no `MultiEdit` tool in 2.1.292. Only `Write` (`file_path`, `content`) and `Edit`
    (`file_path`, `old_string`, `new_string`, `replace_all`) can carry the marker.
- **F3. The field guard.** `tests/mods_plugin.test.mjs` "no module reads an event field
  PROBE.md does not record" checks every `e.<field>` in `hooks/**/*.js` against the PHASE 36
  PROBE.md only. That file lacks `content`, `new_string` and `old_string`. t6 widens the guard to
  the union of the phase 36 and phase 41 PROBE.md files, and t1 must record every field witness
  reads as observed.
- **F4. `ac` today.**
  - `ALLOWED_FLAGS`: `'phase accept': ['by','force','agent']`,
    `'phase reject': ['reason','agent']`, `'fix accept': ['by','agent']`.
  - `parseArgs` turns `--x v` into `flags.x = 'v'` and a bare `--x` into `true`. `--x=v` becomes
    the unknown key `x=v` and is refused.
  - `phase accept` writes `{accepted_by, accepted_kind, accepted_at}` through `setPhaseStatus`
    extra.
  - `phase reject` calls `rejectPhase(r, slug, {reason, agent})`. In `lib/roadmap.mjs` that
    pushes `{reason, kind, at, by?}`.
  - `fix accept` calls `acceptFix(r, id, {by, agent})` in `lib/fixes.mjs`, which writes
    `accepted_kind`/`accepted_by`.
  - **There is no `ac phase show` verb**, but CRITERIA C1/C3/C7 use it. t3 adds it in the shape of
    `fix show` / `backlog show`, which print the raw record with `json()`.
- **F5. The marker reader.** `lib/planning.mjs` `classifyContext` reads the FIRST NON-BLANK
  line:
  - `HUMAN_MARKER_RE = /^<!--\s*astro-discuss:\s*captured\s*-->$/i` means human;
  - any `captured by agent: <name>` marker means agent, with `author` = name;
  - a human-form marker anywhere in an otherwise unmarked file also reads as human.
  `ac phase context <p> --author` prints `human` or `agent <name>`.
- **F6. Tests that pin witness.**
  - `tests/mods.test.mjs:88` expects the built list to be `['canon-guard','git-guard']`.
  - `tests/mods_plugin.test.mjs:91` has the title "a feature that is not built yet still passes
    through" and uses `witness: true`.
  - `tests/mods_cli.test.mjs:113` uses blindfold as its unbuilt example, so it is unaffected.
  - The phase-36 `mods.test.mjs:363` and `mods_cli.test.mjs:182/203` enable witness without
    asserting `built`, so they are unaffected.
- **F7. Command bodies.**
  - `tests/commands.test.mjs` slot anchors depend on `**Who is signing` and `5. On accept` in
    `astro-accept.md`. Keep both strings.
  - `tests/hosts.test.mjs` `modDependency` fails any line naming `astro-mods`, `ac mods` or
    "`<feature> mod`" unless the SAME line says `optional`, `optionally`, `if enabled` or
    `when enabled`.

## Decisions this plan pins

### P1 — the gate table: ONE frozen constant, `GATES`, in `mods/astro-mods/hooks/lib/gates.js`

| typed (composer) | unlocks gate(s) | id kind |
|---|---|---|
| `/astro-accept <p>` (`command.run` `command:"astro-accept"`) | `phase accept <p>`, `phase reject <p>` | phase |
| `/astro-fix-accept <f>` | `fix accept <f>` | fix |
| `/astro-discuss <p>` (args may carry `--challenge`) | `discuss marker` for phase `<p>` | phase |
| `! ac phase accept <p>` / `! ac phase reject <p>` / `! ac fix accept <f>` (a composer `prompt.submit` whose text is `!` then the command, spaces optional) | exactly that gate and id | as typed |

Id matching is pure, and the empty case is defined:
- **Phase:** both sides reduce to their leading integer (`/^0*(\d+)/`).
  - `41`, `041` and `41-witness-mod-…` all mean 41.
  - The gate ref must match `/^\d+(-[A-Za-z0-9._-]+)?$/`.
- **Fix:** both sides lose a leading `YYYY-MM-DD-` date, then must be strictly equal.
  - A typed fragment that is not the whole slug does NOT match.
  - The charset is `[A-Za-z0-9._-]+`.
- **Typed gate command with NO id** (`/astro-accept`, `/astro-fix-accept`, `/astro-discuss`
  with empty args): the id cannot be determined, so it is treated as an undetermined origin,
  per decision 6.
  - Pass through untouched, as "declared".
  - Show the undetermined notice once.
  - Never rewrite to agent. A human did type the gate command, so recording agent would be
    false.

### P2 — the turn reducer: module state in `features/witness.js`, reset on `register()` and on every `session.start`

`turn` is one of:
- `null` (unknown);
- `{ origin: '<kind>', typed: <signal|null>, expansion: bool }`.

`typed` is `{ gates: [...], id }`, or `{ gates, id: null }` for the empty-id case.

Rules:
- **`command.run`:**
  - `origin.kind === 'composer'` gives `turn = {origin:'composer', typed: parseTyped(command,
    args), expansion: true}`.
  - Any other string kind gives `turn = {origin: kind, typed: null}`.
  - A missing or non-string `origin.kind` gives `turn = null`.
- **`prompt.submit`, composer:**
  - If `turn?.expansion`, set `expansion = false` and KEEP `typed`. This is the slash expansion.
  - Otherwise `turn = {origin:'composer', typed: parseBang(text)}`, which is `null` unless the
    text is a `!` gate command.
- **`prompt.submit`, non-composer:** `turn = {origin: kind, typed: null}`.
  - This covers `task-notification`, `sdk`, `bridge`, `plugin` and every other kind.
  - The earlier human signal is not carried forward (decision 1, C2c).
- **`prompt.submit`, missing origin:** `turn = null`.
- **Reset to `null`:** `register()` (via `resetWitness()`) and `session.start` (via
  `forgetTurn()`, called first thing in register.js `sessionStart`).
  - A reload therefore loses the turn, and the next gate call fails open (decision 6, C5).
- **Why module state and not `$.state`:** decision 6 as written, and ADR-071(c) "keeps no state
  of its own". Losing the turn on reload is the designed fail-open, not a bug. The header
  comment says so.
- **Probe follow-ups:**
  - t1 records whether the expansion `prompt.submit` text is the raw `/cmd args` or the body.
    The reducer does not depend on it.
  - t1 also records whether a queued composer prompt typed mid-turn is stamped `composer`. If it
    is, it resets the signal. A human's accept may then read as agent: a conservative
    false-negative, documented in t10.

### P3 — the decision on a gate call (`tool.call`)

Precedence for `Bash`:
1. `isOn('witness')` is false: `return next(e)`. The event is byte-identical.
2. `e.command` is not a string, or it holds no gate: `next(e)`.
3. `findGates(command)` gives ambiguous (P4): `next(e)` untouched, plus the undetermined notice
   once.
4. The gate segment already carries a word starting with `--agent`: `next(e)` untouched (C4).
   This holds whether or not `--witnessed` is also present, because `ac` refuses that pair.
5. `turn === null`, or `turn.typed` has `id: null` for this gate family: `next(e)` untouched,
   plus the undetermined notice once (C5).
6. **Witnessed:** all of the following hold:
   - `turn.origin === 'composer'`;
   - `turn.typed` unlocks this gate;
   - the ids match (P1);
   - `e.agentId === undefined`, so the call is in the main loop. A subagent's call is never
     witnessed: it descends from the typed turn but is not the human's own act;
   - if PROBE.md's verdict is `observable` (P7), the UAT condition also holds.

   Then:
   - If the segment already has `--witnessed composer`, pass it byte-identical.
   - Otherwise insert ` --witnessed composer` right after the ref word.
7. **Otherwise:** agent. Strip any `--witnessed [value]` words the model supplied from the gate
   segment, insert ` --agent claude` right after the ref word, and show the agent notice once.

Never `{ deny }`, on any path. On the Bash path this means the call is never denied (C2 and C4).

`Write` / `Edit` marker (decision 4, C6):
- **Target:** `e.file_path` (backslashes normalised) ends with
  `.astrocode/phases/<digits>-<slug>/CONTEXT.md`, and the phase is that leading integer.
- **Write:**
  - The FIRST NON-BLANK line of `content` must match the human-marker regex (P5); otherwise
    `next(e)`.
  - Leading blank lines are counted because `classifyContext` counts them.
  - A line that is already the agent form never matches, so it is never "upgraded" (C6c).
- **Edit:**
  - The first line of `new_string` must match the human-marker regex. Content further down
    `new_string` is "not line 1" (C6d).
  - The rule is decidable without reading the file, and an Edit that opens with the human
    marker is a provenance claim wherever it lands: `classifyContext` reads a lone human marker
    anywhere as human.
- **Decision:**
  - Unknown turn: untouched, plus the undetermined notice once.
  - Composer turn whose `typed` unlocks `discuss marker` for this phase, with no `agentId`:
    untouched.
  - Otherwise, replace only that line's text with
    `<!-- astro-discuss: captured by agent: claude -->`, keeping the line's own line ending.
    Every other byte is identical. Show the marker notice once.
- Any other tool: `next(e)`.

Agent name: the constant `AGENT_NAME = 'claude'` is used for both the main loop and subagents.
- It contains no `>`, which settles debt `2026-09-24-a-in-the-agent-name-in-a-context-marker`
  for witness-written markers.
- Why not the subagent type: phase 36 PROBE.md found no field joining `agentId` to a
  `subagentType`.

Notices go through `$.ui.toast` in witness.js's own hook functions, wrapped in try/catch because
there is no UI under `-p`. There are three once-flags, reset in `resetWitness()`:
- **agent:** `witness: no typed /astro-accept|/astro-fix-accept for this id this turn — recorded
  as agent (--agent claude). ADR-074, ADR-033.`
- **marker:** `witness: CONTEXT.md marker written outside a typed /astro-discuss <n> — recorded
  as captured by agent: claude. ADR-074.`
- **undetermined:** `witness: could not tell who started this turn — left as declared. ADR-074,
  ADR-071(e).`

Each is one line of at most 160 characters. It names the gate and points at ADR-074 so the reason
is visible. It never prints a stack.

Hook functions never throw after calling `next`. Each computes the rewrite first, then returns
`next(x)` as its LAST act. So `failOpen`'s `next(e)` can never run after a rewrite (C5).

### P4 — the Bash parser (`gates.js`): catching mistakes, not a sandbox

The tokenizer is copied in spirit from git-guard P2, kept small and dependency-free, and tracks
the byte OFFSETS of each word:
- it handles single quotes, double quotes, backslash escapes and `#` comments at word start;
- it splits segments on unquoted `&&`, `||`, `;`, `|`, `&` and newline.

Per segment:
1. Drop leading `NAME=value` words.
2. Find the `ac` word. The command word's basename is `ac` or `ac.mjs`, or the command word is
   `node` followed by a word whose basename is `ac.mjs`.
3. Read the verb. Either the words are `phase` then `accept|reject`, or `fix` then `accept`.
4. Read the ref, which is the NEXT word. A ref that starts with `-`, contains `$` or a backtick,
   or fails the P1 charset is ambiguous.

`findGates(command)` returns one of:
- `{ kind: 'none' }`;
- `{ kind: 'one', gate, ref, refEnd, segStart, segEnd, words }`;
- `{ kind: 'ambiguous' }`.

`{ kind: 'ambiguous' }` covers:
- two or more gate segments;
- a bad ref;
- the raw text holding an `ac`/`ac.mjs` word AND the gate verbs while no clean gate segment
  parsed. This catches `bash -c '…'`, `lean-ctx -c '…'`, `$(…)` and `eval`, and witness does
  not descend into them.

`rewriteGate(command, hit, {add, strip})` is a pure string splice by offsets. It removes the
stripped words, each with one preceding space, and inserts ` <add>` at `refEnd`. Everything else
stays byte-identical.

Known gaps, written in the header and in t10's docs:
- MCP shell tools (`ctx_shell`) are not the Bash tool, so their calls stay declared.
- An `ac` alias or script stays declared.
- Remote Control (`bridge`) counts as no signal, so a human accepting from a phone is recorded as
  agent.

### P5 — the human-marker regex copy

`gates.js` exports the following:
- `HUMAN_MARKER = /^<!--\s*astro-discuss:\s*captured\s*-->$/i`, tested on the trimmed line;
- `AGENT_MARKER = '<!-- astro-discuss: captured by agent: claude -->'`;
- `isHumanMarkerLine(line)`;
- `markerRewrite({ tool, content, new_string })`, which returns the new string or `null`.

A drift test in t4 feeds a table of variant lines to both `isHumanMarkerLine` and
`classifyContext(line).kind === 'human'` from `lib/planning.mjs`, and asserts they agree. The
table covers spacing, case, the agent form, the colon-less agent form and a trailing-text form.
`classifyContext(rewritten).author === 'claude'` and `.kind === 'agent'` (C6 tail).

### P6 — the `ac` side (decision 5)

- **Flags.**
  - `ALLOWED_FLAGS` gains `witnessed` on `phase accept`, `phase reject` and `fix accept`, plus
    `'phase show': ['json']`.
  - One helper, `witnessedEvidence(flags)` in `bin/ac.mjs`, is called after `checkFlags` and
    BEFORE any state read or write, and dies in these cases:
    - `flags.witnessed !== undefined && flags.agent !== undefined` dies with
      `✖ --witnessed and --agent contradict each other: --witnessed says a human typed the gate
      command, --agent says an agent signed (ADR-074)`. Presence is tested with
      `!== undefined`, the phase-23 rule.
    - `flags.witnessed !== undefined && flags.witnessed !== 'composer'` dies with
      `✖ --witnessed takes one value, composer (got …)`.
  - The helper returns `'composer'` or `undefined`.
  - The allowlist is `const EVIDENCE = Object.freeze(['composer'])`, beside the helper.
- **Records.** A key is written ONLY when the evidence is defined. There is no back-fill, and no
  key is written as `undefined`.
  - `phase accept` adds `accepted_evidence: 'composer'` to the `setPhaseStatus` extra.
  - `phase reject` passes `rejectPhase(r, slug, {reason, agent, evidence})`, which sets
    `entry.evidence`. The state.json blocker is unchanged.
  - `fix accept` passes `acceptFix(r, id, {by, agent, evidence})`, which sets
    `fix.accepted_evidence`.
- **Defence in depth.** `rejectPhase` and `acceptFix` throw when `evidence` is given together
  with a declared agent. The CLI dies first, so this never fires from `ac`.
- **Output.** Append ` (witnessed: typed at the composer)` to the existing `✓ phase … accepted
  by …`, `✗ phase … → rejected…` and `✓ accepted <id> by …` lines when the evidence is present.
  Nothing is appended otherwise. Old and declared records print exactly as today, so nothing
  reads as doubtful (C7).
- **`ac phase show <phase> [--json]`.** It prints the raw roadmap entry with `json(ph)`; `--json`
  is accepted and gives the same output. It dies with the usage line when the phase is unknown,
  and the `ac phase <…>` usage list gains `show`.
- **`ac` never detects.**
  - `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` and TTY state are never read.
  - The ADR-033 comment block in `phase accept` gains two sentences: `ac` still never sniffs,
    and ADR-074 lets the optional witness mod TELL it, with `--witnessed composer`, what it saw.

### P7 — the UAT answer (decision 2, C8): a machine-read verdict line in PROBE.md

t1 writes exactly one line `Verdict (decision 2): observable` or `Verdict (decision 2):
not-observable` into PROBE.md. Tests (t6) read it with
`/^Verdict \(decision 2\): (observable|not-observable)$/m` and branch, so code and record cannot
disagree.

- **`not-observable` (expected).** The criterion for "observable" is that the answer AND that a
  human gave it are visible. The typings say a plugin's `$.ui.ask` also travels as a
  `tool.call` `AskUserQuestion`, and no field is known to attest the answerer.
  - The signal is the typed command alone.
  - witness registers nothing for AskUserQuestion.
- **`observable`.** t1 must also record the exact field path of the selected answer and of the
  attestation. Then t7 adds the following:
  - After `const res = await next(e)` on a main-loop `tool.call` `AskUserQuestion` whose
    attestation says human, set `turn.uat` to:
    - `'accept'` when the selected option label's first word is `accept`, `accepted` or `yes`;
    - `'reject'` when it is `reject`, `rejected` or `no`;
    - `null` otherwise.
  - Read the result inside try/catch so nothing can throw after `next`, and return `res`.
  - Rule 6 then also requires `turn.uat === 'accept'` for `phase accept` and `fix accept`, and
    `turn.uat === 'reject'` for `phase reject`.
  - `turn.uat` resets wherever `turn` does.
- **Rewrite channel.** If t1 finds that the `tool.call` rewrite of `command` does NOT reach the
  executed command, t1 records that and STOPS the phase for a human decision. The only fallback
  (deny) contradicts decision 3 and ADR-074, so it needs a new ADR. Do not silently switch to
  `tool.check`.

### P8 — registration (register.js gains exactly these lines)

```js
import { witnessCommand, witnessPrompt, witnessTool, resetWitness, forgetTurn } from './features/witness.js'
// in register(): resetWitness()
// in sessionStart(), first line: forgetTurn()
on('command.run', witnessCommand).catch(failOpen)
on('prompt.submit', witnessPrompt).catch(failOpen)
on('tool.call', witnessTool).catch(failOpen)
```

Every exported hook opens with `if (!isOn('witness')) return next(e)`. The observers
(`witnessCommand`, `witnessPrompt`) only update `turn` and always `return next(e)` unchanged:
witness never alters a prompt or a command.

The header comment in `register.js` changes from "This skeleton ENFORCES NOTHING" to name
witness as the first feature.

### Test strategy (ADR-018, stated)

Test-first for behaviour. The RED tasks are t2, t4 and t6.
- **t2 (`ac`).**
  - Its CLI tests spawn `node bin/ac.mjs`, so they import no new symbol.
  - Its lib tests call EXISTING `acceptFix`/`rejectPhase` with a new option, which fails at call
    time only.
  - Green after t3.
- **t4 (`gates.js`).** Reaches the module only by
  `await import('../mods/astro-mods/hooks/lib/gates.js')` inside async test bodies, so a missing
  file fails only those tests. Green after t5.
- **t6 (plugin simulator).**
  - Drives `register.js` through the existing `boot()` harness, which already uses
    `await import`.
  - Reaches `features/witness.js` only by `await import`.
  - Green after t7.
  - The widened field guard needs t1's PROBE.md, which is why t6 depends on t1.

Test-after, chosen explicitly:
- **t8**, the `register.test.tsx` engine scenarios, depends on t7. A `.tsx` RED file would fail
  `claude plugin test`. `tests/mods_plugin.test.mjs` runs that command live wherever `claude`
  ≥ 2.1.292 is on PATH, so a red engine file would break a wave boundary on the host.
- **t9**, the built flip, rewrites the assertions that pin witness as unbuilt (F6) in the same
  task, so it lands green.

Isolation:
- `mkdtempSync` and real git.
- Scratch projects via `mkWorkdir` and `verifiedPhase`, as `tests/flags.test.mjs` does.
- Unit calls into `lib/mods.mjs` pass explicit `targets`/`cursorTargets`.
- No test reads the real `~/.astro` or `~/.claude`.

Host commands: `claude` is not in the container. Executors run live `claude` steps through
`host …` (cwd-preserving) and list every host command in their summary. Nothing destructive runs
on the host. Scratch dirs come from `mktemp -d`. Switches are fed through a PATH shim `ac`, never
by editing the real `~/.astro/config.json`.

## Tasks

### t1 — Live probe on Claude Code ≥ 2.1.292: rewrite, origins, `!` form, AskUserQuestion; write PROBE.md
- **file:** `scripts/mods-probe/hooks/probe.js`, `.astrocode/phases/41-witness-mod-detect-human-vs-agent/PROBE.md` (new)
- **depends_on:** —
- Extend the probe. It stays off unless `ASTRO_MODS_PROBE_LOG` is set, and observes by default.
  - **`ASTRO_MODS_PROBE_REWRITE=1`:** on `tool.call` `Bash` whose command is exactly
    `echo witness-probe-a`, return `next({ ...e, command: 'echo witness-probe-b' })`. Log what
    `next` resolved to.
  - **`tool.call` `AskUserQuestion`:** `await next(e)` and log the result's KEYS and shape at
    depth 2. Strings are cut to 80 chars as today. Also log `e`'s keys.
  - **`tool.call` `Write`/`Edit`:** keys are already logged. Confirm `content`, `new_string`,
    `old_string` and `file_path` appear.
  - **`prompt.submit`:** the existing 80-char head of `text` is enough to see the expansion form
    and the `!` form.
  - Keep the header comment's redaction rules and add one line per new behaviour.
  - `claude plugin validate --strict scripts/mods-probe` must still pass.
- Runs, each in a `mktemp -d` scratch project (`git init`, `ac init`, one phase `01-probe`
  `verified` with an ACCEPTANCE.md):
  1. **Interactive tmux session** (`host tmux new -d …`, `claude --plugin-dir
     <repo>/scripts/mods-probe --permission-mode bypassPermissions`). Type, via `send-keys`:
     - `/astro-accept 1`, then answer the AskUserQuestion with the accept option;
     - then `! echo witness-probe-a`;
     - then `! ac phase show 1 || true`. Any `!` command works; it shows whether `!` emits
       `prompt.submit` and/or a Bash `tool.call`;
     - then a prompt asking the model to run `echo witness-probe-a`;
     - then a second prompt typed while a turn is running, to see whether a queued prompt is
       stamped `composer`;
     - then `/exit`.
  2. **`claude -p --plugin-dir … "/astro-accept 1"`** with `ASTRO_MODS_PROBE_REWRITE=1`. This
     records the `sdk` origin and whether AskUserQuestion is answerable headless.
- **PROBE.md**, in phase 36's format:
  - a version and date header;
  - a runs table with exact commands, scratch paths as `<scratch>`;
  - "observed" vs "not observed" per item.
  - It MUST contain:
    - the rewrite outcome: did the executed output say `witness-probe-b`;
    - the expansion `prompt.submit` text form;
    - whether `!` reaches `tool.call` at all, and with what origin;
    - the queued-prompt origin;
    - the AskUserQuestion result shape and whether any field attests the human;
    - the exact P7 verdict line;
    - a "fields witness reads" list with each name in backticks, every one observed: `command`,
      `args`, `origin`, `text`, `tool`, `agentId`, `file_path`, `content`, `new_string`, plus
      any the observable branch needs.
- If the rewrite did NOT reach the command: write that, and stop the phase per P7. Report
  BLOCKED with the evidence, and do not continue.

### t2 — RED: `ac` evidence flag, `phase show`, conflicts, no detection, no back-fill
- **file:** `tests/flags.test.mjs`, `tests/fixes.test.mjs`
- **depends_on:** —
- `tests/flags.test.mjs`, beside the ADR-033 block, reusing `verifiedPhase()`/`run()`:
  - **Witnessed accept.**
    - `phase accept 1 --witnessed composer`: exit 0.
    - `findPhase` has `accepted_kind:'human'` and `accepted_evidence:'composer'`.
    - stdout matches `/witnessed/`.
    - `ac phase show 1` stdout parses as JSON with the same two fields.
    - `ac phase show 1 --json` gives the same.
    - `ac phase show 99` exits non-zero.
  - **Plain accept.** It has no `accepted_evidence` key (`'accepted_evidence' in ph === false`).
    It still has none when run with `env: {...process.env, CLAUDECODE:'1',
    CLAUDE_CODE_ENTRYPOINT:'cli'}` and `stdio` stdin `'ignore'` (C7: `ac` never sniffs).
  - **Conflict.** `phase accept 1 --witnessed composer --agent bot`, and the same with the flags
    reversed and with a bare `--agent`:
    - exit ≠ 0;
    - stderr `/✖.*--witnessed.*--agent|--agent.*--witnessed/`;
    - the phase status stays `verified`.
  - **Bad values.** `--witnessed human` and bare `--witnessed` exit ≠ 0, and the status is
    unchanged.
  - **Typos.** `--witnesed composer` is still refused as an unknown flag (ADR-029).
  - **Reject.**
    - `phase reject 1 --reason "x" --witnessed composer`: the last `rejections` entry has
      `evidence:'composer'` and `kind:'human'`.
    - A plain reject's entry has no `evidence` key.
    - The conflict with `--agent` exits ≠ 0, the status is unchanged, and no entry is added.
  - **Fix accept.**
    - `ac fix add "a bug"`, then `ac fix accept <id> --witnessed composer`: `ac fix show <id>`
      JSON has `accepted_kind:'human'` and `accepted_evidence:'composer'`, and stdout matches
      `/witnessed/`.
    - The conflict with `--agent` exits ≠ 0 and the fix status is unchanged.
    - A plain fix accept has no evidence key.
  - **No back-fill.**
    - Accept phase 1 plainly, add phase 2, and witness-accept phase 2.
    - Then run `ac phase show 1` and `ac status`.
    - Phase 1's roadmap entry must be deep-equal to its snapshot from before phase 2 was
      accepted, and must not mention witness.
  - **Agent rewrite end to end.** `phase accept 1 --agent claude` gives kind `agent`, no
    evidence, and status `complete` (C2 tail).
- `tests/fixes.test.mjs`, lib level:
  - `acceptFix(root, id, {by, evidence:'composer'})` stores `accepted_evidence`, and it survives
    in `loadFixes`.
  - With no `evidence`, the key is absent.
  - `acceptFix(…, {agent:'x', evidence:'composer'})` rejects.
- Done when the new tests fail for the missing behaviour only, and every pre-existing test in both
  files still passes.

### t3 — `ac`: `--witnessed`, `accepted_evidence`, rejection `evidence`, `phase show`, help
- **file:** `bin/ac.mjs`, `lib/roadmap.mjs`, `lib/fixes.mjs`
- **depends_on:** t2
- Implement P6.
  - `rejectPhase` and `acceptFix` gain the `evidence` option, set only when defined, and the
    agent-conflict throw. Each gets a short comment citing ADR-074.
  - Help text:
    - the `ac phase accept … --witnessed composer` line;
    - `ac phase reject … [--witnessed composer]`;
    - `ac fix accept <id> [--agent <name> | --witnessed composer]`;
    - `ac phase show <phase>   print the raw roadmap entry as JSON`.
  - Update the `ac phase <…>` usage die and the `phase accept`/`reject` usage dies.
- Done when `node --test tests/flags.test.mjs tests/fixes.test.mjs tests/rejections.test.mjs
  tests/contracts.test.mjs` is green.

### t4 — RED: gate table, Bash parser/rewriter, typed parsers, marker rewrite (pure)
- **file:** `tests/witness.test.mjs` (new)
- **depends_on:** —
- All symbols are reached by `await import('../mods/astro-mods/hooks/lib/gates.js')` inside
  async tests.
- **`parseTyped(command, args)`:**
  - `('astro-accept','41')` and `('astro-accept','41-witness-mod-x')` both give the gates
    `phase accept` and `phase reject`, with phase id 41.
  - `('astro-fix-accept','2026-10-11-foo')` gives `fix accept`.
  - `('astro-discuss','41 --challenge')` gives `discuss marker` 41.
  - `('astro-accept','')` gives `id: null`.
  - `('astro-autonomous','')` and `('astro-status','')` give `null`.
- **`parseBang(text)`:**
  - `'! ac phase accept 41'`, `'!ac phase reject 41'` and `'! ac fix accept foo'` each give
    exactly that gate.
  - `'hello'`, `'! ls'` and `'/astro-accept 41'` give `null`.
- **`findGates`**, table:
  - **`one`:**
    - `ac phase accept 41`;
    - `ac phase accept 41-witness-mod-detect-human-vs-agent --by me`;
    - `cd /x && ac phase accept 41`;
    - `FOO=1 ac phase reject 41 --reason "it's broken; really"`;
    - `node /abs/bin/ac.mjs fix accept 2026-10-11-foo`;
    - `/abs/ac phase accept 41 # note`;
    - `ac phase accept 41 2>&1 | tail -1`.
  - **`none`:** `git commit -m "ac phase accept 41"`, `ac phase verify 41`, `ac fix show x`,
    `echo phase accept`.
  - **`ambiguous`:**
    - `ac phase accept 41 && ac fix accept foo`;
    - `ac phase accept --force 41`;
    - `ac phase accept $N`;
    - `bash -c 'ac phase accept 41'`;
    - `lean-ctx -c 'ac phase accept 41'`;
    - `echo $(ac phase accept 41)`.
- **`rewriteGate`:**
  - `ac phase accept 41 --by me` with add `--witnessed composer` gives
    `ac phase accept 41 --witnessed composer --by me`.
  - `cd x && ac phase accept 41 2>&1 | tail -1` with add `--agent claude` changes only the
    insertion.
  - `ac phase accept 41 --witnessed composer --by me` with strip `--witnessed` + value and add
    `--agent claude` gives `ac phase accept 41 --agent claude --by me`.
  - Every output differs from its input only at the splice (assert by removing the inserted
    text).
- **`idsMatch`:**
  - phase `41` vs `041`, `41-x`: true; `41` vs `14`, `4`: false.
  - fix `foo` vs `2026-10-11-foo`: true; `fo` vs `2026-10-11-foo`, `foo-bar` vs `foo`: false.
- **`markerRewrite`:**
  - Write content `'<!-- astro-discuss: captured -->\n# T\nbody\n'` gives line 1
    `AGENT_MARKER` and the rest identical.
  - CRLF is preserved.
  - Leading blank lines are handled.
  - An agent-marker first line gives `null`.
  - A marker on line 3 gives `null`.
  - Edit `new_string` that starts with the marker is rewritten; one where the marker is mid-text
    gives `null`.
  - **Drift (P5):** for each variant line, `isHumanMarkerLine(l) === (classifyContext(l).kind
    === 'human')`, with `classifyContext` statically imported from `../lib/planning.mjs`.
    `classifyContext(rewritten)` deep-equals `{kind:'agent', author:'claude'}`.
  - `AGENT_NAME` has no `>`.
- **`isPhaseContextPath`:** `/a/.astrocode/phases/41-x/CONTEXT.md` gives 41, a Windows `\`
  path gives 41, and `/a/.astrocode/CONTEXT.md`, `/a/phases/41-x/CONTEXT.md` and
  `…/41-x/PLAN.md` give null.

### t5 — `hooks/lib/gates.js`: the one gate table and the pure helpers
- **file:** `mods/astro-mods/hooks/lib/gates.js` (new)
- **depends_on:** t4
- Implement P1, P4 and P5 with these exports:
  - `GATES` (frozen);
  - `AGENT_NAME`, `HUMAN_MARKER`, `AGENT_MARKER`;
  - `parseTyped`, `parseBang`, `findGates`, `rewriteGate`, `idsMatch`, `isHumanMarkerLine`,
    `markerRewrite`, `isPhaseContextPath`.
- No `$`, no `e`, no imports. Plain values in, plain values out (F1).
- The header comment (house voice) covers:
  - why the table lives here once;
  - why the human-marker regex is a tested copy;
  - "catching mistakes, not a sandbox", with the P4 gaps named;
  - why an empty id is undetermined, not agent.
- Done when `node --test tests/witness.test.mjs` is green.

### t6 — RED: witness through the plugin simulator; field guard widened
- **file:** `tests/mods_plugin.test.mjs`
- **depends_on:** t1
- Extend `boot()` only if needed: the `$` mock already has `process.run` and `ui.toast`. Each
  test boots fresh with `switches({ witness: true })` unless stated, and runs
  `invoke('session.start')` first.
- A helper `turnThen(events, call)` invokes each `command.run`/`prompt.submit` then the
  `tool.call`, and returns what the identity `next` received.
- Scenarios, mirroring CRITERIA:
  - **C1:**
    - Composer `command.run astro-accept 41` plus a composer expansion `prompt.submit`, then
      Bash `ac phase accept 41` gives a downstream `ac phase accept 41 --witnessed composer`
      with no `--agent`.
    - The same via a composer `prompt.submit` `! ac phase accept 41`.
    - The slug ref `ac phase accept 41-witness-x` is also witnessed.
  - **C2 (a)-(e):**
    - (a) composer `astro-autonomous`;
    - (b) `sdk` `astro-accept 41`;
    - (c) composer `astro-accept 41`, then `task-notification` `prompt.submit`;
    - (d) composer `astro-accept 40`;
    - (e) `plugin` origin.
    - Each gives `--agent claude`, never `--witnessed`, never a deny, and exactly one toast
      matching `/agent/`.
    - A Bash call with `agentId` after a composer `astro-accept 41` also gives `--agent claude`.
    - A model-supplied `ac phase accept 41 --witnessed composer` in an `sdk` turn gives
      `ac phase accept 41 --agent claude`.
  - **C3:**
    - `ac phase reject 41 --reason x` after composer `astro-accept 41` is witnessed. After
      `astro-accept 40` it gets `--agent`.
    - `ac fix accept 2026-10-11-foo` after composer `astro-fix-accept foo` is witnessed, and
      after `! ac fix accept 2026-10-11-foo` too. After `astro-fix-accept bar` or
      `astro-accept 41` it gets `--agent`.
  - **C4:**
    - `ac phase accept 41 --agent bot` is byte-identical in an `sdk` turn AND after a composer
      `astro-accept 41`.
    - With `switches({ witness: false })`, every C1-C3 and C6 scenario is byte-identical with no
      toast.
  - **C5:**
    - With no prompt event after `session.start`, `ac phase accept 41`, `ac fix accept foo` and
      a CONTEXT.md marker Write are each byte-identical.
    - Across those three, exactly one toast is shown.
    - A composer `astro-accept 41`, then `session.start` (a reload), then the call is
      byte-identical.
    - A malformed `tool.call` (`command: 42`, or `e.origin` missing on `prompt.submit`) never
      rejects and passes through.
    - An empty-arg composer `astro-accept` gives byte-identical plus the undetermined toast.
    - An ambiguous `bash -c 'ac phase accept 41'` is byte-identical.
  - **C6:**
    - A Write and an Edit to `/p/.astrocode/phases/41-x/CONTEXT.md` with the human marker as
      line 1:
      - (a) after composer `astro-discuss 41`: unchanged;
      - (b) after `astro-discuss 40`, composer `astro-autonomous`, or `sdk`: line 1 becomes
        `AGENT_MARKER`, the rest is identical, and a toast is shown.
    - (c) An agent-marker Write is unchanged in every turn.
    - (d) `/p/notes/CONTEXT.md`, or the marker on line 3, is unchanged.
  - **C8 branch:** read t1's PROBE.md verdict line (P7).
    - `not-observable`: a composer `astro-accept 41` with no AskUserQuestion event is witnessed.
    - `observable`: add the P7 accept/reject/absent cases.
  - **Field guard:** "no module reads an event field PROBE.md does not record" now reads the
    phase 36 PROBE.md AND the phase 41 PROBE.md (union).
  - **Registration list:** the `:74` assertion `['session.start']` becomes
    `['session.start','command.run','prompt.submit','tool.call']`, and its message is updated.
    The all-off pass-through loop below it stays: every handler must return `next(e)`'s value
    when every switch is off.
  - Rename the `:91` title to "a switch that is on is read, and session.start still passes
    through". The assertions are unchanged.
- Every new scenario reaches `features/witness.js` exports only via `await import`. Done when
  the new tests fail for missing behaviour only, and all pre-existing tests in the file pass.

### t7 — `hooks/features/witness.js` and its three registrations
- **file:** `mods/astro-mods/hooks/features/witness.js` (new), `mods/astro-mods/hooks/register.js`
- **depends_on:** t5, t6
- Implement P2, P3, P7 (the branch PROBE.md selected) and P8.
  - Exported hooks: `witnessCommand`, `witnessPrompt`, `witnessTool`.
  - Exported resets: `resetWitness()`, which resets the turn and the three once-flags, and
    `forgetTurn()`.
  - Each hook reads `e.*` fields only from the PROBE.md lists. It hands `gates.js` plain
    strings, never `$`, and spells `$.ui.toast` in this file.
- Header comment (house voice) covers:
  - the rule (ADR-074) and what "current turn" means;
  - why the state is module-level and lost on reload (fail open, ADR-071 c/e);
  - why subagent calls are never witnessed;
  - why it rewrites and never denies;
  - why the agent name is fixed.
- `register.js`: P8 lines, plus the header update.
- Done when:
  - `node --test tests/mods_plugin.test.mjs tests/witness.test.mjs` is green;
  - `host claude plugin validate --strict mods/astro-mods` exits 0;
  - the existing `host claude plugin test mods/astro-mods` exits 0.

### t8 — Engine scenarios in `register.test.tsx` (test-after, real engine)
- **file:** `mods/astro-mods/hooks/register.test.tsx`
- **depends_on:** t7
- Keep the two existing tests.
- Add witness scenarios through `claude-code/testing`:
  - `on('process.run')` answers `{switches:{witness:true}}`, or `false` for the toggle case.
  - `on('ui.toast')` records.
  - The test's own `on('tool.call')` beneath the plugin records what would run and answers
    `{ result: … }`/`{ value }` per the kit's types.
  - Fire `$.session.start(…)`, then `$.command.run({command, args, origin})` and/or
    `$.prompt.submit({text, origin})`, then `$.tool.call({tool:'Bash', command})` or
    `{tool:'Write', file_path, content}`.
- At minimum:
  - C1 slash form;
  - C2 (a) and (c);
  - C4 `--agent` untouched;
  - C4/C9 switch-off byte-identical;
  - C5 cold call untouched;
  - C6 (b) marker rewrite.
- If the kit stamps `origin` itself and ignores a test-supplied one, record that in a comment.
  Cover the composer path with whatever origin the kit lets a test set, and leave the rest to
  t6's simulator. Note it in the summary; do not fake it.
- Done when `host claude plugin test mods/astro-mods` exits 0 and reports the new tests passing.

### t9 — Flip `witness` to built, and the registry/status tests that pin it
- **file:** `lib/mods.mjs`, `tests/mods.test.mjs`, `tests/mods_cli.test.mjs`
- **depends_on:** t7
- `lib/mods.mjs`:
  - `witness` gets `built: true`.
  - The `FEATURES` doc comment becomes "true for phases 37, 38 and 41".
  - There is no `GUARD_HOOKS` entry: witness is a mod, not a settings hook (C9).
- `tests/mods.test.mjs:82-88`: the title and the built list become
  `['canon-guard','git-guard','witness']`.
- `tests/mods_cli.test.mjs`: add one test using the existing `box()`/`seedMarketplace` harness:
  - `mods enable witness` exits 0;
  - `status witness` does not match `/not built yet/`;
  - `status --json` shows witness with `built:true` and `kind:'mod'`;
  - `--switches-only` gives `witness:true`, then `false` after `mods disable witness`;
  - no settings hook is written for it in any Claude dir;
  - no Cursor `hooks.json` change.
- Done when `node --test tests/mods.test.mjs tests/mods_cli.test.mjs tests/hosts.test.mjs` is
  green.

### t10 — Docs: commands' signing sections, MANUAL, ARCHITECTURE
- **file:** `commands/astro-accept.md`, `commands/astro-fix-accept.md`, `MANUAL.md`, `ARCHITECTURE.md`
- **depends_on:** t3, t7
- **`astro-accept.md`, "Who is signing (ADR-033)".** Keep the anchor text. Replace the flat
  "astro-code cannot detect which happened" with "declared everywhere; witnessed where the host
  allows (ADR-074)". Add ONE line: "Optionally, if enabled, the witness mod corrects a call made
  outside a typed `/astro-accept <n>` to `--agent` and marks a typed one `--witnessed composer` —
  declare honestly either way." In 4b, add one sentence: decide from what `ac phase reject`
  printed, because an `AGENT` line means agent-signed, so propose nothing. That sentence names no
  mod.
- **`astro-fix-accept.md`.** The same ADR-074 sentence and one "Optionally, if enabled, …" line.
- **`MANUAL.md`.**
  - In the mods table, witness becomes "phase 41 (built)", and the built/unbuilt sentence is
    updated.
  - New `#### witness` subsection, at most 15 lines:
    - what counts as human (point at the gate table in `mods/astro-mods/hooks/lib/gates.js`
      rather than copying it);
    - rewrite, never block;
    - `accepted_evidence`;
    - fail open;
    - the known gaps from P4, plus Remote Control and queued prompts per t1.
  - In the command reference: `ac phase show`, `--witnessed composer` on the three verbs, and
    that `ac` never detects.
- **`ARCHITECTURE.md`.** One paragraph under astro-mods: `features/witness.js` + `lib/gates.js`,
  module turn state, no settings hook.
- Done when `node --test tests/commands.test.mjs tests/hosts.test.mjs tests/contracts.test.mjs
  tests/principle_capture.test.mjs` is green.

### t11 — ADR-074 carries the probe outcome; live end-to-end check recorded; full gates
- **file:** `.astrocode/DECISIONS.md`, `.astrocode/DECISIONS.in-force.md` (written only by `ac decision amend`), `.astrocode/phases/41-witness-mod-detect-human-vs-agent/PROBE.md`
- **depends_on:** t1, t8, t9, t10
- Run `ac decision amend ADR-074 --reason "phase 41 probe outcome" --why "<existing Why text, kept> + …"`.
  Add plainly:
  - the P7 verdict, e.g. "the UAT answer is not attestable as human, so the signal is the typed
    gate command alone";
  - that subagent calls are never witnessed;
  - that an empty-id typed command and an unknown turn stay declared;
  - that Remote Control (`bridge`) and MCP shell tools are not witnessed;
  - that `ac` still never detects.
  Never hand-edit the DECISIONS files.
- Live E2E on the host, in a `mktemp -d` scratch project with phases 1 and 2 `verified`, plus
  ACCEPTANCE.md:
  - `claude --plugin-dir <repo>/mods/astro-mods` with a PATH shim `ac` that answers
    `mods status --switches-only` with witness on and execs the real `ac` otherwise. The real
    `~/.astro/config.json` is never touched.
  - Interactive tmux: type `/astro-accept 1` and accept. Then `ac phase show 1` must show
    `accepted_evidence:"composer"`.
  - `claude -p … "/astro-accept 2"`: phase 2 must be `complete` with `accepted_kind:"agent"` and
    no evidence, with no hang and no deny.
  - Ask in the composer for a CONTEXT.md with the human marker for phase 2, without typing
    `/astro-discuss`. `ac phase context 2 --author` must print `agent claude`.
- Append a "Live end-to-end check" section to PROBE.md:
  - the exact host commands;
  - the outcomes;
  - the gates:
    - `node --test tests/` (claude on PATH) exits 0 with its count;
    - the same under a no-claude PATH, with the live tests skipped;
    - `host claude plugin validate --strict mods/astro-mods` exits 0;
    - `host claude plugin test mods/astro-mods` exits 0;
  - a C1-C10 → evidence table.
- If any gate fails, fix nothing here. Report it and stop, because the owning task is re-run.

## Waves

| wave | tasks | why |
|---|---|---|
| 1 | t1, t2, t4 | independent: the probe, the `ac` RED tests and the pure-helper RED tests |
| 2 | t3, t5, t6 | t3←t2, t5←t4, t6←t1 (needs PROBE.md fields and verdict); disjoint files |
| 3 | t7 | needs gates.js (t5) and the simulator tests (t6) |
| 4 | t8, t9, t10 | engine test, built flip, docs; disjoint files |
| 5 | t11 | ADR text plus the live check over everything |

Same-file check:
- `PROBE.md` is shared by t1 and t11, and t11 depends on t1.
- Every other file has exactly one owner.
- No task deletes or renames a symbol, so no consumer fixups are split.
