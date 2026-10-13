# Acceptance — phase 43: phase-band mod

Every item assumes an interactive Claude Code ≥ 2.1.292 (terminal or the Desktop Code tab), `ac install` from this branch, and `ac mods enable phase-band`. Each item also names the project data it needs.

- [ ] **The user can see one quiet band line above the prompt with a next-command button whose command matches the `Next:` line of `ac status`, plus at most two sibling buttons.**
  - Precondition: this repo, or any project whose current milestone has at least one phase that is not complete.

- [ ] **Pressing a band button puts the command in the composer (for example `/astro-execute 38`) without running it. Nothing happens until the user presses Enter.**
  - Precondition: same as above.

- [ ] **The user can accept a phase from its `Accept N` button. After Enter, `ac roadmap` records that phase as accepted by a human, with no `--agent` added by the band.**
  - Precondition: a scratch project with one phase in `verified` state.

- [ ] **Typing a command and a space offers the matching ids, with short labels:**
  - `/astro-plan ` offers phase numbers with their state;
  - `/astro-debt-pay ` offers open debt ids with titles;
  - `/astro-backlog-promote ` offers backlog ids;
  - `/astro-fix-accept ` offers fix ids.

  Typing `4` after `/astro-plan ` narrows the list.
  - Precondition: at least one open debt item, one open backlog item and one open fix. This repo has them; otherwise file one of each with `ac debt add`, `ac backlog add` and `ac fix add`.

- [ ] **While `/astro-execute` runs, the user sees the band expand to show the run, then collapse to one line after it.** Where the band cannot see the workflow's agents one by one, it says so instead of inventing rows.
  - Precondition: a scratch project with one planned phase that has at least 2 tasks.

- [ ] **The user sees nothing from the band in these cases:**
  - in a directory with no `.astrocode/` above it;
  - after `ac mods disable phase-band`.

  When `ac` is broken (for example, removed from `PATH`), the band shows one dim "astro-code status unavailable" line and no error. In all three cases the statusline looks exactly as it did before this phase.
  - Precondition: this repo, plus any directory outside an astro-code project.
