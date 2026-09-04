# AI-1 — NL logging via Anthropic structured outputs (plan)

> Backlog: [plan.md](../plan.md) → AI-1 · spec: [spec.md](../spec.md):203.
> Branch: `docs/ai-1-nl-logging` (off `main`). **Plan only** — implementation
> follows as its own PR. Sections land incrementally; S4 first.

## Goal

The goal of NL logging is to capture natural language log input from a parent/coach, convert it into structured output using anthropic structured outputs that match this app's entry schema. Once converted, these NL logging entries will surface as chips (part of the UX), the parent or coach can confirm the chip which will then write the entry to the DB (or to the form they are filling in during the workout or log entry to add to the db).

## Acceptance

- Structured output from the NL log should never be directly saved to the DB, storage only comes from confirm chip
- LLM never emits a load, load comes from packages/engine.
- Model extracts what was performed
- Eval is run on every PR against golden cases, CI gates change if it fails the run.

## Decisions

S4 - Accuracy and the invariant get separate gates. A threshold may only average over measurements that fail the same way. Accuracy, latency, and cost are scalar and negotiable; "the model never emits a load" is binary, and averaging is the one operation a binary property cannot survive.

Fifteen cases behind one 90% gate returns 14/15 = 93.3%. Green, merged. Which
case failed? If it was an accuracy case, a bodyweight entry parsed slightly
wrong. If it was an invariant case, a model-authored load reached the database
and CI reported success. The number cannot tell you which.

Rejected: a single gate over all 15. Tempting because it's one config value and
one number to report, and 93% reads as healthy. It costs the ability to
distinguish a bug from a breach — the two failures that most need different
responses become the same line in the log.
