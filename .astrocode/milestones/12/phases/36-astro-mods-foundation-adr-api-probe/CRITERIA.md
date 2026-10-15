# CRITERIA — Phase 36: astro-mods foundation (ADR, API probe, plugin skeleton, `ac mods` toggles)

Goal: astro-mods foundation: ADR, API probe, plugin skeleton and per-feature `ac mods` toggles.
Derived from the goal, `CONTEXT.md` (D1–D9) and canon only. Plan-blind.

## Sandbox used by the criteria below

Every criterion that runs `ac` or `claude` runs against a throwaway home, never the real
`~/.astro` or `~/.claude` (the global instruction forbids touching this container's runtime):

```sh
T=$(mktemp -d); mkdir -p "$T/bin" "$T/.claude"
REAL=$(command -v claude)                       # the real Claude Code CLI, if present
# logging wrapper: records every claude invocation, then runs the real binary
printf '#!/bin/sh\necho "$*" >> "%s/claude.log"\nexec "%s" "$@"\n' "$T" "$REAL" > "$T/bin/claude"; chmod +x "$T/bin/claude"
export HOME="$T"; unset CLAUDE_CONFIG_DIR; export PATH="$T/bin:$PATH"
AC="node /Users/buu/Development/astro-code/bin/ac.mjs"
```

- **OLD stub** (Claude below the floor): replace `$T/bin/claude` with a script that prints
  `2.1.287 (Claude Code)` for `--version` and otherwise only appends `$*` to `$T/claude.log`
  and exits 0.
- **NO-CLAUDE PATH**: `PATH="$(dirname "$(command -v node)"):/usr/bin:/bin"` with
  `command -v claude` confirmed empty under it.

"The 8 features" = canon-guard, git-guard (kind `hook`), blindfold, spawn-policy, witness,
brief-section, phase-band, live-capture (kind `mod`) — CONTEXT D3/D4.

---

### C1 — The decision log carries an in-force ADR that makes astro-mods an optional, Claude-only enforcement layer with the five rules and the hook/mod split, and leaves the adopter plugin surface open
- **Observe:** Read the newest ADR(s) added this phase in `.astrocode/DECISIONS.in-force.md` (or `DECISIONS.md`) and check that it was recorded via the CLI (it is present in the shared decision log, i.e. `git log` on the registry branch / `ac decision` output shows it, not only a hand-edited local file). Its text must state, in substance: (a) the canon is the source of truth and a mod only enforces a rule the canon already states, quoting it in the deny message; (b) no command or agent body may depend on a mod; (c) the mod holds no state and reads/writes only through `ac`; (d) off by default, one switch per feature; (e) fail open — a failing hook or missing `ac` lets the action through and says so once; plus the split: canon-guard and git-guard ship as `PreToolUse` settings hooks, the other six as mods. Then `$AC backlog list` (real project, read-only) still shows `2026-09-22-a-plugin-surface-for-adopters-with` open.
- **Fails if:** any of rules (a)–(e) or the hook/mod split is missing or contradicted; the ADR declares astro-mods an adopter extension point; the adopter-plugin-surface backlog item was closed, linked or graduated; or the ADR exists only as a hand-edit to `DECISIONS.md` that never reached the shared log (the ADR-034/039 silent-loss path).

### C2 — On a fresh machine `ac mods status` lists all 8 features as off, each with its kind and whether it can take effect here, in both human and `--json` form
- **Observe:** In the sandbox (no `~/.astro/config.json` at all), run `$AC mods status` and `$AC mods status --json` from a directory that is NOT an astro-code project (e.g. `cd "$T"`). Both exit 0. The JSON parses and names exactly the 8 features, each off, with kind `hook` for canon-guard/git-guard and `mod` for the other six, and a per-feature (or global) indication of whether it can take effect here that reflects the detected Claude version and whether the plugin is installed. `$AC mods status blindfold` reports only that feature. Repeat with `~/.astro/config.json` containing `{"agent_tools":{}}` (no `mods` key) — same all-off result.
- **Fails if:** a feature is missing, extra, or reported on by default; a missing key or missing file is treated as on or as an error; kinds are wrong; `--json` is not parseable or omits the availability information; status requires being inside a project; or status creates/modifies `~/.astro/config.json` (a read must not write).

### C3 — `ac mods enable|disable` flips exactly one switch, persists it in the user's `~/.astro/config.json` under `mods`, and never clobbers anything else in that file
- **Observe:** In the sandbox, write `~/.astro/config.json` = `{"agent_tools":{"*":["mcp__x__y"]},"other":1}`. Run `$AC mods enable canon-guard`, then `$AC mods status --json` → canon-guard on, the other 7 off; `cat ~/.astro/config.json` → `agent_tools` and `other` unchanged and the switch stored under `mods`. Run `$AC mods enable git-guard`, `$AC mods disable canon-guard` → status shows git-guard on, canon-guard off. Enabling a feature whose phase has not landed reports that it is not built yet while still recording the switch. Then overwrite the file with invalid JSON (`{oops`), record `sha256sum`, run `$AC mods enable git-guard` → it refuses or warns, and the file's hash is unchanged.
- **Fails if:** the switch is stored per project (e.g. under `.astrocode/`) or in a Claude profile/plugin `userConfig` instead of `~/.astro/config.json`; sibling keys or other switches are lost or altered; enable/disable is not reflected by status; a not-yet-built feature is silently accepted with no notice or refused without recording; or an unparseable config file is overwritten (REQ-008: skip unparseable rather than clobber).

### C4 — An unknown feature name is refused and changes nothing
- **Observe:** In the sandbox with a known `~/.astro/config.json` (hash recorded), run `$AC mods enable blindfolds`, `$AC mods disable nope`, and `$AC mods status nope`. Each exits non-zero with a `✖` message that lists or points to the valid feature names; the config file hash is unchanged (and, if it did not exist, it still does not); `$T/claude.log` records no `plugin` invocation.
- **Fails if:** a typo'd name is accepted and written as a new key, exits 0, or triggers any plugin install/marketplace action.

### C5 — Enabling a `mod`-kind feature where Claude Code is older than 2.1.292 or absent records the switch, warns once naming the needed version / Claude-only nature, and attempts no plugin install; `hook`-kind features are not gated
- **Observe:** (a) Sandbox with the OLD stub: `$AC mods enable blindfold` exits 0; status shows blindfold on and not able to take effect here; output contains exactly one warning line naming `2.1.292`; `$T/claude.log` contains no `plugin` invocation. `$AC mods enable canon-guard` produces no version warning. (b) Sandbox with the NO-CLAUDE PATH: `$AC mods enable witness` records the switch and says it is Claude-only (no Claude Code found); nothing else changes (no `~/.astro/code/mods` side effects beyond what existed, no errors). `$AC mods status --json` reports the Claude version as absent.
- **Fails if:** the floor is anything other than 2.1.292; the switch is refused instead of recorded; a plugin install/marketplace command is attempted on an old/absent Claude; the warning is repeated per feature line or missing; `hook` features are blocked or warned by the floor; or a missing `claude` binary crashes the command.

### C6 — The first `enable` of a `mod`-kind feature on Claude Code ≥ 2.1.292 installs the astro-mods plugin from the `astro-code` marketplace; later enables do not reinstall; disabling everything leaves it installed but inert
- **Observe:** Real `claude` ≥ 2.1.292 behind the logging wrapper (if `claude --version` is below the floor, this criterion cannot be observed and is reported FAIL with that reason). In the sandbox: `$AC install`, then `$AC mods enable blindfold`. Then `claude plugin marketplace list` (same env) shows a marketplace named `astro-code` sourced from `$T/.astro/code/mods`, and `claude plugin list` shows `astro-mods@astro-code` installed. `$AC mods status --json` now reports the plugin installed. Run `$AC mods enable witness` → `$T/claude.log` gains no second `plugin install`. Run `$AC mods disable blindfold` and `$AC mods disable witness` → `claude plugin list` still shows `astro-mods@astro-code`; the log contains no `uninstall`/`marketplace remove`.
- **Fails if:** enabling a mod feature on a qualifying Claude leaves the plugin uninstalled; the marketplace points at the repo checkout instead of the installed astro home; a `hook`-kind enable installs the plugin; each enable reinstalls; or disabling the last feature uninstalls the plugin.

### C7 — A pre-existing, different marketplace named `astro-code` is detected and refused with a fix line, leaving it untouched
- **Observe:** Real `claude` ≥ 2.1.292, sandbox. Create an unrelated valid local marketplace at `$T/other` (a `.claude-plugin/marketplace.json` named `astro-code` with one trivial plugin), `claude plugin marketplace add "$T/other"`. Run `$AC install` then `$AC mods enable blindfold`. The command reports the collision and a concrete fix (e.g. the command to remove/rename it) and exits non-zero or warns without installing; `claude plugin marketplace list` still shows `astro-code` sourced from `$T/other`. The switch state reported by status is consistent with what the output said.
- **Fails if:** the user's existing `astro-code` marketplace is replaced, removed or silently reused to install a different `astro-mods`; or the collision produces a raw `claude` error with no fix line.

### C8 — `ac install` only offers mods (one line, only on a qualifying Claude) and ships a valid marketplace into the astro home, without installing the plugin or flipping any switch
- **Observe:** Sandbox with real `claude` ≥ 2.1.292: `$AC install` output contains exactly one line offering `ac mods enable …`; afterwards `claude plugin list` does not show astro-mods, `~/.astro/config.json` has no switch turned on, and `claude plugin validate "$T/.astro/code/mods"` (and/or on the plugin directory inside it) succeeds. Fresh sandbox with the OLD stub, and again with the NO-CLAUDE PATH: `$AC install` output contains no mods offer line and `$T/claude.log` has no `plugin` invocation. `$AC install` exit status is 0 in all three.
- **Fails if:** install enables any feature or installs the plugin; the offer appears on an old/absent Claude or appears more than once; the mods marketplace is not present/valid under the astro home after install; or install fails on a machine without Claude.

### C9 — `ac update` refreshes an installed astro-mods plugin (and does not install an absent one); `ac uninstall` removes both the plugin and the marketplace
- **Observe:** Real `claude` ≥ 2.1.292, sandbox. `git clone /Users/buu/Development/astro-code "$T/clone"` (local, no network). Case A (plugin not installed): `HOME=$T node "$T/clone/bin/ac.mjs" update "$T/clone"` → `$T/claude.log` has no `plugin install`/`plugin update astro-mods` and `claude plugin list` lacks astro-mods. Case B: `$AC install; $AC mods enable blindfold`, then the same update → log contains a `plugin update astro-mods@astro-code` invocation and `claude plugin list` still shows it installed. Then `$AC uninstall` → `claude plugin list` no longer shows astro-mods and `claude plugin marketplace list` no longer shows `astro-code`.
- **Fails if:** update leaves an installed plugin stale (no update call) or installs it when the user never enabled a mod feature; uninstall leaves the plugin or the marketplace registered (a dangling marketplace pointing at a deleted `~/.astro/code/mods`).

### C10 — Multi-profile Claude setups are handled explicitly: the plugin reaches every profile `ac install` already fans out to, or the default-only limitation is stated rather than silent
- **Observe:** Sandbox with real `claude` ≥ 2.1.292 and a jean-claude profile registry: `$T/.claude/.jean-claude/profiles.json` = `{"profiles":{"p2":{"configDir":"$T/p2"}}}`, `mkdir -p $T/p2`. `$AC install; $AC mods enable blindfold`. Then `CLAUDE_CONFIG_DIR=$T/p2 claude plugin list`. Either astro-mods is installed there too, OR the `ac mods enable`/`status` output names the default dir as the only one covered and the phase record (PROBE.md or the ADR) states that `claude plugin` does not honour `CLAUDE_CONFIG_DIR`, as a known gap.
- **Fails if:** the plugin lands in only the default profile with nothing in the command output or the phase record saying so; or a profile dir receives a marketplace without the plugin (half-installed).

### C11 — The astro-mods plugin passes Claude Code's own plugin checks
- **Observe:** With real `claude` ≥ 2.1.292: `claude plugin validate` on the repo's astro-mods plugin and on the marketplace exits 0 with no errors; `claude plugin test` on the plugin exits 0. Separately, the repository test suite exercises this check when `claude` is on PATH and skips it cleanly (reported as skipped, not failed, not erroring at load) when run with the NO-CLAUDE PATH: `PATH=<NO-CLAUDE PATH> node --test tests/` exits 0.
- **Fails if:** validate or test reports an error; the plugin only passes under a hand-written manifest the marketplace does not reference; or the suite fails/crashes on a machine without `claude` (zero-dev-deps constraint).

### C12 — The plugin skeleton enforces nothing and fails open: with every switch off, or with `ac` missing/broken/slow, every handler passes the action through and the user is told at most once per session
- **Observe:** Drive the plugin's registered hook module(s) in `node` with a recording stub of the Claude Code mod API (event shapes as recorded in PROBE.md), in the sandbox: (a) all switches off — call each registered handler (including `session.start`) with representative events; every one resolves to pass-through (`next(e)` or equivalent), none denies/refuses/modifies a tool call, spawn or prompt. (b) `ac` absent from PATH, (c) `ac` replaced by a stub that exits 1 / prints non-JSON, (d) `ac` replaced by a stub that sleeps past any timeout — in each case `session.start` and all handlers still resolve to pass-through within a bounded time, no exception escapes, and across repeated invocations in one session exactly one user-visible toast/notice is emitted. (e) With a switch on for a not-yet-built feature, behaviour is still pass-through. Alternatively observe the same with `claude plugin test` if it drives these events.
- **Fails if:** any handler denies or alters an action in this phase; a thrown error, rejected promise or hang propagates to Claude (fail-closed); a missing `ac` produces a toast per event instead of once; or the plugin keeps its own state file instead of reading switches through `ac` (rule c — observable as switches changed via `ac mods` not being what the plugin sees on next `session.start`).

### C13 — The API probe ran against real Workflow-spawned agents and its findings — observed fields, Claude version, and anything missing — are recorded in the phase directory
- **Observe:** Read `PROBE.md` in this phase's directory. It names the Claude Code version the probe ran on and the run it observed (a real `/astro-execute` with Workflow-spawned agents, not only Agent-tool spawns), and lists, per event, the fields actually seen with example values: `agent.spawn` (agent type/name, model, isolation, isTeammate, workflow run/index, id), `tool.check` (agentId, tool, input, decision), `prompt.submit` (origin / whether a human typed it). Any field not observed is listed as missing, never filled from docs; if the version was below 2.1.292, phases 39/40 are flagged blocked on the upgrade. Then `claude --plugin-dir <committed probe plugin dir> plugin validate`/`claude plugin validate <probe dir>` succeeds, confirming the committed probe is loadable. Every event field the astro-mods skeleton reads is one PROBE.md records as observed.
- **Fails if:** PROBE.md is absent, documents only Agent-tool spawns, presents doc-sourced fields as observed, omits the version, hides missing fields, or the skeleton reads an event field PROBE.md does not record as observed; or the probe plugin is not loadable.

### C14 — No shipped command or agent body depends on a mod, and a guard test proves it by failing when such a dependency is introduced
- **Observe:** `node --test tests/` passes on the real tree. Then copy the repo to a scratch dir (`cp -r /Users/buu/Development/astro-code "$S"`), and in the copy append to one shipped command body (e.g. `commands/astro-execute.md`) the sentence ``Run `ac mods enable blindfold` before continuing.`` → `node --test tests/` in the copy FAILS, naming the file. Revert, then append instead to an agent body (e.g. an `agents/*.md`) ``Requires the astro-mods plugin.`` → the suite FAILS. Revert, then append an explicitly optional sentence such as ``Optionally, on Claude Code, `ac mods enable blindfold` can enforce this.`` → the suite PASSES.
- **Fails if:** a required-dependency sentence in a command or agent body goes unnoticed; agent bodies are not covered; or the matcher is so broad that an explicitly optional mention fails the suite.

### C15 — The whole suite stays green on the zero-dependency substrate
- **Observe:** From a fresh `git clone` of the branch into a scratch dir with no `node_modules` and no install step, run `node --test tests/` → exit 0 with zero failures; `node -e "const p=require('./package.json');process.exit(Object.keys({...p.dependencies,...p.devDependencies}).length)"` exits 0.
- **Fails if:** any test fails, the suite needs an install step, or the phase added a runtime or dev dependency (REQ-001/ADR-001).
