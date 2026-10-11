<!-- astro-discuss: captured -->
# Phase 36 — astro-mods foundation: ADR, API probe, plugin skeleton and per-feature ac mods toggles

Milestone 12 (see PROJECT.md §Milestone 12; research: https://claude.ai/artifact/7BSBvicXocd4gfuUkUBkq5).
This phase builds the ground phases 39–44 (mods) stand on, and the switch surface phases 37–38
(settings hooks) also use. It ships **no enforcement feature itself**.

## Decisions

1. **ADR (first task).** Record via `ac decision add`: astro-mods is an *optional, Claude-only
   enforcement layer*. Rules:
   (a) the canon is the source of truth: a mod only enforces a rule the canon already
   states, and its deny message quotes that ADR/convention;
   (b) no command or agent body may depend on a mod;
   (c) the mod holds no state of its own and reads/writes only through `ac`;
   (d) off by default, one switch per feature;
   (e) fail open: a failing hook or a missing `ac` lets the action through and toasts once.
   Also record the split: features that need no per-agent knowledge (canon-guard, git-guard)
   ship as `PreToolUse` settings hooks, which Cursor imports too; the rest are mods.
   The ADR **leaves the adopter plugin-surface question open**: astro-mods is not declared an
   adopter extension point, and backlog item `2026-09-22-a-plugin-surface-for-adopters-with`
   is not linked or closed.
2. **Distribution: a local marketplace.**
   - `mods/` in the repo holds `.claude-plugin/marketplace.json` (marketplace name
     `astro-code`) and `astro-mods/` (`.claude-plugin/plugin.json`, `hooks/hooks.json` →
     `{ "modules": ["./register.js"] }`, `hooks/register.js`).
   - `ac install` copies or links it to `~/.astro/code/mods` like the other assets.
   - Installation into Claude Code: `claude plugin marketplace add ~/.astro/code/mods` +
     `claude plugin install astro-mods@astro-code`.
   - `ac update` runs `claude plugin update astro-mods@astro-code` when the plugin is installed.
   - `ac uninstall` removes the plugin and the marketplace.
   - Fan out across Claude config dirs the way `lib/hosts/claude.mjs` already does
     (jean-claude profiles / `CLAUDE_CONFIG_DIR`), if the `claude plugin` CLI honours
     `CLAUDE_CONFIG_DIR`. Otherwise: the default dir only, recorded as a known gap.
3. **Switches live in `~/.astro/config.json`** under `mods`, next to `agent_tools`, e.g.
   `{ "mods": { "canon-guard": false, "git-guard": false, "blindfold": false,
   "spawn-policy": false, "witness": false, "brief-section": false, "phase-band": false,
   "live-capture": false } }`. A missing key means off.
   - This is the single source for the mod and for the settings hooks (37/38), on every host.
   - The mod reads it through `ac` (e.g. `ac mods status --json`) at `session.start`, and
     re-reads it on `/reload-plugins`.
   - No per-project override in this milestone (deferred).
   - Not plugin `userConfig`: that is per Claude profile and invisible to the settings hooks.
4. **CLI: `ac mods enable|disable|status [<feature>] [--json]`.**
   - A new `lib/mods.mjs` handles validation, read/write of the `mods` key, and the version
     check. Named exports, a `node:test` suite, zero deps.
   - `bin/ac.mjs` adds only a thin `case 'mods'`.
   - The feature registry is a constant in `lib/mods.mjs`: name, kind (`mod` | `hook`), and
     a one-line description. All 8 features are listed now; until a feature's phase lands,
     enabling it records the switch and says "not built yet".
   - `status` lists each feature with on/off, its kind, and whether it can take effect here
     (Claude version, plugin installed).
5. **Enable installs the plugin on first need.** The first `enable` of a `kind: mod`
   feature installs astro-mods if absent. Disabling the last feature leaves the plugin
   installed but inert (every hook returns `next(e)`). Plain `ac install` only prints a
   one-line offer (`ac mods enable …`), and only when Claude Code ≥ the floor is found.
6. **Version floor: 2.1.292 for the whole plugin**, one constant. It is the first release
   with both `e.agentId` on `tool.check` (2.1.290) and workflow agents on `agent.spawn`
   (2.1.292). When Claude Code is older or absent, `enable` **records the switch and warns
   once**, naming the needed version. On a Codex-only or Cursor-only machine, enabling a
   `kind: mod` feature says it is Claude-only and changes nothing else. `kind: hook`
   features are not gated by this floor.
7. **The probe is committed, not shipped.** It lives at `scripts/mods-probe/`, a plugin
   loadable with `claude --plugin-dir scripts/mods-probe`. It logs to a file the fields of
   `agent.spawn` (agent type/name, model, isolation, isTeammate, workflow run/index, id),
   `tool.check` (agentId, tool, input, decision) and `prompt.submit` (origin / whether a
   human typed it, needed by phase 41).
   - Run it during a real `/astro-execute`, i.e. Workflow-spawned agents, not just Agent-tool ones.
   - Record the findings in this phase's directory as `PROBE.md`.
   - The plugin skeleton's typed assumptions are taken from PROBE.md, not the docs.
8. **Plugin skeleton behaviour.**
   - `register.js` registers `session.start` (reads the switches via `ac`) and nothing that
     enforces anything.
   - Each feature lives in its own module/file and is wired in only when its switch is on,
     so phases 39–44 each add one file plus one line of wiring.
   - Fail-open helper: one shared wrapper turns a thrown or timed-out hook into
     `next(e)` plus one toast per session.
   - The plugin must pass `claude plugin validate` and `claude plugin test` (test in CI only
     if `claude` is available; skip cleanly otherwise, since zero dev deps).
9. **Parity test.** Extend `tests/commands.test.mjs` (or `tests/hosts.test.mjs`): no shipped
   command or agent body names `astro-mods`, `ac mods` or a mod feature as required. A
   mention is allowed only inside an explicitly optional sentence; keep the matcher simple
   and documented.

## Prerequisite

- **Container Claude Code ≥ 2.1.292 before the probe runs.** It is 2.1.287 as of
  2026-10-11. The agent must not touch the astro-forge container (global instruction); the
  user upgrades it (committed to a redeploy to ≥ 2.1.292 on 2026-10-11). If execute finds it below 2.1.292, run the probe anyway, record which
  fields are missing in PROBE.md, and flag phase 39/40 as blocked on the upgrade. Do not
  guess fields.

## Out of scope

- Any enforcement logic: canon-guard (37), git-guard (38), blindfold (39), spawn-policy (40),
  witness (41), brief-section (42), phase-band (43), live-capture (44).
- Per-project/team switches; publishing to a public marketplace; the adopter plugin surface.
- Debt `2026-09-17-ac-install-uses-symlinksync-with-no` (Windows symlink EPERM) and backlog
  `2026-09-22-ac-install-leaves-stale-command`: explicitly left out.

## Open questions / assumptions

- Whether `claude plugin marketplace add|install|update` honour `CLAUDE_CONFIG_DIR`, which
  decides whether the multi-profile fan-out is possible. Check during planning.
- `ac mods status` reports the Claude version via `claude --version`. When several `claude`
  binaries exist, it uses the first on PATH (same as the hooks).
- The marketplace name `astro-code` must not collide with an existing marketplace the user
  added. Detect the collision and refuse with a fix line.
