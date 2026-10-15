# Phase 38 — git-guard · ACCEPTANCE

Confirm these on the developer's Mac, through `host …` from the container.

This phase adds three kinds of data:
- the `mods.git-guard` switch in `~/.astro/config.json`;
- one `PreToolUse` entry with matcher `Bash` in each Claude config dir's `settings.json`;
- on a Cursor-native machine, one `preToolUse` `Shell` entry in `~/.cursor/hooks.json`.

canon-guard's entries from phase 37 may already be present. They must survive every step.

Each item names the state it assumes. Run the items in order: each one starts from the state the
previous one left.

- [ ] **Item 1: the user can switch git-guard on and see where it is enforced, and how.**
  - Precondition:
    - `ac install` has been run from this branch.
    - `git-guard` is off. The `mods` key is absent or set to `false`.
    - A copy of every Claude profile's `settings.json` has been saved. At least one holds a hook of
      the user's own, or canon-guard's entry.
  - Steps and expected result:
    - Run `ac mods status git-guard`. It shows git-guard available and off, and does NOT say
      "not built yet".
    - Run `ac mods enable git-guard`. It reports the guard written into each Claude config dir.
    - Run `ac mods status git-guard`. It shows git-guard on and enforced (asks) in every profile,
      and states Cursor's position explicitly (denies, or not enforced).

- [ ] **Item 2: the user's agent is stopped, with directions, when it runs unscoped destructive git.**
  - Precondition:
    - Item 1 is done.
    - A scratch git repo exists with one modified tracked file and one untracked file.
    - A NEW headless run is used: `claude -p --permission-mode bypassPermissions`.
  - Ask the agent to run each of these:
    - `git stash -u`;
    - `cd . && git reset --hard`;
    - `git clean -fd`.
  - Expected result:
    - Each call is refused, and the run ends on its own with no hang.
    - The relayed reason cites ADR-035/038, says the stash stack is repository-wide, and names
      `git stash push -- <path>` … `git stash pop` and `ac mods disable git-guard`.
    - Afterwards `git stash list` is empty, and both files are unchanged.

- [ ] **Item 3: in the user's own interactive session, a deliberate reset can still be approved.**
  - Precondition:
    - Item 1 is done.
    - A NEW interactive Claude Code session is open in the scratch repo from item 2.
  - Steps:
    - Ask the agent to run `git reset --hard`.
  - Expected result:
    - Claude Code shows an approval prompt carrying the git-guard reason.
    - Declining leaves the tree as it was.
    - Approving runs the reset.

- [ ] **Item 4: scoped and everyday git is never interrupted.**
  - Precondition:
    - Item 1 is done.
    - The scratch repo from item 2 is restored, with a modified file and an untracked file again.
  - Steps:
    - Ask the agent to run `git stash push -- <the modified file>` then `git stash pop`.
    - Ask it to run `git status`, `git log --oneline`, and `git commit -m "avoid git reset --hard"`
      on a staged change.
  - Expected result:
    - None of these is refused or prompted.

- [ ] **Item 5: the user can switch git-guard off and get back exactly what they had.**
  - Precondition:
    - Items 1–4 are done.
    - The settings copies from item 1 are at hand.
  - Steps:
    - Run `ac mods disable git-guard`.
  - Expected result:
    - Each profile's `settings.json` is JSON-equal to its saved copy. Any canon-guard entry and
      the user's own hooks are untouched.
    - In a new session, `git stash -u` in the scratch repo is no longer refused.
