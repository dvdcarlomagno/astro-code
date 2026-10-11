#!/usr/bin/env node
// PreToolUse hook — git-guard: refuse unscoped destructive git in the shared tree (phase 38).
//
// The rule is written down twice already: ADR-035 forbade it in the integrator, ADR-038 put it
// in every executor prompt (`NO_BROAD_STASH` in workflows/execute-phase.mjs). Prose is the
// weakest enforcement there is, so this hook turns it into a refusal at the one moment it
// matters: just before a Bash/Shell call runs a bare `git stash`, `git clean`, `git reset
// --hard`, or a whole-tree `git checkout`/`git restore` (ADR-071). The refused set is ONE
// exported constant, REFUSED, and a drift test ties it to NO_BROAD_STASH.
//
// ## Ask on Claude, deny on Cursor
//
// On Claude Code 2.1.292 a hook `ask` was probed live (F1): under bypassPermissions and `-p` it
// is never auto-approved, a non-interactive agent treats it as a refusal, nothing hangs, and it
// beats an explicit allow rule. So the user can approve a deliberate reset in their own session
// and a background agent is simply refused. Cursor's tool-execution path only acts on `deny`
// from `preToolUse` (F3), so there it denies. The per-host verdict is stated once, in
// `lib/hosts/guards.mjs` GUARD_HOOKS; a test pins VERDICT/CURSOR_VERDICT to it.
//
// ## It never reads the switch
//
// `ac mods enable git-guard` writes this hook into each host's settings; `disable` removes it
// (ADR-072: the switch IS the registration). Being registered means being on, so this script has
// no config to consult and cannot disagree with `ac mods status`.
//
// ## Catching mistakes, not a sandbox
//
// Compound commands (`&&`, `||`, `;`, `|`, newlines), `cd`/env/`command`/`exec`/`sudo`/`env`/
// `nice` prefixes, `git -C/-c/--git-dir` global options and one-level `sh -c`/`bash -c` are
// seen, segment by segment. Aliases, `eval`, scripts, `xargs`, `$(…)` and lean-ctx's MCP
// `ctx_shell` are out of scope. A git command merely QUOTED inside `echo`, `grep` or
// `git commit -m "…"` is one word and never trips the guard. `cwd` never changes the verdict:
// the stash stack is repository-wide, so a worktree is no safer than the shared tree.
//
// Why it also unwraps `lean-ctx -c '<cmd>'`: Claude runs matching hooks on the ORIGINAL
// tool_input, so a sibling's rewrite never reaches us (F2). An agent that types the wrapper
// itself still would, so it is unwrapped (matched by basename) as defence in depth.
//
// The tokenizer is copied and adapted from canon-guard's rather than imported: each guard is
// registered independently, and that one expands HOME and tracks redirect targets for paths,
// which this one must not do.
//
// ## Fail open
//
// Any internal failure (bad JSON, an unknown tool, a non-string command) allows the call with
// empty stdout and stderr and never prints a stack: a guard that wedges every tool use is worse
// than the mistake it prevents. An allowed call prints NOTHING; this script never emits `allow`,
// which would auto-approve past the user's own permission rules. It spawns nothing and reads
// nothing but stdin.
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VERDICT = 'ask';
export const CURSOR_VERDICT = 'deny';

// ---------------------------------------------------------------- the refused set

// A pathspec that names the whole tree. Literal on purpose: no glob or path resolution.
const wholeTree = (w) => w === '.' || w === ':/' || w === ':/.' || w === ':(top)' || w === '*' || /^(\.\/)+\.?$/.test(w);

// Operands of checkout/restore: bare words and everything after `--`. `valueFlags` eat a value.
function operands(args, valueFlags = []) {
  const out = [];
  let rest = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (rest) out.push(a);
    else if (a === '--') rest = true;
    else if (a.startsWith('-') && a.length > 1) { if (valueFlags.includes(a)) i++; }
    else out.push(a);
  }
  return out;
}

const STASH_SAFE = new Set(['pop', 'apply', 'list', 'show', 'drop', 'branch', 'clear', 'create', 'store']);

// `git stash push` and bare `git stash <flags>`: only a pathspec after `--` makes it scoped.
function pushUnscoped(args) {
  if (args.some((a) => a === '--pathspec-from-file' || a.startsWith('--pathspec-from-file='))) return false;
  const dd = args.indexOf('--');
  if (dd < 0) return true;
  const paths = args.slice(dd + 1);
  return paths.length === 0 || paths.some(wholeTree);
}

function stashRefused(args) {
  if (args.length && !args[0].startsWith('-')) {
    if (STASH_SAFE.has(args[0])) return false;
    if (args[0] === 'save') return true;
    if (args[0] === 'push') return pushUnscoped(args.slice(1));
    return false; // not a stash subcommand: git errors on its own
  }
  return pushUnscoped(args);
}

/** The refused forms. `test(sub, args)` gets the git subcommand and its words. */
export const REFUSED = Object.freeze([
  { id: 'stash', form: 'git stash without a `-- <path>` pathspec', test: (sub, args) => sub === 'stash' && stashRefused(args) },
  { id: 'clean', form: 'git clean', test: (sub, args) => sub === 'clean' && !args.some((a) => a === '--dry-run' || /^-[A-Za-z]*n[A-Za-z]*$/.test(a)) },
  { id: 'reset', form: 'git reset --hard', test: (sub, args) => sub === 'reset' && args.includes('--hard') },
  { id: 'checkout', form: 'whole-tree git checkout', test: (sub, args) => sub === 'checkout' && operands(args).some(wholeTree) },
  { id: 'restore', form: 'whole-tree git restore', test: (sub, args) => sub === 'restore' && operands(args, ['-s', '--source']).some(wholeTree) },
]);

// ---------------------------------------------------------------- parsing

const REDIR = Symbol('redir');

// Split a command into segments of plain words. Redirect operators and their targets are
// dropped; heredoc bodies are skipped; `$(…)` and backticks are not descended into.
function segments(s) {
  const segs = [];
  let toks = [];
  let cur = null;
  const heredocs = [];
  let pendingDelim = null;
  const flush = () => {
    if (cur === null) return;
    if (toks[toks.length - 1] === REDIR) {
      toks.pop();
      if (pendingDelim) { heredocs.push({ delim: cur, strip: pendingDelim.strip }); pendingDelim = null; }
    } else toks.push(cur);
    cur = null;
  };
  const endSeg = () => { flush(); if (toks.length) segs.push(toks); toks = []; };
  const add = (ch) => { cur = (cur ?? '') + ch; };
  const redirect = () => { if (cur !== null && /^\d+$/.test(cur)) cur = null; else flush(); toks.push(REDIR); };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      if (s[i + 1] === '\n') i++;
      else if (i + 1 < s.length) add(s[++i]);
    } else if (c === "'") {
      cur ??= '';
      let j = s.indexOf("'", i + 1);
      if (j < 0) j = s.length;
      cur += s.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      cur ??= '';
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) add(s[++i]);
        else add(s[i]);
      }
    } else if (c === ' ' || c === '\t') flush();
    else if (c === '#' && cur === null) { while (i + 1 < s.length && s[i + 1] !== '\n') i++; }
    else if (c === '\n') {
      endSeg();
      while (heredocs.length) {
        const h = heredocs.shift();
        let p = i + 1;
        while (p < s.length) {
          let e = s.indexOf('\n', p);
          if (e < 0) e = s.length;
          const line = s.slice(p, e);
          p = e + 1;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
        }
        i = p - 1;
      }
    } else if (c === ';' || c === '(' || c === ')') endSeg();
    else if (c === '|') { if (s[i + 1] === '|' || s[i + 1] === '&') i++; endSeg(); }
    else if (c === '&') {
      if (s[i + 1] === '>') { flush(); toks.push(REDIR); i += s[i + 2] === '>' ? 2 : 1; }
      else { if (s[i + 1] === '&') i++; endSeg(); }
    } else if (c === '>') {
      redirect();
      if (s[i + 1] === '>' || s[i + 1] === '|' || s[i + 1] === '&') i++;
    } else if (c === '<') {
      redirect();
      if (s[i + 1] === '<' && s[i + 2] === '<') i += 2;
      else if (s[i + 1] === '<') {
        i++;
        const strip = s[i + 1] === '-';
        if (strip) i++;
        pendingDelim = { strip };
      }
    } else add(c);
  }
  endSeg();
  return segs;
}

const base = (w) => w.slice(w.lastIndexOf('/') + 1);
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const GIT_VALUE_OPTS = new Set(['-C', '-c']);
const GIT_VALUE_LONG = ['--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path'];
const GIT_FLAGS = new Set(['--no-pager', '-P', '-p', '--paginate', '--bare', '--no-replace-objects', '--literal-pathspecs', '--no-optional-locks']);
const SUDO_VALUE = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U']);

// Drop leading assignments, keywords and wrapper commands until the real command word.
function stripPrefixes(w) {
  let i = 0;
  while (i < w.length) {
    const t = w[i];
    if (/^[A-Za-z_]\w*=/.test(t) || KEYWORDS.has(t)) { i++; continue; }
    const b = base(t);
    if (b === 'command' || b === 'exec' || b === 'nohup' || b === 'time') {
      i++;
      while (i < w.length && w[i].startsWith('-')) i++;
    } else if (b === 'env') {
      i++;
      while (i < w.length && (w[i].startsWith('-') || /^[A-Za-z_]\w*=/.test(w[i]))) i += w[i] === '-u' ? 2 : 1;
    } else if (b === 'sudo') {
      i++;
      while (i < w.length && w[i].startsWith('-')) i += SUDO_VALUE.has(w[i]) ? 2 : 1;
    } else if (b === 'nice') {
      i++;
      while (i < w.length && w[i].startsWith('-')) i += w[i] === '-n' ? 2 : 1;
    } else break;
  }
  return w.slice(i);
}

function judgeGit(words, depth) {
  let i = 1;
  while (i < words.length) {
    const t = words[i];
    if (GIT_VALUE_OPTS.has(t)) i += 2;
    else if (GIT_VALUE_LONG.some((o) => t === o)) i += 2;
    else if (GIT_VALUE_LONG.some((o) => t.startsWith(`${o}=`)) || GIT_FLAGS.has(t)) i++;
    else break;
  }
  const sub = words[i];
  if (!sub) return null;
  const args = words.slice(i + 1);
  const hit = REFUSED.find((r) => r.test(sub, args));
  return hit ? { id: hit.id, form: hit.form, segment: words.join(' ') } : null;
}

function judgeSegment(raw, depth) {
  const words = stripPrefixes(raw);
  if (!words.length) return null;
  const cmd = base(words[0]);
  if (cmd === 'git') return judgeGit(words, depth);
  if (SHELLS.has(cmd) || cmd === 'lean-ctx') {
    const ci = words.findIndex((a, k) => k > 0 && (cmd === 'lean-ctx' ? a === '-c' : /^-[A-Za-z]*c[A-Za-z]*$/.test(a)));
    if (ci > 0 && typeof words[ci + 1] === 'string') return judgeCommand(words[ci + 1], depth + 1);
  }
  return null;
}

function judgeCommand(command, depth = 0) {
  if (depth >= 3) return null;
  for (const seg of segments(command)) {
    const hit = judgeSegment(seg, depth);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------- the verdict

/** At most 6 lines: the rule, why, the alternative, the escape. */
export function reasonFor(hit, verdict) {
  const seg = hit.segment.length > 120 ? `${hit.segment.slice(0, 117)}...` : hit.segment;
  const approve = verdict === 'ask' ? 'approve this call if you meant it, or ' : '';
  return [
    `git-guard: \`${seg}\` is an unscoped destructive git command (${hit.form}).`,
    'Rule: no bare stash, git clean, git reset --hard or whole-tree checkout/restore (ADR-035, ADR-038).',
    'Why: refs/stash is repository-wide even from a worktree; a finished plan was destroyed this way.',
    'Use instead: `git stash push -- <path>…` then `git stash pop`; a broken task is dropped and re-run (ADR-014).',
    `Escape: ${approve}run \`ac mods disable git-guard\` (re-enable with \`ac mods enable git-guard\`).`,
  ].join('\n');
}

/** `{ reason, hit }` for a call to refuse, else null. */
export function decide(input, { cursor = false } = {}) {
  if (!input || typeof input !== 'object') return null;
  if (input.tool_name !== 'Bash' && input.tool_name !== 'Shell') return null;
  const command = input.tool_input?.command;
  if (typeof command !== 'string') return null;
  const hit = judgeCommand(command);
  if (!hit) return null;
  const isCursor = cursor || input.hook_event_name === 'preToolUse';
  return { reason: reasonFor(hit, isCursor ? CURSOR_VERDICT : VERDICT), hit };
}

function main() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const cursor = process.argv[2] === 'cursor' || input?.hook_event_name === 'preToolUse';
    const verdict = decide(input, { cursor });
    if (!verdict) return;
    const out = cursor
      ? { permission: CURSOR_VERDICT, user_message: verdict.reason, agent_message: verdict.reason }
      : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: VERDICT, permissionDecisionReason: verdict.reason } };
    process.stdout.write(JSON.stringify(out));
  } catch { /* fail open — never block a tool call on our own error */ }
}

let isEntry = false;
try { isEntry = import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { /* imported, or -e */ }
if (isEntry) main();
