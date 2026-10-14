# Phase 42 — brief-section · ACCEPTANCE

Confirm these on the developer's Mac, through `host …` from the container. Run the items in order:
each one starts from the state the previous one left.

This phase adds only one piece of data: the `mods.brief-section` switch in `~/.astro/config.json`.
It adds no settings-hook entry. Every item assumes the following state:
- Claude Code ≥ 2.1.292.
- `ac install` has been run from this branch, so the astro-mods plugin is installed in the Claude
  profile used.
- An astro-code project with:
  - an active milestone and phase;
  - accepted principles in scope. Enough that `ac principles brief` prints more than 9,500
    characters, so today's hooks split it into ≥ 2 parts.
- `principles.sessionBrief` is not set to `false`.

- [ ] **Item 1: the user can see brief-section is built and switch it on without touching settings.**
  - Precondition:
    - `brief-section` is off (the `mods` key is absent or `false`).
    - A copy of every Claude profile's `settings.json` has been saved, and of Cursor's
      `~/.cursor/hooks.json` if present.
  - Steps:
    - Run `ac mods status brief-section`.
    - Run `ac mods enable brief-section`.
  - Expected result:
    - The status no longer says "not built yet".
    - Enable succeeds and reports it on.
    - Every saved settings file is byte-identical, and the SessionStart and PreCompact astro
      hooks are still listed.

- [ ] **Item 2: in a new Claude session the user's model has the whole brief once, as part of the system prompt, and the banner still shows.**
  - Precondition:
    - Item 1 is done.
    - A NEW interactive session is opened in the project.
  - Steps:
    - Look at the start-up banner.
    - Run `/context`, or inspect the transcript (ctrl-o).
    - Ask the model to quote the first and last line of its principles brief and its current
      astro-code position.
  - Expected result:
    - The astro banner and any update nudge appear as before.
    - No SessionStart hook context carries brief parts.
    - The model quotes the brief's first and last lines exactly as `ac principles brief` prints
      them, with no "part K of N" markers.
    - The model also quotes a one-line position that matches `ac status`.

- [ ] **Item 3: after `/compact` the user's session still has the brief exactly once.**
  - Precondition:
    - The session from item 2 is still open, with at least two turns.
  - Steps:
    - Run `/compact`, then ask the same question as in item 2.
  - Expected result:
    - The brief and the position are still known.
    - The transcript shows no re-injected brief parts and no PreCompact position note beside the
      section.

- [ ] **Item 4: the user moves the project forward and the next turn knows, while an idle turn changes nothing.**
  - Precondition:
    - The session from item 3 is still open.
  - Steps:
    - In a separate shell, move the project's state with `ac`. For example, advance the active
      phase or its status.
    - In the session, send one more prompt asking for the position.
  - Expected result:
    - The position line now shows the new phase or state.
    - The brief text is unchanged.

- [ ] **Item 5: if `ac` cannot answer, the user still gets today's brief and is told once.**
  - Precondition:
    - brief-section is on.
    - Start a NEW session with `ac` hidden from the plugin's PATH. For example, launch
      `PATH=<a PATH without ac> claude` while the hooks keep their absolute `ac` path.
  - Expected result:
    - Exactly one astro-mods notice appears.
    - The session starts normally.
    - The brief arrives through the SessionStart hooks, as before the phase.
    - No system-prompt section exists.

- [ ] **Item 6: the user switches it off and gets exactly what they had.**
  - Precondition:
    - The settings copies from item 1 are at hand.
  - Steps:
    - Run `ac mods disable brief-section`.
    - Open a NEW session in the project.
  - Expected result:
    - Every settings file is still byte-identical to its copy.
    - The brief arrives in hook parts, as before the phase.
    - Cursor and Codex sessions in the project receive their brief unchanged throughout, whether
      the switch is on or off.
