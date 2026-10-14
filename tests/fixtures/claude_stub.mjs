// A stand-in for the `claude` CLI, for the astro-mods tests (phase 36). It speaks just the
// subset `lib/mods.mjs` uses -- `--version` and `claude plugin marketplace|install|update|
// uninstall|list` -- with the JSON shapes the real 2.1.292 printed (PLAN F2), so the CLI and
// lifecycle suites run the real `ac` against a binary that never touches a real profile.
//
// Faithful where it matters:
//   - state is per config dir (`CLAUDE_CONFIG_DIR`, or 'default' when unset), the way the
//     real CLI keeps one marketplace/plugin set per profile;
//   - `marketplace add` of a DIFFERENT path under an existing name silently re-points it and
//     exits 0 (the real behaviour) -- so `ac` has to compare paths itself and never lean on
//     claude to refuse;
//   - the marketplace name is read from `<path>/.claude-plugin/marketplace.json`, and an add
//     of a path with no such file fails;
//   - `install` fails (exit 1, outcome "failed") when the marketplace is missing, does not
//     list the plugin, or CLAUDE_STUB_FAIL_INSTALL=1.
//
// Every call appends `${CLAUDE_CONFIG_DIR||'-'}\t${argv.join(' ')}` to logFile, so a test can
// assert both WHAT was asked and for WHICH profile. The shebang is the absolute node, so the
// stub works under a PATH that has no `node` on it.
import { writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function writeClaudeStub(binDir, { version = '2.1.292', stateFile, logFile }) {
  mkdirSync(binDir, { recursive: true });
  const body = `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const VERSION = ${JSON.stringify(version)};
const STATE = ${JSON.stringify(stateFile)};
const LOG = ${JSON.stringify(logFile)};
const argv = process.argv.slice(2);
fs.appendFileSync(LOG, (process.env.CLAUDE_CONFIG_DIR || '-') + '\\t' + argv.join(' ') + '\\n');
if (argv[0] === '--version') { console.log(VERSION + ' (Claude Code)'); process.exit(0); }
const key = process.env.CLAUDE_CONFIG_DIR || 'default';
let all = {};
try { all = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
const s = (all[key] = all[key] || { marketplaces: [], plugins: [] });
const save = () => fs.writeFileSync(STATE, JSON.stringify(all, null, 2));
const out = (obj, code = 0) => { console.log(JSON.stringify(obj)); process.exit(code); };
const readMarket = (p) => { try { return JSON.parse(fs.readFileSync(path.join(p, '.claude-plugin', 'marketplace.json'), 'utf8')); } catch { return null; } };
if (argv[0] !== 'plugin') { console.error('stub: unsupported ' + argv.join(' ')); process.exit(1); }
const line = argv.slice(1).join(' ');
if (line === 'marketplace list --json') {
  out(s.marketplaces.map((m) => ({ name: m.name, source: 'directory', path: m.path, installLocation: m.path })));
}
if (line === 'list --json') {
  out(s.plugins.map((id) => ({ id, version: '0.40.2', scope: 'user', enabled: true, installPath: '/stub', readFromFolder: true })));
}
if (argv[1] === 'marketplace' && argv[2] === 'add') {
  const p = argv[3];
  const mk = readMarket(p);
  if (!mk) { console.error('stub: no marketplace at ' + p); out({ command: 'marketplace-add', outcome: 'failed', failureCode: 'not_found' }, 1); }
  s.marketplaces = s.marketplaces.filter((m) => m.name !== mk.name);
  s.marketplaces.push({ name: mk.name, path: p });
  save();
  out({ command: 'marketplace-add', outcome: 'ok', marketplace: mk.name, message: 'added' });
}
if (argv[1] === 'marketplace' && argv[2] === 'remove') {
  s.marketplaces = s.marketplaces.filter((m) => m.name !== argv[3]);
  save();
  out({ command: 'marketplace-remove', outcome: 'ok' });
}
if (argv[1] === 'install') {
  const [plugin, market] = String(argv[2]).split('@');
  const m = s.marketplaces.find((x) => x.name === market);
  const mk = m && readMarket(m.path);
  const listed = mk && (mk.plugins || []).some((p) => p.name === plugin);
  if (!listed || process.env.CLAUDE_STUB_FAIL_INSTALL === '1') {
    console.error('✘ failed to install ' + argv[2]);
    out({ command: 'install', outcome: 'failed', failureCode: 'not_found' }, 1);
  }
  if (!s.plugins.includes(argv[2])) s.plugins.push(argv[2]);
  save();
  out({ command: 'install', outcome: 'ok', pluginId: argv[2], scope: 'user' });
}
if (argv[1] === 'update') out({ command: 'update', outcome: 'ok', updateOutcome: 'up_to_date' });
if (argv[1] === 'uninstall') {
  s.plugins = s.plugins.filter((p) => p !== argv[2]);
  save();
  out({ command: 'uninstall', outcome: 'ok' });
}
console.error('stub: unsupported ' + argv.join(' '));
process.exit(1);
`;
  const bin = join(binDir, 'claude');
  writeFileSync(bin, body);
  chmodSync(bin, 0o755);
  return bin;
}
