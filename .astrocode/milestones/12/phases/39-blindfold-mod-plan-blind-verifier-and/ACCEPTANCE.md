# Acceptance — phase 39: blindfold mod

A human confirms each item before `ac phase accept 39`. Items 1–3 apply only if
`PROBE.md` ends in `Verdict: join found`; item 5 applies only if it ends in `Verdict: no join`.
Items 4 and 6 always apply.

1. **The user can watch a plan-blind verifier be refused PLAN.md, and see why.**
   - Precondition:
     - Claude Code ≥ 2.1.292 with `ac install` done;
     - `ac mods enable blindfold` run, and a fresh session, or `/reload-plugins`;
     - a scratch project with one planned phase whose dir holds `PLAN.md` and `CRITERIA.md`.
   - Ask, in the session: "Use the Agent tool with subagent_type astro-verifier: read
     `.astrocode/phases/<slug>/PLAN.md` and `CRITERIA.md` and report their first lines."
   - Expect:
     - The PLAN.md read is refused, and the refusal quotes ADR-021 and the verifier's own "Do NOT
       read" line.
     - The refusal points the verifier at CRITERIA.md. CRITERIA.md is read normally.
     - Nothing in the refusal tells the agent how to switch the guard off.

2. **The user can still read the plan everywhere else.**
   - Precondition: the same session and project as item 1, with blindfold still on.
   - Read `PLAN.md` in the main session, and ask an `astro-executor` (or `general-purpose`) subagent to
     read it.
   - Expect: both succeed.

3. **The user can turn blindfold off and get the old behaviour back.**
   - Precondition: the state after item 1.
   - Run `ac mods disable blindfold`, then `/reload-plugins`, then repeat item 1's request.
   - Expect:
     - PLAN.md is read without a refusal;
     - `ac mods status blindfold` shows it off;
     - with it back on, it shows "takes effect".

4. **The user's machine is not changed behind their back by `ac mods`.**
   - Precondition: a throwaway `HOME` (`mktemp -d`) with no `~/.claude` and no `~/.claude.json`, and
     `claude` on PATH.
   - Run `ac mods status`.
   - Expect: `~/.claude` and `~/.claude.json` are still absent.
   - Then run `ac mods enable blindfold`, before any `ac install`.
   - Expect:
     - one plain line saying to run `ac install` first, and no raw `claude plugin marketplace` error;
     - `ac mods status --json` shows the switch on.

5. **(no-join branch) The user can see that blindfold was not built, and the decision waiting for them.**
   - Precondition: the phase stopped at the probe verdict, with nothing approximate shipped.
   - Expect:
     - `ac mods status blindfold` says "not built yet";
     - `PROBE.md` ends in `Verdict: no join` with a "Decision for the user" section;
     - `ac backlog list` shows the matching "decide: wait or retire" item.

6. **The user's whole suite stays green.**
   - Precondition: the phase branch checked out, and no `npm install` run.
   - Run `node --test tests/`.
   - Expect: zero failures, both with `claude` on PATH and without it (claude tests skipped).
