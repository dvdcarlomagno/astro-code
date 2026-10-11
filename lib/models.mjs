// astro-code · model-tier profiles.
//
// A profile is a complete per-role tier map applied in one shot, so "go faster"
// is a single switch (`ac models fast`) instead of hand-tuning six config keys.
// The ladder is opus → sonnet for every JUDGEMENT role (planner, researcher, executor,
// verifier, discover); haiku is excluded from all of them. The one exception is the
// wave `integrator`, which `balanced` and `fast` run on haiku 5.5 at low reasoning.
//
// History. ADR-027 first gave the integrator haiku as a carve-out ("mechanical git with
// no quality-critical decision left to get wrong"). ADR-035 reverted it after benchmark
// #2, which ran haiku 4.5: its cherry-pick JUDGEMENT was sound, but it ran a bare
// `git stash -u` in the SHARED working tree and never popped it (destroying a completed
// phase plan), and it filled `branches` with the target branch instead of the sources
// (aborting a phase whose work had integrated fine). The integrator has the largest
// destructive surface in the system, so that was the right call for that model.
//
// Why it is open again. ADR-035's premise was haiku 4.5. Haiku 5.5 is a different model,
// at about a twentieth of sonnet's price. Re-run on benchmark #2's scenario as a fixture
// (20 runs each plain and dirty-tree): haiku 5.5 low 20/20 correct against sonnet low 19/20, no
// destructive git in any run, at ~1/20 of the cost; and when the prompt tempts a stash,
// sonnet stashed a path in 19 of 20 runs, haiku 5.5 low in 0 of 21. The ADR-035
// prohibition paragraph stays in the integrator prompt (workflows/execute-phase.mjs): without it haiku got the `branches[]` shape wrong 5 of 20 times,
// with it 20/20. The prompt guard is part of the contract, not a nicety. `max` keeps
// sonnet (quality-first), and `ac config set models.integrator sonnet` opts out.
//
// Nothing else changes: judgement roles never run haiku. On general coding tasks haiku
// 5.5 low was perfect on easy and medium ones but 9/16 on hard ones against sonnet low
// 14/16, and in `discover` it put every task's `file` at the plan file (6/20 wrong).
//
// Roles: planner (synthesizes PLAN.md — quality compounds across the phase),
// researcher (parallel investigation), executor (implements one task each —
// the numerous, longest-running agents, so the biggest wall-clock lever),
// verifier (goal-backward gate — a false PASS is the costliest error),
// discover (mechanical task/dependency parsing, but it decides each task's `file`),
// integrator (folds each wave onto the branch — the ONLY role that runs git in the
// shared tree; cheap-tier only because the prompt guard above pins its behaviour).

export const PROFILE_NAMES = ['max', 'balanced', 'fast'];

export const MODEL_PROFILES = {
  // Every judgement role on opus — highest quality, slowest. `integrator` stays
  // sonnet, deliberately NOT opus: opus on a cherry-pick is waste. Quality-first
  // keeps the mid tier here; balanced and fast take the cheaper haiku 5.5.
  max: {
    planner: 'opus',
    researcher: 'opus',
    executor: 'opus',
    verifier: 'opus',
    discover: 'opus',
    integrator: 'sonnet',
  },
  // Default daily-driver: opus for the two quality-critical brains (the plan
  // shapes the whole phase; the verify gate must not false-PASS), sonnet for the
  // bulk roles, haiku 5.5 (low reasoning) for the `integrator` only.
  balanced: {
    planner: 'opus',
    researcher: 'sonnet',
    executor: 'sonnet',
    verifier: 'opus',
    discover: 'sonnet',
    integrator: 'haiku',
  },
  // Fast: push everything to sonnet EXCEPT the verify gate, which stays opus so
  // speed can never silently cost correctness — the gate still runs the full test
  // suite at full quality. The win over `balanced` is planner opus→sonnet (and the
  // executors are already sonnet, so phases dominated by execution shrink most).
  // `integrator` is haiku like balanced — a profile switch cannot leave it unset.
  fast: {
    planner: 'sonnet',
    researcher: 'sonnet',
    executor: 'sonnet',
    verifier: 'opus',
    discover: 'sonnet',
    integrator: 'haiku',
  },
};

/**
 * Return a fresh copy of a named profile's per-role tier map.
 *
 * Returns a NEW object each call so callers can mutate/merge without corrupting
 * the shared constant. Throws on an unknown name (with the valid choices) rather
 * than silently returning undefined — a typo'd profile should fail loud, not
 * quietly leave models unset.
 *
 * @param {string} name  one of PROFILE_NAMES
 * @returns {{planner:string, researcher:string, executor:string, verifier:string, discover:string, integrator:string}}
 */
export function profileModels(name) {
  const p = MODEL_PROFILES[name];
  if (!p) {
    throw new Error(`unknown model profile "${name}" — choose one of: ${PROFILE_NAMES.join(', ')}`);
  }
  return { ...p };
}

// ── Local-model sessions ────────────────────────────────────────────────────
//
// Claude Code can run against a local model (ANTHROPIC_BASE_URL pointed at an
// Anthropic-compatible server serving e.g. Qwen). Such an endpoint serves its own model,
// not the `opus`/`sonnet` tiers above — every subagent astro-code started with an explicit
// tier failed with a model-name error. The rule, for now: on a local model EVERY role runs
// on the session's model, with no reasoning effort (local servers mostly reject it).
//
// `SESSION_MODEL` is the tier value that says so. `ac` resolves it — it runs inside the
// session and inherits its env — and the workflows translate it to "pass no model", which
// is how a subagent inherits the session model (see lib/config.mjs resolveModels).

export const SESSION_MODEL = 'inherit';

const ROLES = Object.keys(MODEL_PROFILES.balanced);
// Claude Code's own model aliases, with an optional `[1m]` context suffix.
const TIER_ALIAS = /^(opus|sonnet|haiku|default|opusplan|best)(\[[^\]]*\])?$/i;

/**
 * Is this session running on a local (non-Claude) model, and what says so?
 *
 *   ASTRO_LOCAL_MODEL=1|0    forces the answer (a proxy in front of real Claude, or a
 *                            signal this function cannot see)
 *   ANTHROPIC_BASE_URL       any host that is not anthropic.com
 *   ANTHROPIC_MODEL          a model id that is neither a Claude id nor a tier alias
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {{ local: boolean, why: string }}
 */
export function localModelSession(env = process.env) {
  const forced = String(env.ASTRO_LOCAL_MODEL ?? '').trim().toLowerCase();
  if (forced) {
    const on = ['1', 'true', 'yes', 'on'].includes(forced);
    return { local: on, why: `ASTRO_LOCAL_MODEL=${env.ASTRO_LOCAL_MODEL}` };
  }
  const base = String(env.ANTHROPIC_BASE_URL ?? '').trim();
  if (base) {
    let host = '';
    try { host = new URL(base).host; } catch { host = base; }
    const hostname = host.replace(/:\d+$/, '').toLowerCase();
    if (hostname !== 'anthropic.com' && !hostname.endsWith('.anthropic.com')) {
      return { local: true, why: `ANTHROPIC_BASE_URL=${host}` };
    }
  }
  const model = String(env.ANTHROPIC_MODEL ?? '').trim();
  if (model && !/^claude/i.test(model) && !TIER_ALIAS.test(model)) {
    return { local: true, why: `ANTHROPIC_MODEL=${model}` };
  }
  return { local: false, why: '' };
}

/** Every role on the session's model — what `ac config get models` hands a local session. */
export function sessionModels() {
  return Object.fromEntries(ROLES.map((r) => [r, SESSION_MODEL]));
}
