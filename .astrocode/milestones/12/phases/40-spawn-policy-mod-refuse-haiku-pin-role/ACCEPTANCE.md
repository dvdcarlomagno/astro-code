# Phase 40 — spawn-policy (re-scoped) · ACCEPTANCE

Confirm these by hand before the phase closes. The phase changes:
- the `mods.spawn-policy` switch in `~/.astro/config.json`;
- spawn-policy's description;
- `PROBE.md`.

It adds no new data model. If PROBE.md's verdict says **signal found**, this checklist is not
enough to close the phase. The replan adds the refusal items.

- [ ] **Item 1: the user can see why the refusal did or did not ship, and what they must decide.**
  - Precondition: t4 and t5 have committed; `PROBE.md` is in the phase dir.
  - Expected result: PROBE.md shows all of the following:
    - Claude Code ≥ 2.1.292;
    - a parallel run with two or more executor spawns, a sequential run and an Agent-tool run;
    - for each source, observed (with an example value) or not observed;
    - an explicit verdict.
  - On "no signal", the verdict names the choice to make: keep parked, re-probe later, or drop.

- [ ] **Item 2: the user can read spawn-policy's real scope in `ac mods status`.**
  - Precondition:
    - `ac install` has been run from this branch;
    - `mods.spawn-policy` is absent or `false` in `~/.astro/config.json`.
  - Steps: run `ac mods status spawn-policy`.
  - Expected result:
    - It describes refusing a parallel executor spawned without worktree isolation.
    - It says nothing about haiku or model pinning.
    - On "no signal", it shows the feature as not built.
  - MANUAL.md's feature table says the same.

- [ ] **Item 3: the user can switch spawn-policy on without anything being refused, haiku included.**
  - Precondition:
    - Item 2's state;
    - the `astro-mods` plugin is installed;
    - a scratch project exists with a phase of two or more independent tasks.
  - Steps:
    - Run `ac mods enable spawn-policy`. It prints "not built yet".
    - In a new Claude Code session, run that phase with `/astro-execute`.
    - Ask for one Agent-tool `astro-executor` spawn with model `haiku`.
  - Expected result: no spawn is refused, and the haiku spawn runs on haiku.

- [ ] **Item 4: the user can switch it off and get back the config they had.**
  - Precondition: Item 3 is done, and a copy of `~/.astro/config.json` was saved before it.
  - Steps: run `ac mods disable spawn-policy`.
  - Expected result: the config's `mods` keys match the copy, with spawn-policy `false`, and every
    sibling key is unchanged.

- [ ] **Item 5: the user's model choices are unchanged.**
  - Precondition: a project on the default model profile, with `ac models` output saved before
    this phase.
  - Steps: run `ac models`.
  - Expected result: each role resolves to the same model as before.
