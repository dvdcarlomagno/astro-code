<!-- astro-discuss: captured -->
# Phase 39 — blindfold mod: plan-blind verifier and criteria-author enforced per agent

The first real **mod** feature in the `astro-mods` plugin (ADR-071 kind `mod`). It follows the
skeleton's convention in `mods/astro-mods/hooks/register.js`:
- `hooks/features/blindfold.js`;
- every hook opens with `if (!isOn('blindfold')) return next(e)`;
- one `on('<event>', fn).catch(failOpen)` line per hook.

The rule it enforces already exists:
- ADR-021;
- `agents/astro-verifier.md` §"What you check against — and what you must NOT read";
- `agents/astro-criteria-author.md:23`.

## Decisions

1. **Identify the agent: probe the join first, else stop.** PROBE.md (phase 36) found that
   `agent.spawn` carries `subagentType` (e.g. `astro-verifier`) but no id, while `tool.check`
   carries only `agentId`. No observed field joins them.
   - **Task 1 is a live probe on Claude Code ≥ 2.1.292** (the container runs it), covering
     both Workflow-spawned and Agent-tool-spawned verifiers. It looks for a reliable id→type
     link, in this order:
     1. `$.agent.list()` entries (does each carry id and type/name?);
     2. fields added since the phase 36 probe on `agent.spawn` / `tool.check` / `next.origin`;
     3. any other documented event.
   - Record the findings in this phase dir as `PROBE.md`.
   - **If a reliable join exists**, build on it. Prefer a stateless lookup per `tool.check`
     (e.g. `$.agent.list()`) over a mod-held map. An in-memory, per-session cache is acceptable
     only if needed for speed; it must never be persisted (ADR-071 c).
   - **If no reliable join exists, stop.** Do not ship an approximation such as spawn-order
     inference, path heuristics or deny-for-all-subagents. Report it, leave `blindfold`
     `built: false`, and record the blocker so the user decides. ADR-071 (a): a mod enforces
     the canon's rule exactly or not at all.
2. **What counts as reading the plan** (only when the calling agent is identified as one of
   the two roles).
   - **Forbidden files:**

     | Role | Files |
     |---|---|
     | `astro-verifier` | `PLAN.md`, `SPEC.md` |
     | `astro-criteria-author` | `PLAN.md`, `ACCEPTANCE.md`, `SPEC.md` |

     Match these by basename inside any `.astrocode/phases/*/` dir, case-insensitively, the
     same lesson as phase 37's C3.
   - **Denied for those agents:**
     - Read (and NotebookRead) of a forbidden file;
     - Bash commands that name a forbidden file (cat/head/tail/less/more/sed/awk/grep/rg/cp,
       anything that takes it as an operand);
     - Grep/Glob whose search path is a phase dir (or `.astrocode/phases`, or a parent of
       them) without a narrowing glob/path that excludes the forbidden files. This is the
       "don't broad grep -r / Glob the phase directory" rule already in `astro-verifier.md`.
   - **Allowed:** CRITERIA.md, CONTEXT.md, PROJECT.md, the canon, source and tests.
   - Executors, planners and the main session are never affected.
3. **Verdict: deny.** Subagents can't answer an `ask`. The reason quotes the rule (ADR-021 and
   the agent's own "Do NOT read" line), names the file, and says the agent grades against
   CRITERIA.md. It does not name the escape to the agent itself, which is
   `ac mods disable blindfold` for the human.
4. **Switch / version / host.** As built in phase 36: `~/.astro/config.json` `mods.blindfold`,
   plugin floor 2.1.292, Claude only. Codex and Cursor keep the prose rule. Flip `blindfold`
   `built: true` only if decision 1 found a join.
5. **Fail open** (ADR-071 e). If the join lookup throws or times out, allow and notify once.
   **A guard that cannot identify the agent allows**; it never denies an unidentified agent.

## Folded-in debt (in scope)

- `2026-10-11-ac-mods-enable-of-a-mod-feature-before`: `ac mods enable <mod feature>` before
  `ac install` has shipped `~/.astro/code/mods` prints a raw `claude plugin marketplace add`
  error and no fix line. Detect the missing marketplace dir and say `run ac install first`,
  with the switch still recorded.
- `2026-10-11-ac-mods-status-creates-claude-as-a-side`: `ac mods status` runs `claude
  --version`, which creates `~/.claude`/`~/.claude.json`, so on a Cursor-only machine the next
  `ac install` flips Cursor to Claude-import mode. Don't create them: detect the version
  without side effects, or run the probe with a throwaway `CLAUDE_CONFIG_DIR` / `HOME`, or
  skip the version check when no Claude config dir exists. Planning picks one and tests that
  `~/.claude` stays absent.

## Out of scope

- spawn-policy (40), witness (41), other mods.
- Rewriting tool results (filtering PLAN.md lines out of a broad Grep's output) instead of
  denying.
- Enforcing plan-blindness on non-astro agent types.

## Open questions / assumptions

- Whether `$.agent.list()` (documented: this session's subagents with status) exposes an id
  matching `tool.check`'s `agentId` and a type/name. This is the crux of decision 1.
- Workflow agents spawned by `plan-phase.mjs`/`execute-phase.mjs` report `subagentType` as the
  agentType string they were given (`astro-verifier`, `astro-criteria-author`). Confirm it in
  the probe.
