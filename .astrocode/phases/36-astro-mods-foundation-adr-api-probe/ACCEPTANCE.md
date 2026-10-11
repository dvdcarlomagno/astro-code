# Phase 36 — astro-mods foundation · ACCEPTANCE

Confirm on the developer's Mac (through `host …` from the container). The data this phase
adds is the `mods` key in `~/.astro/config.json` and the `astro-code` marketplace / `astro-mods`
plugin entries in each Claude config dir; each item names the state it assumes.

- [ ] **The user can see every enforcement feature, all off, with `ac mods status`.**
  Precondition: `ac install` run from this branch; `~/.astro/config.json` either absent or
  holding other keys (e.g. `agent_tools`) but no `mods` key. `ac mods status` lists the 8
  features (canon-guard and git-guard as `hook`, the other six as `mod`) as off, names the
  Claude Code version, and `~/.astro/config.json` is byte-identical afterwards.

- [ ] **The user can turn one mod on and get the plugin in every Claude profile, with nothing
  blocked.** Precondition: Claude Code ≥ 2.1.292 on the Mac, no marketplace named
  `astro-code` registered yet (`claude plugin marketplace list`), state as in item 1, and
  each jean-claude profile (if any) noted. `ac mods enable blindfold` says it is on and not
  built yet, and reports astro-mods installed per config dir; `claude plugin list` (per
  profile) shows `astro-mods@astro-code`; a new Claude Code session works normally — no tool
  call, spawn or prompt is refused, and no astro-mods notice appears.

- [ ] **The user is told once — and never blocked — when `ac` is unavailable to the plugin.**
  Precondition: the plugin installed by item 2 and `blindfold` on. Start a Claude Code session
  with `ac` off the PATH (e.g. `PATH` without the npm global bin). Exactly one astro-mods notice
  appears, and every action in the session (edit, Bash, subagent) still goes through.

- [ ] **The user can turn the mod off and keep a clean, refreshable install.**
  Precondition: state after item 2 (blindfold on, plugin installed), the existing user keys in
  `~/.astro/config.json` noted. `ac mods disable blindfold` leaves those keys untouched, the
  plugin still listed and inert; `ac update` then prints an astro-mods refresh line and the
  plugin is still installed.

- [ ] **The user can read what Claude Code really exposes to mods, from a real `/astro-execute`.**
  Precondition: `PROBE.md` written in this phase directory by the executor. It names the
  Claude Code version and the runs, lists per event the fields actually seen (Workflow agents
  included) and marks the rest "not observed". If it marks the composer (human-typed) prompt
  origin "not observed": run
  `ASTRO_MODS_PROBE_LOG=/tmp/probe.jsonl claude --plugin-dir <repo>/scripts/mods-probe`,
  type one prompt and `/astro-status`, and confirm the logged `prompt.submit`/`command.run`
  origin is recorded in PROBE.md before accepting.
