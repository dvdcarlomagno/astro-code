// What the SessionStart / PreCompact settings hooks print, as data -- the feed the brief-section
// mod reads (phase 42, ADR-071 c: a mod reads only through `ac`).
//
// Why it exists: brief-section keeps the hooks registered (Cursor and Codex still run them, ADR-072)
// and, inside Claude, drops their output by EXACT content, because the engine exposes no hook name
// (PROBE.md F1). So the mod needs the hooks' exact strings, and the only honest source is the code
// that makes them: `sessionParts` (the same selection `ac principles brief --part K/N` prints),
// `renderResumeNote` (PreCompact's systemMessage), and the same #116 opt-out the hooks honour.
// Rebuilding any of them in the plugin would be a second copy that drifts the day a hook changes.
//
// Read-only: no sync, no usage log, nothing written. `positionOnly` skips the principle store
// altogether -- it is the cheap per-turn call, and it must work when the store is unreadable.
import { findAstroRoot, readContext, renderResumeNote, sessionBriefEnabled, BRIEF_PARTS } from '../hooks/_astro-ctx.mjs';
import { sessionParts } from './retrieval.mjs';

/**
 * @param {{ cwd?: string, home?: string, dir?: string, positionOnly?: boolean, now?: Date }} opts
 * @returns {Promise<{ serve: boolean, parts: string[], position: string } | { position: string }>}
 */
export async function briefSectionFeed({ cwd = process.cwd(), home, dir, positionOnly = false, now = new Date() } = {}) {
  const root = findAstroRoot(cwd);
  const position = root ? renderResumeNote(readContext(root, Math.floor(now.getTime() / 1000))) : '';
  if (positionOnly) return { position };
  const serve = Boolean(root) && sessionBriefEnabled(home);
  if (!serve) return { serve: false, parts: [], position: '' };
  return { serve, parts: await sessionParts({ dir, cwd: root, n: BRIEF_PARTS }), position };
}
