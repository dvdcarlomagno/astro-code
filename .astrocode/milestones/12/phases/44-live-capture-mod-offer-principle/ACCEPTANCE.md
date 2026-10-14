# Acceptance — phase 44: live-capture mod

Run these in an interactive Claude Code session, version 2.1.292 or later, with `ac install`
done.

1. **Switch it on, and see that off costs nothing.** You can enable live-capture with
   `ac mods enable live-capture`. `ac mods status` lists it as built, kind `mod`, and it was
   off before you enabled it.
   - *Precondition:* a `~/.astro/config.json` with no `mods.live-capture` key, or one set to
     `false`.

2. **Type a rule and get a proposal.** Inside an astro-code project, you type a standing rule
   in your own project words, for example "in this repo never mock the database in tests, it
   hid a migration bug".
   - Within a turn or two, the transcript shows one dim line: `1 proposed —
     /astro-principles-review`.
   - `ac principles list --proposed` shows a new entry whose statement has been lifted free of
     project nouns, with a kind and a why.
   - `ac principles show <id>` shows source `live <session-id>`, this project, and your typed
     words as the excerpt.
   - *Precondition:* the switch is on; a project whose `ac status` prints a `Project:` line; a
     personal store that holds no entry with the same statement.

3. **Ordinary prompts and commands propose nothing.** You type an ordinary request ("what does
   this function do?"), run a slash command such as `/astro-status`, and run a `claude -p
   "always use tabs"`. None of these adds a proposed entry, and no line or toast appears.
   - *Precondition:* the switch is on; the count of proposed entries from
     `ac principles list --proposed` is noted beforehand.

4. **Repeats are not duplicated, and the volume is capped.** In one session, you type the
   same rule as in item 2 again. The proposed count does not grow, and `ac principles show
   <id>` gains a sighting. Then you type four more distinct rules. At most 3 new proposals land
   in this session, and reaching the cap shows nothing.
   - *Precondition:* the entry from item 2 is still in the store (proposed or accepted); a fresh
     session.

5. **You review them like any other proposal.** `/astro-principles-review` lists the
   live-captured entries beside the others, and you can accept or reject them there. Nothing
   was ever accepted on your behalf.
   - *Precondition:* at least one live-captured proposed entry from item 2 or 4.

6. **A broken model or `ac` never touches your prompt.** With `ac` temporarily off `PATH` for
   the session (or the network down), you type several rules.
   - Every prompt goes through unchanged and with no delay.
   - At most one `⚠ principle capture failed: …` line appears for the session.
   - No toast appears, and no half-written entry lands.
   - *Precondition:* the switch is on; `ac principles list --json` output is noted beforehand.

7. **Band or notice, never both.** With `ac mods enable phase-band` on as well, inside a
   project, the count from a new proposal shows in the band and no dim line is added. With the
   band off, the dim line shows instead.
   - *Precondition:* phase 43 has landed (`ac mods status` lists phase-band as built); the
     switch is on; a session with at least one live proposal.
