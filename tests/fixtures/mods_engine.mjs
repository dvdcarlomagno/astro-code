// A small in-test simulator of Claude Code's plugin engine, shared by the astro-mods suites
// (phase 36 skeleton, phase 39 blindfold). The plugin is plain ESM that needs only something to
// call `register(on)` and then drive its hooks the way Claude Code does:
//   - `on(name, hook)` records the hook and returns `{ catch(h) }`;
//   - an invocation that THROWS, REJECTS or OVERRUNS the budget goes to the recorded `.catch`
//     handler, with `next` augmented by `error` and `called` -- the fail-open mechanism the real
//     validator accepts (phase 36 PROBE.md F3), which is why the plugin has no wrapper of its own;
//   - `next` is what sits BENEATH the plugin: a test chooses what it resolves to (`beneath`), so
//     "ALLOWED" can mean "exactly what the engine below answered", never the plugin's own allow;
//   - `$` has `process.run`, `ui.toast`, `agent.list`, `session.cwd` and `fs.exists`, each a
//     recorder backed by a settable implementation. Anything else the plugin reached for would be
//     undefined and surface as a failed hook (and a toast).
// Event shapes come from the PROBE.md files (phase 36 and 39).
//
// register() starts a clean slate (every switch off, the once-per-session notice re-armed), so
// each test registers a fresh simulated engine against the same module instance: the plugin's
// sibling modules are cached by Node and a `?query` on register.js would not reach them.
export const NAMES = ['canon-guard', 'git-guard', 'blindfold', 'spawn-policy', 'witness', 'brief-section', 'phase-band', 'live-capture'];
export const SESSION_START = { cwd: '/work/proj', surface: null, isInteractive: false };

/** What the engine answers beneath the plugin on a `tool.check`. Frozen: identity is the test. */
export const BENEATH = Object.freeze({ decision: 'allow', hook: 'PreToolUse' });

export const switches = (over = {}) => ({ switches: { ...Object.fromEntries(NAMES.map((n) => [n, false])), ...over }, warnings: [] });
export const answer = (obj) => async () => ({ exitCode: 0, stdout: JSON.stringify(obj), stderr: '', isStdoutTruncated: false, isStderrTruncated: false });

const plugin = () => import('../../mods/astro-mods/hooks/register.js');

// what a hook's `next` resolves to when a test does not say
const defaultBeneath = (name) => (name === 'tool.check' ? BENEATH : (x) => x);
const asNext = (impl) => (typeof impl === 'function' ? impl : () => impl);

export async function boot(runImpl, { toastThrows = false } = {}) {
  const { register } = await plugin();
  const hooks = [];
  const on = (name, hook) => {
    const rec = { name, hook, catchHandler: null };
    hooks.push(rec);
    return { catch(h) { rec.catchHandler = h; return this; } };
  };
  const runs = [];
  const toasts = [];
  const listCalls = [];
  let listImpl = async () => [];
  let cwdImpl = async () => '/work/proj';
  let existsImpl = async () => false;
  const $ = {
    process: { run: (argv, init) => { runs.push({ argv, init }); return runImpl(argv, init); } },
    ui: { toast: (text) => { toasts.push(text); if (toastThrows) throw new Error('no UI under -p'); } },
    agent: { list: (...a) => { listCalls.push(a); return listImpl(...a); } },
    session: { cwd: (...a) => cwdImpl(...a) },
    fs: { exists: (p) => existsImpl(p) },
  };
  register(on, {});

  /**
   * Fire one hook the way the engine does. A hook name that is not registered resolves to
   * `undefined`, so a RED run fails on the assertion and not with a TypeError.
   * `beneath` is what `next` resolves to (a value, or a function of the event); `replay` is what
   * the `.catch` handler's `next` answers (defaults to the event's own default).
   */
  async function invoke(name, e, { beneath, replay, budgetMs = 10000 } = {}) {
    const rec = hooks.find((h) => h.name === name);
    if (!rec) return undefined;
    const next = Object.assign(asNext(beneath === undefined ? defaultBeneath(name) : beneath), { called: false });
    let timer;
    try {
      const overrun = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('hook overran its budget')), budgetMs); });
      return await Promise.race([Promise.resolve().then(() => rec.hook($, e, next)), overrun]);
    } catch (error) {
      if (!rec.catchHandler) throw error;
      const back = asNext(replay === undefined ? defaultBeneath(name) : replay);
      return await rec.catchHandler($, e, Object.assign(back, { called: false, error }));
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    hooks, invoke, runs, toasts, listCalls,
    setAgents: (impl) => { listImpl = typeof impl === 'function' ? impl : async () => impl; },
    setCwd: (dir) => { cwdImpl = typeof dir === 'function' ? dir : async () => dir; },
    setExists: (fn) => { existsImpl = async (p) => fn(p); },
  };
}
