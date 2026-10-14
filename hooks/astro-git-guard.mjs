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
// ## Ask when unsure
//
// Compound commands (`&&`, `||`, `;`, `|`, newlines), `cd`/env/`command`/`exec`/`sudo`/`env`/
// `nice`/`timeout`/`stdbuf` prefixes, `git -C/-c/--git-dir` global options and one-level
// `sh -c`/`bash -c`/`eval`/`env -S` are seen, segment by segment. A git command merely QUOTED
// inside `echo`, `grep` or `git commit -m "…"` is one word and never trips the guard.
//
// Three verify rounds proved that a parser which ALLOWS whatever it can't read never closes:
// each round found new same-effect spellings (`--h` for --hard, `env -S`, `git -C $(pwd)`,
// `-- "$PWD"`, `-- '**'`, an unknown global option hiding the subcommand). So the default is
// flipped (decided with the user, phase 38): when a git word reaches stash/clean/reset/
// checkout/restore and the guard cannot PROVE the call scoped — an expansion (`$…`, `$(…)`,
// backticks), an unknown git global option, an unknown wrapper in front of `git`, a pathspec
// that is magic, a glob, or resolves to `cwd` or above — it asks. One extra prompt on an odd
// but safe command is the price; the user approves it, an agent is refused. Aliases, scripts
// and lean-ctx's MCP `ctx_shell` (not a Bash tool call) stay out of reach.
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
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERDICT = 'ask';
export const CURSOR_VERDICT = 'deny';

// ---------------------------------------------------------------- the refused set

// The subcommands whose unscoped form destroys work. A git call reaching one of these that the
// guard cannot read fully is asked about (see "Ask when unsure").
const DANGER = new Set(['stash', 'clean', 'reset', 'checkout', 'restore', 'switch']);

// The whole command line being judged, set per call by decide(). A shell fed from stdin or a
// variable used as the command can carry a git command the parser never sees as words; when the
// text mentions git together with a destructive subcommand, that is enough to ask.
let TEXT = '';
const mentionsDanger = () => /\bgit\b/.test(TEXT) && /\b(stash|clean|reset|checkout|restore|switch)\b/.test(TEXT);

// An expansion the guard cannot resolve: `$VAR`, `$(…)`, backticks.
const dynamic = (w) => /[$`]/.test(w);

// The hook's `cwd`, set per call by decide(); pathspecs are resolved against it.
let CWD = null;

// A pathspec that may name the whole tree: `.`-style literals, any pathspec magic (`:/`, `:!x`,
// `:(top)`), any glob, any expansion, or a path that resolves to `cwd` or one of its ancestors
// (`"$PWD"`, the absolute repo root, `src/..`). Conservative on purpose: unsure means ask.
function wholeTree(w) {
  if (w === '.' || /^(\.\/)+\.?$/.test(w) || w.startsWith(':') || /[*?[]/.test(w) || dynamic(w)) return true;
  if (!CWD) return false;
  const rel = relative(resolve(CWD, w), CWD);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

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
// `-m`/`--message` take a value, so in `git stash -m -- -u` the `--` is the message and `-u` a
// flag: the separator is the first `--` not eaten as a value. (--pathspec-from-file is asked
// about before this runs; see judgeGit.)
function pushUnscoped(args) {
  let dd = -1;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-m' || (a.length >= 4 && '--message'.startsWith(a))) { i++; continue; }
    if (a === '--') { dd = i; break; }
  }
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

// `git clean` dry-run: the LAST of `--dry-run`/`-n` (or an `n` in a short cluster) and
// `--no-dry-run` wins. Long options may be abbreviated. `-e`/`--exclude` take a value (attached
// or the next word), so what follows is a pattern, not flags; words after `--` are paths.
function cleanDryRun(args) {
  let dry = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    if (a.startsWith('--')) {
      if (a.length > 2 && '--dry-run'.startsWith(a)) dry = true;
      else if (a.length > 4 && '--no-dry-run'.startsWith(a)) dry = false;
      else if (a.length > 2 && '--exclude'.startsWith(a)) i++;
      continue;
    }
    if (!a.startsWith('-') || a.length < 2) continue;
    for (let k = 1; k < a.length; k++) {
      if (a[k] === 'n') dry = true;
      if (a[k] === 'e') { if (k === a.length - 1) i++; break; }
    }
  }
  return dry;
}

/** The refused forms. `test(sub, args)` gets the git subcommand and its words. */
export const REFUSED = Object.freeze([
  { id: 'stash', form: 'git stash without a `-- <path>` pathspec', test: (sub, args) => sub === 'stash' && stashRefused(args) },
  { id: 'clean', form: 'git clean', test: (sub, args) => sub === 'clean' && !cleanDryRun(args) },
  // git accepts any unambiguous prefix of a long option: `--h` already means --hard.
  { id: 'reset', form: 'git reset --hard', test: (sub, args) => sub === 'reset' && args.some((a) => a.length >= 3 && '--hard'.startsWith(a)) },
  { id: 'checkout', form: 'whole-tree git checkout', test: (sub, args) => sub === 'checkout' && operands(args).some(wholeTree) },
  { id: 'restore', form: 'whole-tree git restore', test: (sub, args) => sub === 'restore' && operands(args, ['-s', '--source']).some(wholeTree) },
  // Same effect as `git checkout .`: discard every local change in the tree.
  { id: 'force', form: 'git checkout/switch that discards local changes', test: (sub, args) => (sub === 'checkout' || sub === 'switch')
    && args.some((a) => (/^-[A-Za-z]*f/.test(a) && !a.startsWith('--')) || (a.length >= 4 && '--force'.startsWith(a)) || (a.length >= 4 && '--discard-changes'.startsWith(a))) },
]);

// ---------------------------------------------------------------- parsing

const REDIR = Symbol('redir');

// Split a command into segments of plain words. Redirect operators and their targets are
// dropped; heredoc bodies are skipped. `$(…)` and backticks are kept verbatim inside their word
// (not split on their parens), so `git -C $(pwd) stash` stays one segment and the word reads as
// dynamic.
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
    } else if (c === '$' && s[i + 1] === '(') {
      let depth = 0;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')' && --depth === 0) break;
      }
      cur = (cur ?? '') + s.slice(i, j + 1);
      i = j;
    } else if (c === '`') {
      let j = s.indexOf('`', i + 1);
      if (j < 0) j = s.length;
      cur = (cur ?? '') + s.slice(i, j + 1);
      i = j;
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
        else if (s[i] === '$' && s[i + 1] === '(') {
          let depth = 0;
          let j = i + 1;
          for (; j < s.length; j++) {
            if (s[j] === '(') depth++;
            else if (s[j] === ')' && --depth === 0) break;
          }
          add(s.slice(i, j + 1));
          i = j;
        } else add(s[i]);
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
const GIT_VALUE_LONG = ['--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path', '--super-prefix', '--attr-source', '--list-cmds'];
// git global flags that take no value. Anything else before the subcommand is unknown: the guard
// can't tell whether it eats the next word, so it can't find the subcommand for sure.
const GIT_FLAGS = new Set(['-p', '--paginate', '-P', '--no-pager', '--bare', '--no-replace-objects',
  '--no-lazy-fetch', '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs',
  '--no-optional-locks', '--no-advice', '--exec-path', '--html-path', '--man-path', '--info-path']);
const ENV_VALUE = new Set(['-u', '-C', '--unset', '--chdir']);
const ENV_SPLIT = new Set(['-S', '--split-string']);
const SUDO_VALUE = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U']);

// Drop leading assignments, keywords and wrapper commands until the real command word.
function stripPrefixes(w) {
  let i = 0;
  while (i < w.length) {
    const t = w[i];
    if (/^[A-Za-z_]\w*=/.test(t) || KEYWORDS.has(t)) { i++; continue; }
    const b = base(t);
    if (b === 'command' || b === 'nohup' || b === 'time') {
      i++;
      while (i < w.length && w[i].startsWith('-')) i++;
    } else if (b === 'exec') {
      i++;
      while (i < w.length && w[i].startsWith('-')) i += w[i] === '-a' ? 2 : 1;
    } else if (b === 'env') {
      i++;
      while (i < w.length && (w[i].startsWith('-') || /^[A-Za-z_]\w*=/.test(w[i]))) {
        // `env -S '<cmd>'` / `--split-string=<cmd>`: the value IS the command line; judge it whole.
        const split = ENV_SPLIT.has(w[i]) ? w[i + 1]
          : w[i].startsWith('--split-string=') ? w[i].slice('--split-string='.length)
          : /^-S./.test(w[i]) ? w[i].slice(2) : null;
        if (split != null) {
          const out = [];
          out.split = [split, ...w.slice(i + (ENV_SPLIT.has(w[i]) ? 2 : 1))].join(' ');
          return out;
        }
        i += ENV_VALUE.has(w[i]) ? 2 : 1;
      }
    } else if (b === 'timeout') {
      i++;
      while (i < w.length && w[i].startsWith('-')) i += ['-s', '--signal', '-k', '--kill-after'].includes(w[i]) ? 2 : 1;
      i++; // the DURATION
    } else if (b === 'stdbuf') {
      i++;
      while (i < w.length && w[i].startsWith('-')) i += ['-i', '-o', '-e'].includes(w[i]) ? 2 : 1;
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

const UNSURE = { id: 'unsure', form: 'a git call the guard could not show to be scoped' };
const unsure = (words) => (words.some((w) => DANGER.has(w)) ? { ...UNSURE, segment: words.join(' ') } : null);

function judgeGit(words, depth) {
  let i = 1;
  while (i < words.length) {
    const t = words[i];
    // An inline alias or autocorrect turns any word into stash/reset/clean (`git -c alias.x=stash x`,
    // `-c help.autocorrect=immediate stsh`); the guard can't know what runs, so it asks.
    const cfg = t === '-c' || t === '--config-env' ? words[i + 1] : t.startsWith('-c') ? t.slice(2) : t.startsWith('--config-env=') ? t.slice(13) : null;
    if (cfg != null && /^(alias\.|help\.autocorrect)/i.test(cfg)) return { ...UNSURE, segment: words.join(' ') };
    if (GIT_VALUE_OPTS.has(t) || GIT_VALUE_LONG.includes(t)) i += 2;
    else if (GIT_FLAGS.has(t) || GIT_VALUE_LONG.some((o) => t.startsWith(`${o}=`)) || /^-c./.test(t) || /^-C./.test(t)) i++;
    else if (t.startsWith('-') && t.length > 1) return unsure(words.slice(i)); // unknown: may eat the next word
    else break;
  }
  const sub = words[i];
  if (!sub) return null;
  if (dynamic(sub)) return { ...UNSURE, segment: words.join(' ') }; // could be any subcommand
  const args = words.slice(i + 1);
  // Paths read from a file or stdin can name the whole tree; the guard can't see them.
  if (DANGER.has(sub) && args.some((a) => a.startsWith('--pathspec-from'))) return { ...UNSURE, segment: words.join(' ') };
  const hit = REFUSED.find((r) => r.test(sub, args));
  if (hit) return { id: hit.id, form: hit.form, segment: words.join(' ') };
  // A destructive subcommand the refused set let through, with an argument the guard can't read.
  if (DANGER.has(sub) && args.some(dynamic)) return { ...UNSURE, segment: words.join(' ') };
  return null;
}

function judgeSegment(raw, depth) {
  const words = stripPrefixes(raw);
  if (words.split != null) return judgeCommand(words.split, depth + 1);
  if (!words.length) return null;
  const cmd = base(words[0]);
  if (cmd === 'git') return judgeGit(words, depth);
  if (SHELLS.has(cmd) || cmd === 'lean-ctx') {
    const ci = words.findIndex((a, k) => k > 0 && (cmd === 'lean-ctx' ? a === '-c' : /^-[A-Za-z]*c[A-Za-z]*$/.test(a)));
    const body = ci > 0 ? (words[ci + 1] === '--' ? words[ci + 2] : words[ci + 1]) : undefined; // `bash -c -- '<cmd>'`
    if (typeof body === 'string') return judgeCommand(body, depth + 1);
    // A shell with no -c and no script reads its commands from stdin (`echo '…' | bash`).
    if (ci < 0 && SHELLS.has(cmd) && !words.slice(1).some((w) => !w.startsWith('-')) && mentionsDanger()) return { ...UNSURE, segment: words.join(' ') };
  }
  if (cmd === 'eval') return judgeCommand(words.slice(1).join(' '), depth + 1);
  // `$GIT stash -u`, `"$(which git)" reset --hard`: the command word itself is an expansion.
  if (dynamic(words[0])) return unsure(words.slice(1)) ?? (mentionsDanger() ? { ...UNSURE, segment: words.join(' ') } : null);
  // An unknown wrapper in front of a bare `git` word (`xargs git clean -f`, `watch git reset
  // --hard`): judge from that word. A git command quoted inside one argument is one word, not `git`.
  const gi = words.findIndex((w, k) => k > 0 && base(w) === 'git');
  if (gi > 0) return judgeGit(words.slice(gi), depth);
  return null;
}

function judgeCommand(command, depth = 0) {
  if (depth >= 3) return mentionsDanger() ? { ...UNSURE, segment: command } : null; // too deep to read: ask, don't allow
  for (const seg of segments(command)) {
    const hit = judgeSegment(seg, depth);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------- the verdict

// What each refused form does, in the words a person deciding in a hurry needs.
const EFFECT = {
  stash: 'moves every uncommitted change in the repo into the stash, which every session shares',
  clean: 'deletes every untracked file in the repo',
  reset: 'throws away every uncommitted change in the repo',
  checkout: 'throws away every uncommitted change in the repo',
  restore: 'throws away every uncommitted change in the repo',
  force: 'throws away local changes in the repo',
  unsure: 'might throw away uncommitted work (git-guard cannot tell what it touches)',
};

/** Two plain lines: what the command does, then the safer way and the off switch. The rule's
 * history (ADR-035, ADR-038) lives in MANUAL.md, not in a prompt someone answers mid-flow. */
export function reasonFor(hit, verdict) {
  const seg = hit.segment.length > 80 ? `${hit.segment.slice(0, 77)}...` : hit.segment;
  const ask = verdict === 'ask' ? ' Allow only if you meant that.' : ' Refused.';
  return [
    `git-guard: \`${seg}\` ${EFFECT[hit.id] ?? EFFECT.unsure}.${ask}`,
    'Safer: `git stash push -- <path>` then `git stash pop`, or name the paths. Off: `ac mods disable git-guard`.',
  ].join('\n');
}

/** `{ reason, hit }` for a call to refuse, else null. */
export function decide(input, { cursor = false } = {}) {
  if (!input || typeof input !== 'object') return null;
  if (input.tool_name !== 'Bash' && input.tool_name !== 'Shell') return null;
  const command = input.tool_input?.command;
  if (typeof command !== 'string') return null;
  CWD = typeof input.cwd === 'string' && isAbsolute(input.cwd) ? input.cwd : null;
  TEXT = command;
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
