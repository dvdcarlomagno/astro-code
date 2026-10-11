#!/usr/bin/env node
// PreToolUse hook — canon-guard: refuse hand edits to files the `ac` CLI owns (phase 37).
//
// AGENTS.md states the rule ("Never hand-edit roadmap.json, state.json, or the registry";
// ROADMAP.md is generated) and ADR-004 makes the CLI the owner of those files. A rule in prose
// is the weakest enforcement there is, so this hook turns it into a deny at the one moment it
// matters: just before a Write/Edit/MultiEdit/NotebookEdit or an obvious Bash write lands on a
// protected path (ADR-071). It denies, never asks, so it behaves the same headless and in
// Workflow subagents. The deny reason names the rule's source, the `ac` verb to use for THAT
// file, and the two escapes.
//
// ## It never reads the switch
//
// `ac mods enable canon-guard` writes this hook into each host's settings; `disable` removes it
// (ADR-072: the switch IS the registration). Being registered means being on, so a disabled
// guard costs nothing and this script has no config to consult. That is also why it can't
// disagree with `ac mods status`: there is one source of truth, the registration.
//
// ## Catching mistakes, not a sandbox
//
// The Bash scan recognises the obvious write forms (redirects, sed/perl in place, tee, cp/mv/rm,
// truncate, dd of=). `python -c`/`node -e` writes, globs and variables are out of scope: an
// unresolvable target is ignored. A segment whose command is `ac` is the sanctioned writer and
// a `git` segment is phase 38's ground; both are skipped, per segment, so
// `ac status && echo x > .astrocode/state.json` still checks its second half.
//
// ## Fail open, except the escape
//
// Any internal failure (bad JSON, an unknown tool, a realpath or permission error) allows the
// call with empty stdout and stderr and never prints a stack: a guard that wedges every tool
// use is worse than the mistake it prevents. The ONE exception runs the other way: the merge
// escape (a protected file carrying conflict markers, or unmerged in `git status`) fails
// CLOSED. If git can't answer, the call stays denied and the user has `ac mods disable`.
//
// ## Paths
//
// A target is judged by its REAL path (symlinks, `..`, macOS /var, a not-yet-existing file
// whose parent exists). It is a project file iff its basename is protected and its parent
// directory is named exactly `.astrocode`. A walk-up for the project root would need a stop
// rule and lets a stray `/tmp/x/state.json` match; the parent rule needs neither.
//
// The principle store dir is mirrored locally from `lib/principles.mjs` `principlesDir`, not
// imported: the hot path stays free of `child_process` and brand imports. A parity test guards
// the copy.
import { readFileSync, realpathSync, readlinkSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SRC_FILES = 'AGENTS.md "Never hand-edit", ADR-004';
const HAND_EDIT_RULE = 'the CLI owns this state; never hand-edit it';

/** The protected set, shared by the deny message and the tests. */
export const PROTECTED = Object.freeze([
  { name: 'roadmap.json', verb: 'ac phase … / ac milestone …', rule: 'never hand-edit roadmap.json, state.json or the registry', source: SRC_FILES },
  { name: 'state.json', verb: 'ac phase … / ac milestone …', rule: 'never hand-edit roadmap.json, state.json or the registry', source: SRC_FILES },
  { name: 'debt.json', verb: 'ac debt …', rule: HAND_EDIT_RULE, source: 'ADR-004, ADR-045' },
  { name: 'backlog.json', verb: 'ac backlog …', rule: HAND_EDIT_RULE, source: 'ADR-004, ADR-056' },
  { name: 'fixes.json', verb: 'ac fix …', rule: HAND_EDIT_RULE, source: 'ADR-004' },
  { name: 'ROADMAP.md', verb: 'ac roadmap render', rule: 'ROADMAP.md is generated from roadmap.json', source: SRC_FILES },
  { name: 'DECISIONS.in-force.md', verb: 'ac canon pull', rule: 'generated from DECISIONS.md by ac', source: 'ADR-004' },
  { store: true, verb: 'ac principles add|accept|amend …', rule: 'the personal principle store is written only through ac principles', source: 'ADR-057, ADR-058' },
]);

// ---------------------------------------------------------------- paths

// realpath of the deepest EXISTING ancestor, with the not-yet-existing tail re-joined. A
// dangling symlink is followed by hand so a Write through it can't dodge the check.
function realpathDeep(abs) {
  let head = abs;
  const tail = [];
  for (let hops = 0; hops < 64; hops++) {
    try {
      const r = realpathSync.native(head); // .native: on-disk case, so STATE.json on a case-insensitive FS is state.json
      return tail.length ? join(r, ...tail.slice().reverse()) : r;
    } catch { /* head does not resolve */ }
    try {
      head = resolve(dirname(head), readlinkSync(head)); // dangling symlink
      continue;
    } catch { /* not a symlink */ }
    const up = dirname(head);
    if (up === head) return abs;
    tail.push(basename(head));
    head = up;
  }
  return abs;
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// Mirror of lib/principles.mjs principlesDir.
const storeDir = (env) => env.ASTRO_PRINCIPLES_DIR || join(env.HOME || homedir(), '.astro', 'principles');

function judge(p, cwd, env) {
  if (typeof p !== 'string' || !p) return null;
  const home = env.HOME || homedir();
  const expanded = p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p;
  const real = realpathDeep(resolve(cwd, expanded));
  const dir = dirname(real);
  // Names compare case-insensitively. realpath's on-disk case only helps for a file that
  // already exists: on a case-insensitive FS (macOS) a Write to a not-yet-existing
  // FIXES.json creates fixes.json, which ac then reads. On a case-sensitive FS the same
  // spelling is a stray file ac never reads; refusing it costs nothing.
  const name = basename(real).toLowerCase();
  const hit = PROTECTED.find((e) => e.name && e.name.toLowerCase() === name);
  if (hit && basename(dir).toLowerCase() === '.astrocode' && isDir(dir)) return { entry: hit, real, display: `.astrocode/${hit.name}` };
  const rel = relative(realpathDeep(resolve(storeDir(env))), real);
  if (rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
    return { entry: PROTECTED.find((e) => e.store), real, display: `~/.astro/principles/${rel}` };
  }
  return null;
}

/** The PROTECTED entry a path falls under, or null. */
export function judgePath(p, cwd, env = process.env) {
  try { return judge(p, cwd || process.cwd(), env)?.entry ?? null; } catch { return null; }
}

// ---------------------------------------------------------------- Bash

// Split a command into segments of tokens: words ({ w, dyn }) and redirect operators ({ r }).
// `dyn` marks a word with an expansion we can't resolve ($VAR, $(…), backtick, glob); such a
// target is ignored (fail open). $HOME, ${HOME} and a leading ~ ARE expanded.
function tokenize(s, env) {
  const home = env.HOME || homedir();
  const segs = [];
  let toks = [];
  let cur = null;
  const heredocs = [];
  let pendingDelim = null;
  const flush = () => {
    if (!cur) return;
    toks.push(cur);
    if (pendingDelim) { heredocs.push({ delim: cur.w, strip: pendingDelim.strip }); pendingDelim = null; }
    cur = null;
  };
  const endSeg = () => { flush(); if (toks.length) segs.push(toks); toks = []; };
  const add = (ch, dyn = false) => { cur ??= { w: '', dyn: false }; cur.w += ch; if (dyn) cur.dyn = true; };
  const dollar = (i) => {
    if (s.startsWith('${HOME}', i)) { add(home); return i + 6; }
    if (s.startsWith('$HOME', i) && !/\w/.test(s[i + 5] || '')) { add(home); return i + 4; }
    add('$', true);
    return i;
  };
  const dropFd = () => { if (cur && /^\d+$/.test(cur.w)) cur = null; else flush(); };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      if (s[i + 1] === '\n') i++;
      else if (i + 1 < s.length) add(s[++i]);
    } else if (c === "'") {
      cur ??= { w: '', dyn: false };
      let j = s.indexOf("'", i + 1);
      if (j < 0) j = s.length;
      cur.w += s.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      cur ??= { w: '', dyn: false };
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) add(s[++i]);
        else if (s[i] === '$') i = dollar(i);
        else add(s[i], s[i] === '`');
      }
    } else if (c === '$') i = dollar(i);
    else if (c === '`' || c === '*' || c === '?' || c === '[') add(c, true);
    else if (c === '~' && !cur && (i + 1 >= s.length || /[\s/]/.test(s[i + 1]))) add(home);
    else if (c === ' ' || c === '\t') flush();
    else if (c === '#' && !cur) { while (i + 1 < s.length && s[i + 1] !== '\n') i++; }
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
      if (s[i + 1] === '>') {
        flush();
        const op = s[i + 2] === '>' ? '&>>' : '&>';
        i += op.length - 1;
        toks.push({ r: op });
      } else { if (s[i + 1] === '&') i++; endSeg(); }
    } else if (c === '>') {
      dropFd();
      let op = '>';
      if (s[i + 1] === '>' || s[i + 1] === '|' || s[i + 1] === '&') op += s[++i];
      toks.push({ r: op });
    } else if (c === '<') {
      dropFd();
      if (s[i + 1] === '<' && s[i + 2] === '<') { i += 2; toks.push({ r: '<<<' }); }
      else if (s[i + 1] === '<') {
        i++;
        const strip = s[i + 1] === '-';
        if (strip) i++;
        toks.push({ r: '<<' });
        pendingDelim = { strip };
      } else toks.push({ r: '<' });
    } else add(c);
  }
  endSeg();
  return segs;
}

const PREFIXES = new Set(['sudo', 'command', 'env', 'time', 'nohup', 'exec']);
// Shell reserved words that can stand in front of the real command word once tokenize has
// split on `;`: `if [ … ]; then rm x; fi` leaves `then rm x` as a segment. Skipped like a
// prefix, or the keyword becomes the command and the write goes unseen.
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}']);
const SHELLS = new Set(['bash', 'sh', 'zsh']);
const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '>&']);

// Non-flag arguments; `valueFlags` consume the next word. Everything after `--` is an argument.
function operands(words, valueFlags = []) {
  const out = [];
  let rest = false;
  for (let i = 0; i < words.length; i++) {
    const t = words[i];
    if (!rest && t.w === '--') rest = true;
    else if (!rest && t.w.startsWith('-') && t.w.length > 1) {
      if (valueFlags.includes(t.w)) i++;
    } else out.push(t);
  }
  return out;
}

// sed/perl: the file arguments, only when an in-place flag is present.
function inPlaceTargets(args) {
  let inplace = false;
  let hasScript = false;
  const rest = [];
  let afterDashes = false;
  for (let i = 0; i < args.length; i++) {
    const w = args[i].w;
    if (afterDashes || !w.startsWith('-') || w === '-') { rest.push(args[i]); continue; }
    if (w === '--') { afterDashes = true; continue; }
    if (w.startsWith('--')) {
      if (w.startsWith('--in-place')) inplace = true;
      else if (w === '--expression' || w === '--file') { hasScript = true; i++; }
      else if (w.startsWith('--expression=') || w.startsWith('--file=')) hasScript = true;
      continue;
    }
    if (/^-[nEpalsSTtuUwWXrzb0-9]*i/.test(w)) inplace = true; // flags that take an attached value (-Ilib, -Mstrict) end the bundle
    if (/^-[A-Za-z]*[ef]$/.test(w)) { hasScript = true; i++; }
  }
  if (!inplace) return [];
  return hasScript ? rest : rest.slice(1);
}

function segmentTargets(toks, cwd, env, state) {
  // lift redirects out of the word list
  const words = [];
  const out = [];
  const addTarget = (t) => {
    if (!t || t.dyn || !t.w || t.w.startsWith('/dev/')) return;
    out.push(resolve(state.cwd, t.w));
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.r) { words.push(t); continue; }
    const target = toks[i + 1] && !toks[i + 1].r ? toks[i + 1] : null;
    if (target) i++;
    if (WRITE_REDIRECTS.has(t.r) && target) {
      if (t.r === '>&' && /^(\d+|-)$/.test(target.w)) continue;
      addTarget(target);
    }
  }
  while (words.length && (/^[A-Za-z_]\w*=/.test(words[0].w) || PREFIXES.has(words[0].w) || KEYWORDS.has(words[0].w))) words.shift();
  if (!words.length) return out;
  const cmd = basename(words[0].w);
  const args = words.slice(1);
  // ac and git are trusted with their own arguments, but a redirect is performed by the
  // shell, not by them: `ac status > .astrocode/state.json` is a hand write.
  if (cmd === 'ac' || cmd === 'astrocode' || cmd === 'git') return out;

  if (cmd === 'cd') {
    if (args.length === 1 && !args[0].dyn && args[0].w !== '-') state.cwd = resolve(state.cwd, args[0].w);
    return out;
  }
  if (SHELLS.has(cmd)) {
    const ci = args.findIndex((a) => /^-[A-Za-z]*c$/.test(a.w));
    if (ci >= 0 && args[ci + 1] && !args[ci + 1].dyn) out.push(...bashTargets(args[ci + 1].w, state.cwd, env));
    return out;
  }
  if (cmd === 'sed' || cmd === 'perl') {
    for (const t of inPlaceTargets(args)) addTarget(t);
  } else if (cmd === 'tee') {
    for (const t of operands(args)) addTarget(t);
  } else if (cmd === 'rm' || cmd === 'unlink') {
    for (const t of operands(args)) addTarget(t);
  } else if (cmd === 'truncate') {
    for (const t of operands(args, ['-s', '--size', '-r', '--reference'])) addTarget(t);
  } else if (cmd === 'dd') {
    for (const t of args) if (t.w.startsWith('of=')) addTarget({ ...t, w: t.w.slice(3) });
  } else if (cmd === 'cp' || cmd === 'mv') {
    const ti = args.findIndex((a) => a.w === '-t' || a.w.startsWith('--target-directory='));
    let dir = null;
    if (ti >= 0) dir = args[ti].w === '-t' ? args[ti + 1] : { ...args[ti], w: args[ti].w.slice('--target-directory='.length) };
    const ops = operands(args, ['-t', '--target-directory', '-S', '--suffix']);
    const srcs = dir ? ops : ops.slice(0, -1);
    const dest = dir || ops[ops.length - 1];
    if (dest && !dest.dyn && (dir || ops.length >= 2)) {
      const isDirDest = dir || isDir(resolve(state.cwd, dest.w));
      if (isDirDest) for (const s of srcs) addTarget({ ...dest, w: join(dest.w, basename(s.w)) });
      else addTarget(dest);
    }
    if (cmd === 'mv') for (const s of srcs) addTarget(s);
  }
  return out;
}

/** The absolute paths a Bash command would WRITE (obvious forms only; see the header). */
export function bashTargets(command, cwd, env = process.env) {
  if (typeof command !== 'string') return [];
  const state = { cwd: resolve(cwd || process.cwd()) };
  const out = [];
  for (const seg of tokenize(command, env)) out.push(...segmentTargets(seg, state.cwd, env, state));
  return out;
}

// ---------------------------------------------------------------- the conflict escape

// May this protected file be hand-edited because it is mid-merge? Fails CLOSED (see header).
function inConflict(file) {
  let head;
  try {
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(1 << 20);
      const n = readSync(fd, buf, 0, buf.length, 0);
      head = buf.toString('utf8', 0, n);
    } finally { closeSync(fd); }
  } catch { return false; } // absent file: nothing to resolve
  if (/^<<<<<<< /m.test(head)) return true;
  try {
    const r = spawnSync('git', ['status', '--porcelain', '--', basename(file)], { cwd: dirname(file), encoding: 'utf8', timeout: 2000 });
    return r.status === 0 && /^(DD|AU|UD|UA|DU|AA|UU) /m.test(r.stdout || '');
  } catch { return false; }
}

// ---------------------------------------------------------------- the verdict

/** At most 6 lines: the rule and its source, the verb, both escapes. */
export function denyReason(entry, displayPath) {
  return [
    `canon-guard: ${displayPath} is owned by the ac CLI — hand edits are refused.`,
    `Rule: ${entry.rule} (${entry.source}).`,
    `Use instead: ${entry.verb}`,
    'Escapes: a file mid-merge (conflict markers, or unmerged in `git status`) may be edited by hand;',
    'for anything else run `ac mods disable canon-guard`, edit, then `ac mods enable canon-guard`.',
  ].join('\n');
}

function targetsOf(input, base, env) {
  const ti = input.tool_input;
  if (!ti || typeof ti !== 'object') return [];
  switch (input.tool_name) {
    case 'Write': case 'Edit': case 'MultiEdit': case 'Delete':
      return [{ path: ti.file_path, cwd: base }];
    case 'NotebookEdit':
      return [{ path: ti.notebook_path, cwd: base }];
    case 'Bash':
      return bashTargets(ti.command, base, env).map((path) => ({ path, cwd: base }));
    case 'Shell':
      return bashTargets(ti.command, (typeof ti.cwd === 'string' && ti.cwd) || base, env).map((path) => ({ path, cwd: base }));
    default:
      return [];
  }
}

/** `{ reason, entry, path }` for a call to refuse, else null. */
export function decide(input, { env = process.env } = {}) {
  if (!input || typeof input !== 'object') return null;
  const base = (typeof input.cwd === 'string' && input.cwd) || process.cwd();
  for (const t of targetsOf(input, base, env)) {
    let hit = null;
    try { hit = judge(t.path, t.cwd, env); } catch { /* fail open */ }
    if (!hit || inConflict(hit.real)) continue;
    return { reason: denyReason(hit.entry, hit.display), entry: hit.entry, path: hit.real };
  }
  return null;
}

function main() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const verdict = decide(input, { env: process.env });
    if (!verdict) return;
    const cursor = process.argv[2] === 'cursor' || input.hook_event_name === 'preToolUse';
    const out = cursor
      ? { permission: 'deny', user_message: verdict.reason, agent_message: verdict.reason }
      : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason } };
    process.stdout.write(JSON.stringify(out));
  } catch { /* fail open — never block a tool call on our own error */ }
}

let isEntry = false;
try { isEntry = import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { /* imported, or -e */ }
if (isEntry) main();
