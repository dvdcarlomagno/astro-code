// The node binary written into hook commands, and the repair of commands already written (#126).
//
// `process.execPath` is the resolved binary. Under Homebrew that is the versioned
// `.../Cellar/node/<version>/bin/node`, which `brew upgrade node` deletes, so every astro hook
// then fails with "No such file". The PATH entry (`/home/linuxbrew/.linuxbrew/bin/node`) is a
// symlink that survives upgrades: it is preferred whenever it resolves to the same binary,
// otherwise `process.execPath` is kept. Entries were matched by script name only, so an
// install never noticed a dead interpreter; `repairNodeCommands` rewrites the interpreter of
// astro's own commands on every install and update.
import { realpathSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';

/** A node path that survives a package-manager upgrade, when PATH has one for this binary. */
export function nodeBin({ env = process.env, execPath = process.execPath } = {}) {
  let real;
  try { real = realpathSync(execPath); } catch { return execPath; }
  for (const dir of String(env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'node');
    try { if (realpathSync(candidate) === real) return candidate; } catch { /* not there */ }
  }
  return execPath;
}

// `"<interpreter>" "<script>" …` or `<interpreter> <script> …`: astro's own when the script is
// one of its hook files (astro-*.mjs, _astro-*.mjs) and the interpreter is a node binary.
const SHAPE = /^\s*(?:"([^"]+)"|(\S+))(\s+)(?:"([^"]+)"|(\S+))/;
const ASTRO_SCRIPT = /^_?astro-[\w-]+\.mjs$/;

/** The command with its interpreter set to `node` when it runs an astro hook script; else as is. */
export function repairNodeCommand(command, node) {
  if (typeof command !== 'string') return command;
  const m = command.match(SHAPE);
  if (!m) return command;
  const interp = m[1] ?? m[2];
  const script = m[4] ?? m[5];
  if (!/^node(\.exe)?$/i.test(basename(interp)) || !ASTRO_SCRIPT.test(basename(script)) || interp === node) return command;
  const lead = command.length - command.trimStart().length;
  const end = lead + (m[1] != null ? interp.length + 2 : interp.length);
  return `"${node}"${command.slice(end)}`;
}

/** Walk a settings/hooks object and repair every `command` string in place; returns how many changed. */
export function repairNodeCommands(data, node) {
  let changed = 0;
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'command' && typeof x === 'string') {
        const fixed = repairNodeCommand(x, node);
        if (fixed !== x) { v[k] = fixed; changed++; }
      } else walk(x);
    }
  };
  walk(data);
  return changed;
}
