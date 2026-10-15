# Phase 45 — Targeted re-verify after a FAIL: re-check the unmet criteria and only the passed ones the fix can affect, carry the rest over (GitHub #129)

_Promoted from the backlog (`2026-10-14-targeted-re-verify-after-a-fail-re`, captured 2026-10-14). This is a captured note, not a discussion — run `/astro-discuss 45` before planning._

## The idea, as captured

From #129: 117 verifier runs measured; full re-runs after 1-3 small local failures were 33% of verifier cost, and scoping them would have saved about 26% of all verifier cost. Live example 2026-10-14: astro-forge phase 222 re-verified in full four times on one criterion (C6). The verdict must record which criteria were re-checked and which carried over, so acceptance stays auditable; a full re-verify stays available and is chosen when the fix is broad. Fits milestone 5 (Lean execution path).
