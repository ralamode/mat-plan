# AI-1 — NL logging via Anthropic structured outputs (plan)

> Backlog: [plan.md](../plan.md) → AI-1 · spec: [spec.md](../spec.md):203.
> Branch: `docs/ai-1-nl-logging` (off `main`). **Plan only** — implementation
> follows as its own PR. Sections land incrementally.

## Goal

The goal of NL logging is to capture natural language log input from a parent/coach, convert it into structured output using anthropic structured outputs that match this app's entry schema. Once converted, these NL logging entries will surface as chips (part of the UX), the parent or coach can confirm the chip which will then write the entry to the DB (or to the form they are filling in during the workout or log entry to add to the db).

## Acceptance

- Structured output from the NL log should never be directly saved to the DB, storage only comes from confirm chip
- LLM never emits a load, load comes from packages/engine.
- Model extracts what was performed
- Eval is run on every PR against golden cases, CI gates change if it fails the run.

## Decisions

**S1 — a load is safe to write only by provenance.** A load may only be written if a human performed
it, or a readable rule derived it. An LLM never emits a load.

A logged load has three origins: a human typed what the athlete performed, the engine derived it from
rules the parent can read, or a model produced it. Once in the row, the origin is indistinguishable —
the first two carry a property that the third does not, in that someone did the work or a readable
rule accounts for the number.

Rejected: A write path can refuse, a prompt can only ask.

**S2 — the confirm chip is UX, not the safety mechanism.** Approval is a behavior, and behaviors
become routine under repetition. If the chip were the safety mechanism, approving it day after day
would become mundane and reflexive, and the safety of that would decay.

What is the parent doing at the moment they approve the 50th chip? They are going through the motions
— the routine — and they are no longer closely inspecting whether it looks right. That is why it is
not good as a safeguard.

Rejected: depend on the model to emit a load value, and rely on the human to catch incorrect values.
Tempting because it is what nearly every AI product does, it ships faster, it needs no deterministic
engine on that path, and "there's a human in the loop" sounds responsible at design review. It costs
the guarantee itself — moved from a property of the system to a property of a tired person's
attention after a long day. That is unfalsifiable: you cannot test that a human will pay attention,
so you cannot gate it in CI. A capability constraint is testable; an attention assumption is not.

So what the chip is actually for: it catches **parse errors**. The model may have misheard the
natural-language input — wrong movement, wrong reps, wrong kid. It is a correctness check on the
extraction, not a safety check on the authority. Different failure, different mechanism.

**S3** — _(TBD.)_

**S4 — accuracy and the invariant get separate gates.** A threshold may only average over
measurements that fail the same way. Accuracy, latency, and cost are scalar and negotiable; "the
model never emits a load" is binary, and averaging is the one operation a binary property cannot
survive.

Fifteen cases behind one 90% gate returns 14/15 = 93.3%. Green, merged. Which case failed? If it was
an accuracy case, a bodyweight entry parsed slightly wrong. If it was an invariant case, a
model-authored load reached the database and CI reported success. The number cannot tell you which.

Rejected: a single gate over all 15. Tempting because it's one config value and one number to report,
and 93% reads as healthy. It costs the ability to distinguish a bug from a breach — the two failures
that most need different responses become the same line in the log.

---

## Open — next pass

- **S1's rejection is only its punchline.** It needs the rejected design (enforcing the invariant in
  the prompt) and why that is tempting, in the shape S2 and S4 use.
- **Goal states what the feature does, not what is broken.** The motivation is `V1-21`: a phone,
  mid-set, hand-typing movement names and set rows. Also resolve the hedged
  "(or to the form they are filling in…)" — does confirm write directly, or populate the form?
- **Acceptance criteria are not all checkable.** "Model extracts what was performed" cannot be
  verified as written.
- **S3 — what the structured output may contain.** Must not reintroduce the free-text `load` that
  [ADR 0004](../decisions/0004-typed-measurements.md) removed.
