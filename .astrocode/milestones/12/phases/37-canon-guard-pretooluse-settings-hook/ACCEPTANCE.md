# Phase 37 — canon-guard · ACCEPTANCE

Confirm these on the developer's Mac, through `host …` from the container.

This phase adds three kinds of data:
- the `mods.canon-guard` switch in `~/.astro/config.json`;
- one `PreToolUse` entry per Claude config dir `settings.json`;
- on a Cursor-native machine, one `preToolUse` entry in `~/.cursor/hooks.json`.

Each item below names the state it assumes. Run the items in order: each one starts from the
state the previous one left.

- [ ] **Item 1: the user can switch canon-guard on and see where it is enforced.**
  - Precondition:
    - `ac install` has been run from this branch.
    - `canon-guard` is off. The `mods` key is absent or set to `false`.
    - Every Claude profile's `settings.json` has been noted. A copy of each was saved, and at
      least one holds a hook of the user's own.
  - Steps and expected result:
    - Run `ac mods enable canon-guard`. It reports the guard written into each Claude config
      dir, and it does not print "not built yet".
    - Run `ac mods status canon-guard`. It shows the feature on and enforced in every profile,
      and it states Cursor's position explicitly.

- [ ] **Item 2: the user's agent is stopped, with directions, when it hand-edits a protected file.**
  - Precondition:
    - Item 1 is done, so canon-guard is on and enforced.
    - An astro-code project is open in a new Claude Code session. This repo works: its
      `.astrocode/` holds `roadmap.json`, `state.json` and `ROADMAP.md`.
  - Ask the agent for these three edits:
    - edit `.astrocode/state.json` by hand;
    - run `echo x >> .astrocode/ROADMAP.md`;
    - write a file under `~/.astro/principles/`.
  - Expected result:
    - Each attempt is refused.
    - Each refusal message names the rule and the right `ac` command for that file, for example
      `ac roadmap render` for ROADMAP.md.
    - Each refusal message names the escape: `ac mods disable canon-guard`.
    - The files are unchanged afterwards (`git status`).

- [ ] **Item 3: the user's normal work is not slowed or blocked.**
  - Precondition: the session from item 2.
  - Ask the agent to do these:
    - edit `.astrocode/phases/37-…/PLAN.md`, `.astrocode/config.json` and a source file;
    - run `ac status`, `cat .astrocode/state.json`, `jq . .astrocode/roadmap.json` and
      `git add .astrocode/roadmap.json`.
  - Expected result: every one of them goes through with no prompt and no refusal, and tool
    calls feel no slower.

- [ ] **Item 4: the user can still resolve a merge conflict in a protected file.**
  - Precondition:
    - canon-guard is on.
    - A scratch astro-code repo has two branches that change the same line of
      `.astrocode/roadmap.json`.
    - `git merge` has left that file conflicted (`UU`).
  - Expected result:
    - The agent may edit the conflicted `roadmap.json` to resolve it.
    - An edit to the clean `state.json` in the same repo is still refused.
    - After `git add` and commit, an edit to `roadmap.json` is refused again.

- [ ] **Item 5: the user can switch canon-guard off and get the settings back exactly as they were.**
  - Precondition:
    - The state after items 1–4.
    - The `settings.json` copies saved in item 1.
  - Steps and expected result:
    - Run `ac mods disable canon-guard`. Each profile's `settings.json` is JSON-equal to its
      saved copy, and the user's own hooks are intact.
    - Run `ac install`. No guard entry comes back.
    - Run `ac mods enable canon-guard`, then `ac install`. The result is still exactly one entry
      per profile.
