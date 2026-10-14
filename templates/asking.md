# Asking the user — the single spec

This is the ONLY place the rules for putting a question to the user are stated. Every command
that asks the user anything (`AskUserQuestion` or a plain question in chat) references this file —
`` `$(ac path templates)/asking.md` `` — and never restates it.

Why it exists: the agent asking has just read the code, so the context is in its head and not on
the user's screen. A question that opens on an internal name (`tool.check`, `segmentTargets`,
"C6(d)") leaves the user unable to tell what part of the system it is about or why the choice
matters, and a guessed answer is worse than no question.

## 1. Frame the round before asking it

Before each round of questions, write **two or three plain sentences**:
- what the work is building, in user-visible terms;
- what this round decides;
- what the user would notice change, depending on the answer.

Skip the frame only when the previous message already said exactly this.

## 2. Each question starts from the effect

Open the question with the situation the user would recognise, then the choice:
"When an agent tries to edit the roadmap by hand, should it be blocked or warned?", not
"Should `tool.check` return deny or ask?". No internal name, file, flag or criterion id appears
before the plain-language part. Afterwards, at most one short clause of technical detail, and only
if it changes the answer.

## 3. Options are described by what happens

Each option's label and description say **what the user gets or sees** with that choice. Trade-offs
are stated as consequences ("an unattended run stops and waits for you"), not as mechanisms.
Keep the recommended option first, as the commands already require.

## 4. Always leave a way to ask for the bigger picture

Every `AskUserQuestion` keeps one option, **"Explain more"**, unless the question already has four
options; in that case the automatic "Other" serves, and the frame says so in one clause. When the
user picks it: explain the surrounding context in a few plain sentences (what exists today, what
changes, why the choice matters), then ask the **same** question again, reworded if needed.

## 5. What stays out

These rules shape how a question reads, never how many are asked or what is decided: each command
keeps its own question budget, gates and recording rules. Machine-read artifacts (CONTEXT.md,
PLAN.md, CRITERIA.md) are not questions and are unaffected.
