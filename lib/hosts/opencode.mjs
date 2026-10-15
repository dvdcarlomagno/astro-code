// Host adapter: OpenCode (sst/opencode, `opencode` CLI + TUI).
//
// Verified live against opencode 2.0.29 (V2) on macOS — the model was asked to
// list its own tools and dispatchable agents after an install, and a published
// command (`/astro-status`) was run end to end via `opencode run`:
//
//   config dir     $OPENCODE_CONFIG_DIR, else $XDG_CONFIG_HOME/opencode, else
//                  ~/.config/opencode
//   commands       <config>/commands/<name>.md — markdown, `description`
//                  frontmatter, `$ARGUMENTS` expanded natively. Invoked as
//                  `/astro-plan 1`, same as Claude Code.
//   agents         <config>/agents/<name>.md — markdown with `description`,
//                  `mode: subagent` and an optional `model: <provider>/<id>`.
//                  These ARE registered subagents: the `subagent` tool (V2;
//                  `task` on V1) accepts `astro-executor` etc. as its `agent`,
//                  unlike Cursor where they are only prompt text.
//   tools          V2: subagent{agent, description, prompt, model?, sessionID?},
//                  question{questions[{question, header, options, multiple?}]},
//                  shell, read, write, edit, grep, glob, webfetch, websearch,
//                  skill. No Workflow, no ToolSearch, no todo tool.
//                  V1 names differ (task/subagent_type, bash, todowrite) — the
//                  note below names both so one rendering serves both flavors.
//
// Models. OpenCode serves models as `<provider>/<id>` (e.g.
// `openrouter/anthropic/claude-opus-5.5`), never as the `opus`/`sonnet`/`haiku`
// tiers astro-code stores, and which provider a user has is unknowable from
// here. So the tier → id translation is the user's, in ~/.astro/config.json:
//
//   "opencode": { "models": { "opus": "...", "sonnet": "...", "haiku": "..." } }
//
// Each agent file is stamped with the id its role's USER-level tier maps to
// (`ac models <profile> --user`, or `models` in the same file). A role value
// that already looks like an OpenCode id (contains `/`) is used verbatim. No
// map, no entry or `inherit` → no `model:` key, so the agent runs on the
// session's model — the same safe default Cursor uses. Per-PROJECT overrides
// in .astrocode/config.json do not reach these global files; re-run
// `ac install` after changing the user mapping.
//
// Hooks / status line are not wired: OpenCode's equivalent is a JS plugin
// (see obra/superpowers' .opencode/plugins), a separate piece of work.
//
// Stateless about HOME/env, like every adapter: see lib/hosts/index.mjs.
import { existsSync, readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { parseFrontmatter, toMarkdown } from './render.mjs';
import { userRoleDefaults } from '../config.mjs';

export const id = 'opencode';
export const label = 'OpenCode';

/** Commands AND agents are flat markdown, copied — OpenCode must work with no
 *  Claude Code install to symlink from, exactly like Cursor. */
export const placement = { commands: 'commands', agents: 'agents', ext: '.md', mode: 'copy' };

export function baseConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'opencode');
}

/** OpenCode has a single global config dir. */
export function configTargets() {
  return new Map([[baseConfigDir(), 'base']]);
}

function onPath(bin) {
  const dirs = String(process.env.PATH || '').split(delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [bin, `${bin}.exe`, `${bin}.cmd`] : [bin];
  return dirs.some((d) => names.some((n) => existsSync(join(d, n))));
}

/** Present when its config dir exists or `opencode` is on PATH. */
export function detect() {
  return existsSync(baseConfigDir()) || onPath('opencode');
}

/**
 * Prepended to every rendered command. The bodies are authored once, against
 * Claude Code's tool names; this maps them onto OpenCode's without rewriting
 * the body.
 */
export const OPENCODE_NOTE = `> **Running on OpenCode.** These steps were written for Claude Code; map its tools like this:
> - **Workflow tool** — not available here. Take the next tier the step offers (subagents, else inline).
> - **Agent tool** — use \`subagent\` (OpenCode 2.x) with \`agent: "<name>"\`, or \`task\` with \`subagent_type: "<name>"\` (1.x). The astro agents (\`astro-planner\`, \`astro-researcher\`, \`astro-executor\`, \`astro-verifier\`, \`astro-criteria-author\`, \`astro-mapper\`) are registered subagents here — dispatch them by name; their model is already set in their agent file, so do not pass \`model\`. \`Explore\` → \`explore\`; \`general-purpose\` → \`general\`. Independent subagents go in one message so they run in parallel.
> - **AskUserQuestion** — use the \`question\` tool (same questions, headers and options; \`multiSelect\` → \`multiple\`).
> - **Bash** → \`shell\` (2.x) or \`bash\` (1.x). Run every \`ac …\` from the project root that holds \`.astrocode/\`.
> - **TodoWrite / ToolSearch / hooks / status line / \`allowed-tools\`** — Claude Code only; skip them.

`;

/**
 * A command renders as one file: the source's `description` (`allowed-tools`
 * and `argument-hint` are Claude-only and dropped), OPENCODE_NOTE, then the
 * source body verbatim — `$ARGUMENTS` is left for OpenCode to substitute.
 */
export function renderCommand(name, source) {
  const { frontmatter, body } = parseFrontmatter(source);
  const content = toMarkdown({ description: frontmatter.description }, OPENCODE_NOTE + body);
  return [{ path: `${name}.md`, content }];
}

/** Which astro role's tier an agent runs at — mirrors the workflows' dispatch
 *  (criteria-author runs at the planner's tier in plan-phase.mjs). */
export const AGENT_ROLE = {
  'astro-planner': 'planner',
  'astro-criteria-author': 'planner',
  'astro-researcher': 'researcher',
  'astro-mapper': 'researcher',
  'astro-executor': 'executor',
  'astro-verifier': 'verifier',
};

function userOpencodeModels(home) {
  try {
    const cfg = JSON.parse(readFileSync(join(home, '.astro', 'config.json'), 'utf8'));
    const m = cfg && cfg.opencode && cfg.opencode.models;
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}

/**
 * The OpenCode model id for one agent, or undefined to inherit the session's.
 * Read at call time (never module load) so a fake $HOME in tests is honoured.
 */
export function resolveAgentModel(name, home = homedir()) {
  const role = AGENT_ROLE[name];
  if (!role) return undefined;
  const tier = userRoleDefaults(home).models[role];
  if (!tier || tier === 'inherit') return undefined;
  if (tier.includes('/')) return tier;
  const mapped = userOpencodeModels(home)[tier];
  return typeof mapped === 'string' && mapped ? mapped : undefined;
}

/**
 * An agent renders as one file: `description`, `mode: subagent` (so it is
 * dispatchable but not offered as a primary agent), and `model` only when the
 * user's mapping resolves one. Claude's `tools`, `color` and `experimental`
 * keys are dropped; the body is the prompt, verbatim.
 */
export function renderAgent(name, source) {
  const { frontmatter, body } = parseFrontmatter(source);
  const fm = { description: frontmatter.description, mode: 'subagent' };
  const model = resolveAgentModel(name);
  if (model) fm.model = model;
  return [{ path: `${name}.md`, content: toMarkdown(fm, body) }];
}

export const opencodeHost = {
  id, label, placement, detect, baseConfigDir, configTargets,
  renderCommand, renderAgent,
  // Hooks are not wired on this host yet — see the note at the top of this file.
  registerHooks: () => false,
  unregisterHooks: () => {},
};
export default opencodeHost;
