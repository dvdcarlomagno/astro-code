# PROBE — phase 42: can a mod replace the settings hooks' brief with one cached system-prompt section?

Machine-read, dense. Everything below was OBSERVED by `scripts/mods-probe/` on live
sessions. Nothing is copied from the docs. Anything not seen is marked `not observed`.

- Claude Code: **2.1.292** (`claude --version`), at the 2.1.292 floor.
- Date: 2026-10-12. Driving model: `claude-opus-5-5`.
- `claude plugin validate --strict scripts/mods-probe` exits 0.
- Probe: `scripts/mods-probe`, loaded with `--plugin-dir`, never `plugin install`ed. Inert unless
  `ASTRO_MODS_PROBE_LOG` is set. Experiment mode: `ASTRO_MODS_PROBE_TRY=<abs json>`
  (`{ drop, dropLines, section }`), described in the probe's header.
- Sandbox (run inside the astro-forge container, no `host` call): `HOME=<scratch>` and
  `CLAUDE_CONFIG_DIR=<scratch>/cc` holding a COPIED `.credentials.json`. The real `~/.claude` and
  `~/.astro` were never touched. Scratch project `<scratch>/proj`: `git init`, `ac init`.
  Personal store `<scratch>/.astro/principles/`: 330 synthetic accepted `strength: rule` entries.
- Settings: `--settings <scratch>/settings.json`, hooks written as `lib/hosts/claude.mjs` writes them:
  SessionStart = `astro-update.mjs` + `astro-principles.mjs 2/4`, `3/4`, `4/4`; PreCompact =
  `astro-precompact.mjs`. Plus a FOREIGN SessionStart hook (additionalContext
  `FOREIGN-SS: <one brief line>`) and a FOREIGN PreCompact hook (systemMessage `FOREIGN-PC: <same line>`).
- Neither the logs nor the scratch project are committed.

## Runs

| run | what | mode |
|---|---|---|
| 1 | startup, ask the model what it sees; no experiment | `claude -p --output-format json` |
| 2 | TRY: drop the 4 astro SessionStart entries (exact strings) + append a section | `-p` |
| 3 a-e | TRY: startup, 2nd turn, `/compact`, post-compact turn, post-compact question, chained with `--resume` | `-p --output-format stream-json --include-hook-events` |
| 4 | TRY + `dropLines`: ONE process, turn, turn, `/compact`, turn | `-p --input-format stream-json` |
| 5 / 6 | cache control (no section) vs section (~4.5k chars), 3 consecutive turns, one process each | `-p --input-format stream-json` |
| 7 | section text edited between turns; `/clear`; `/reload-plugins` | `-p --input-format stream-json` |
| 8 | interactive: turn, `/clear`, turn, `/reload-plugins`, turn, `/compact` | `tmux`, real REPL |

## Facts

### (a) SessionStart

- **F1** The event is `classic.SessionStart`. `e` keys: `session_id, transcript_path, cwd,
  scratchpad_dir, prompt_id, permission_mode, agent_id, agent_type, effort, hook_event_name,
  source, model, session_title` (resume adds `seconds_since_last_response, context_tokens,
  prompt_cache_likely_expired, estimated_cache_write_usd`). No command or script name is exposed.
- **F2** `next(e)` resolves to `{ additionalContext: string[] }` only (result keys = `additionalContext`).
  One entry per settings hook that emitted context, UNWRAPPED: each entry is the hook's
  `additionalContext` string and nothing else. The foreign hook's entry sits in the same array.
- **F3** Byte-equality: dropping the four strings computed by running the hooks outside Claude
  (`astro-update.mjs`, `astro-principles.mjs 2/4 3/4 4/4`, lengths 9410/9444/9452/9388) removed exactly
  those entries (`before: 5, after: 1`). So an entry is the hook's string, byte for byte.
- **F4** Entry order is NOT the settings order. The hooks run concurrently and the array is in
  completion order, different on every run (observed: foreign first, then 3/4, 2/4, 4/4, update).
  An entry is identified by content, never by position.
- **F5** The drop reaches the model. Run 2 and run 4: the model, asked yes/no, said it did not see
  `part 3 of 4`, `Seed rule 20:`, `HARD RULES`, `astro-code v0`, and DID see `FOREIGN-SS`. The
  transcript's `hook_additional_context` row is 207 chars (foreign only) instead of 38,439 (run 1).
  A dropped entry is gone from what the model reads.
- **F6** The banner is `astro-update.mjs`'s `systemMessage`. The classic result has no `systemMessage`
  field (F2), so a `classic.SessionStart` hook cannot touch it, and nothing in this probe did. The
  banner is not in the model's context in run 1 (the model answered "no" for the banner text): it is a
  user-facing notice. The stream's `hook_response` carries the hook's raw stdout (banner included)
  before any plugin hook. Whether the banner is DRAWN in the interactive UI after a drop: not observed
  by screen capture (the pane scrolled past it); by construction it is unchanged.
- **F7** The same event fires on `source` = `startup`, `resume`, `compact` and `clear`, each with a
  fresh set of hook outputs, and a drop applies to each. It did NOT fire on `/reload-plugins`
  (run 7 and run 8).

### (a) PreCompact

- **F8** `classic.PreCompact` fires (`e` keys add `trigger`, `custom_instructions`) but `next(e)`
  resolves to `{}` (result keys: none). The astro and foreign `systemMessage`s are NOT in its result,
  so this event cannot drop or blank exactly the astro output.
- **F9** Where the output lands: a `session.append` row with `door: 'command'`, `origin.kind:
  'unclassified'`, a text block `<local-command-stdout>Compacted PreCompact ["/usr/bin/node" "<abs>/hooks/astro-precompact.mjs"]
  completed successfully: {"systemMessage":"..."}\nPreCompact ["/usr/bin/node" "<foreign>"] completed successfully: {...}</local-command-stdout>`.
  ONE row holds every PreCompact hook's output. It is appended after `compact_boundary` and after the
  summary, and it is **model-read**: asked after a `/compact`, the model quoted both `keep this after
  compaction` and `FOREIGN-PC` and the tag `local-command-stdout`. It is also drawn in the REPL
  (run 8). So it is not a user-only notice.
- **F10** This row exposes the script name (`astro-precompact.mjs`) and the foreign hook's path,
  inside the text. The astro output is still best identified by its exact `systemMessage` JSON.
- **F11** `session.append` hooks can rewrite `content`. Run 4 (`dropLines`, door `command`): the line
  holding the astro output was removed; the stored row kept only the foreign `PreCompact [...]
  completed successfully: {"systemMessage":"FOREIGN-PC..."}`; the model, asked after the compaction,
  said it did NOT see `keep this after compaction` and DID see `FOREIGN-PC`. The probe removed the
  WHOLE line, which in this row also held the opening `<local-command-stdout>Compacted ` prefix, so
  the stored row lost its opening tag. A real implementation removes only the exact
  `PreCompact [...astro-precompact.mjs...] completed successfully: <exact json>` segment.
- **F12** Observed only for a MANUAL `/compact`. An automatic compaction: not observed (its door and
  whether the output reaches the model are unknown).
- **F13** In run 4 the compaction summary still held a similar sentence (`The astro-code state to keep
  after compaction is proj · M1`) although the astro row was dropped. Not isolated: it may come from the
  summarizer reading PreCompact output or from the pre-compaction conversation. Not observed which.

### (b) A `session`-scope section via `prompt.compose`

- **F14** `prompt.compose` `next(e)` resolves to `{ sections }`, each `{ id, text, scope }`. Ids seen
  (lean, `-p`): `lean_body` (shared), `communication`, `pronouns`, `action_caution`, `session_guidance`,
  `memory`, `env_info_simple`, `context_management`, `total_tokens` (all session). Appending
  `{ id: 'mods-probe:try', scope: 'session' }` as the LAST element worked: the model answered with the
  secret word written only there (runs 2, 3, 4, 6, 7, 8).
- **F15** The section survives: `--resume` (run 3), `/compact` (runs 3, 4), `/clear` (runs 7, 8) and
  `/reload-plugins` (runs 7, 8). It is appended by the hook on every compose; the engine keeps no copy.
- **F16** It is cached. Per-request usage from the transcript, three consecutive turns, one process:
  - no section (run 5): turn 3 `cache_read` 40,696, `cache_creation` 8,361;
  - ~4.5k-char section (run 6): turn 3 `cache_read` 42,106, `cache_creation` 8,113.
  The extra ~1,410 tokens are READ, not created, on turn 3, and creation does not grow with the section.
  Turns 1 and 2 build the cache (large `cache_creation`) in both runs, section or not.
- **F17** Compose re-fires, at least once per turn, and the answer is NOT held across turns:
  `$.ui.invalidate` does not take `'prompt.compose'` at all (`InvalidatableEventName` lists
  `prompt.section`, `prompt.context`, `prompt.attachment`, `tool/command/config.describe` and the render
  events). A changed section text reaches the next compose; no invalidate is needed or possible. Stable
  text keeps the cache stable (F16).
- **F18** TIMING of compose against `turn.start` differs by mode. Interactive (run 8): `turn.start`
  then `prompt.compose` 2-3 ms later, so a value read at `turn.start` is used by that turn's compose
  only if the read finishes first (a `$.process.run` takes ~30-70 ms; not guaranteed). `-p` streaming
  (run 7): compose runs when the PREVIOUS turn ends, before the next `turn.start`; a value read at
  `turn.start` reaches the section one turn late (observed: file edited, next turn still answered the
  old word). Reading inside the compose hook itself has neither problem.
- **F19** A hook gets 10,000 ms (`next.budget.ms` = 10000) on `session.start`, `turn.start`,
  `prompt.compose` and `classic.*`; `$` calls do not count against it (types), and in the logs
  `remainingMs` was within 2 ms of the full budget at entry.

### Order, budgets, `$.process.run`

- **F20** Order of plugin `session.start` and `classic.SessionStart` (log completion times): `-p`:
  classic completed 80 ms BEFORE `session.start`; interactive: `session.start` completed 1 ms before
  classic. Start order: not observed. Never rely on either order; a `classic.*` hook that needs the brief
  must fetch it itself.
- **F21** `session.start` fires once per process at startup (each `--resume` run is a new process and
  fired it once). Within one process it did NOT fire on `/clear` (runs 7, 8), on `/reload-plugins`
  (runs 7, 8) or after a `/compact` (run 4).
  This contradicts phase 36's F3 ("again on each /reload-plugins"): in 2.1.292 `-p` and interactive
  `/reload-plugins` printed `Reloaded: 3 plugins ... 0 hooks` and no `session.start`. Consequence: state
  loaded at `session.start` is NOT refreshed on `/clear`, and `classic.SessionStart` (source `clear`)
  re-fires with the astro hooks' output. Whether plugin module variables survive `/reload-plugins`: not
  observed (the probe keeps none).
- **F22** Two unmatched `on("session.start", ...)` registrations in one plugin are REFUSED by
  `claude plugin validate --strict` ("registered twice without a matcher"). One handler per event; put
  every `session.start` duty in it. The order of two such hooks cannot be observed.
- **F23** `$.process.run(argv, { cwd })`: the option is accepted. The default `cwd` is the session's
  (docs); `session.start`'s `e.cwd` is the project dir (`/tmp/<scratch>/proj`). A trivial `node -e 0`
  through `$.process.run` took 23-67 ms.
- **F24** `session.append` hook-context rows: the SessionStart additional context is one row
  (`door: 'hook-context'`, name `hook_additional_context`) of
  `<system-reminder>\nSessionStart hook additional context: <entry>\n<entry>...</system-reminder>`;
  `prompt.attachment` also carries it (`SessionStart hook additional context: ...`, origin
  `{plugin:'engine',tier:'core'}`) and could drop it (`{ text: null }`), but `classic.SessionStart` is the
  earlier and exact place (per entry).

### Timing of `ac` (median of 7 wall-clock runs, container, cold `node` start each)

| command | repo | seeded store |
|---|---|---|
| `ac state get` (stand-in for the feed verb, which does not exist yet) | 61 ms | 56 ms |
| `ac mods status --json --switches-only` | 57 ms | not run |
| `ac principles brief --stage session --by session` | 86 ms | 87 ms |

All are far inside the 10 s budget (F19).

### Size

- `ac principles brief --stage session --by session | wc -c` on THIS repo (real store, 2026-10-12):
  **4,841 chars, about 1,210 tokens** (chars / 4).
- On the seeded store (330 `rule`-strength entries): **148,022 chars, about 37,000 tokens**. This is
  **over the ~10k-token line, plainly: a section built from that raw output would be about 37k tokens.**
  The seed is an artificial stress store, not a real one.
- THE RAW VERB IS NOT WHAT THE HOOKS DELIVER. On the seeded store the four hooks delivered
  9,410 + 9,444 + 9,452 + 9,388 = 37,694 chars and part 4 ends with `CUT: 68 hard rules did not fit the
  session brief`. `packBrief` caps the hooks' output; `ac principles brief` prints the full text. A
  section built from the raw verb would NOT equal what the hooks print, and would be about 4x larger.
  The plan's feed verb (one `ac` verb that returns what the hooks print) is therefore required, and
  the byte-equal test of the suppression must compare against the hooks' strings (F3), not the raw verb.

## Decisions (CONTEXT decision 4)

- **(a) SessionStart: possible.** `classic.SessionStart` sees each astro `additionalContext` entry
  byte-equal and unwrapped (F2, F3) and can drop exactly it (F5); the foreign entry survives; the
  banner is not reachable from the event (F6). It cannot tell hooks apart by name (F1); it tells them
  apart by exact content, which needs the hooks' strings from `ac` (F3).
- **(a) PreCompact: possible, NOT through `classic.PreCompact`.** That event cannot see or change the
  output (F8). A `session.append` hook on `door: 'command'` can remove exactly the astro segment and
  leave the foreign one (F9-F11). Manual `/compact` only; automatic compaction is not observed (F12).
- **(b) possible.** A `session`-scope section appended last through `prompt.compose` reaches the model,
  is cached (F16), survives `/compact`, `/clear` and `/reload-plugins` (F15), and needs no invalidate
  (F17).
- **Design constraints for t2+ (from F18, F20, F21), none of them a stop:**
  - build the section text inside the `prompt.compose` hook, or accept a one-turn lag on position
    changes in `-p`; do not rely on `turn.start` running first;
  - `session.start` does not re-fire on `/clear`, while the astro SessionStart hooks do, so the
    suppression must be decided at `classic.SessionStart` itself, from state it can fetch for itself;
  - one `session.start` handler only (F22);
  - the PreCompact rewrite must remove only the exact astro segment (F11);
  - the section is the hooks' packed text, never the raw verb (Size).

Verdict: GO
