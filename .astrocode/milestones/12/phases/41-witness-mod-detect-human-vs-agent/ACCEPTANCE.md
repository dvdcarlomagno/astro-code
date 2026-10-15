# Phase 41 — witness · ACCEPTANCE

Confirm these on the developer's Mac, through `host …` from the container. Use Claude Code
2.1.292 or newer.

This phase adds the following data:
- the `mods.witness` switch in `~/.astro/config.json`;
- `accepted_evidence: "composer"` on a phase's roadmap entry and on a fix record;
- `evidence: "composer"` on a phase rejection entry;
- the agent form of the CONTEXT.md marker, written by witness.

Records made before this phase carry none of these. Item 5 checks that they stay that way.

Shared precondition for items 2-5, the **scratch project**:
- a throwaway git repo with `ac init`;
- phases `1` and `2`, each set to `verified` with a one-line `ACCEPTANCE.md`;
- phase `3` `pending`;
- one phase `0` already accepted before this branch was installed. Copy it from an existing
  project, or accept it with the previous `ac`. It holds `accepted_kind: "human"` and no
  `accepted_evidence`.

Run the items in order. Each one starts from the state the previous one left.

- [ ] **Item 1: the user can switch witness on and see it is built.**
  - Precondition:
    - `ac install` has been run from this branch.
    - `witness` is off, meaning the `mods` key is absent or `false`.
  - Steps:
    1. Run `ac mods status witness`. It shows witness as a built Claude-only mod that is off, and
       does NOT say "not built yet".
    2. Run `ac mods enable witness`. It exits 0, and the astro-mods plugin is installed.
    3. Run `ac mods status witness` again. It shows witness on and able to take effect.

- [ ] **Item 2: when the user types `/astro-accept 1` and accepts, the record says a human
  typed it.**
  - Precondition:
    - Item 1 is done.
    - The scratch project is set up, with phase 1 `verified`.
    - A NEW interactive Claude Code session is open in the scratch project.
  - Steps:
    1. Type `/astro-accept 1` and confirm the checklist with accept.
    2. Run `ac phase show 1`.
  - Expected:
    - The accept line said `witnessed`.
    - `ac phase show 1` shows `accepted_kind: "human"` and `accepted_evidence: "composer"`.

- [ ] **Item 3: an unattended run still closes a phase, recorded as agent and never blocked.**
  - Precondition:
    - Items 1-2 are done.
    - Phase 2 of the scratch project is `verified`.
  - Steps:
    1. Run `claude -p --permission-mode bypassPermissions "/astro-accept 2"` in the scratch
       project. Alternatively, in the interactive session, type a prompt that is NOT
       `/astro-accept 2` and asks the agent to accept phase 2.
  - Expected:
    - The run finishes on its own.
    - Phase 2 is `complete`.
    - `ac phase show 2` shows `accepted_kind: "agent"`, `accepted_by: "claude"` and no
      `accepted_evidence`.

- [ ] **Item 4: a discussion the user did not start is marked as agent-captured.**
  - Precondition:
    - Item 1 is done.
    - Phase 3 of the scratch project is `pending` and has no `CONTEXT.md`.
    - An interactive session is open.
  - Steps:
    1. Without typing `/astro-discuss 3`, ask the agent to write
       `.astrocode/phases/03-…/CONTEXT.md` with `<!-- astro-discuss: captured -->` as its first
       line.
    2. Run `ac phase context 3 --author`.
  - Expected:
    - The file's first line is `<!-- astro-discuss: captured by agent: claude -->`, and the rest
      is as the agent wrote it.
    - `ac phase context 3 --author` prints `agent claude`.

- [ ] **Item 5: with witness off, everything behaves as before, and old sign-offs are untouched.**
  - Precondition:
    - Items 1-4 are done.
    - Phase 0's entry was saved, via `ac phase show 0`, before item 2.
  - Steps:
    1. Run `ac mods disable witness`.
    2. In a new session, add and verify one more phase, then type `/astro-accept <it>` and
       accept.
  - Expected:
    - The accept line has no `witnessed`.
    - That phase's record has `accepted_kind: "human"` and no `accepted_evidence`.
    - `ac phase show 0` is identical to the saved copy.
    - `ac phase accept <n> --witnessed composer --agent bot` on any verified phase is refused
      with a `✖` line, and the phase stays `verified`.
