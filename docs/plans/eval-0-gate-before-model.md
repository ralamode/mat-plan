# EVAL-0 — build the gate before the model

> Backlog: [plan.md](../plan.md) → AI-1 · design: [ai-1-nl-logging.md](./ai-1-nl-logging.md) S4.
> **Plan only.** Sequencing answer to: how much of the AI-1 eval can be built now without being
> rewritten when GAP-3 lands?

## The question

AI-1 now sits behind GAP-3 → authoring → scheduling → beta. Its eval design — fifteen golden cases,
a CI gate, and **three cases that test a safety property at 100% rather than an accuracy threshold** —
is the most portfolio-relevant thing in this repo, and it is currently a document. The risk is that
it stays one.

The naive fix is "build the eval now", which would be mostly throwaway: the expected outputs are
schema-shaped, and GAP-3 is replacing the schema.

## What is and is not schema-dependent

| Piece                                                                            | Depends on                         | Build now? |
| -------------------------------------------------------------------------------- | ---------------------------------- | ---------- |
| The fifteen natural-language **inputs**                                          | nothing — sentences a parent types | ✅ durable |
| The **expected structured outputs**                                              | GAP-3 typed columns                | ❌ wait    |
| The **two-gate mechanism** — two case classes, two thresholds, two failure modes | nothing                            | ✅ durable |
| The **runner / reporter**                                                        | loosely, the comparison shape      | ✅ mostly  |
| The **model call**                                                               | AI-1's parse path (does not exist) | ⛔ cannot  |
| **Write-path refusal** assertions                                                | the write path, which exists today | ✅ durable |

## The realignment that unblocks this

**The three invariant cases do not test the model.** They test that _the write path refuses_,
whatever the model emits. That is a stronger claim and a different dependency: enforcement lives in
`PRESCRIPTION_SHAPE` (`packages/shared/src/strength.ts`) and in ADR 0005's by-construction
`ScaffoldRow`, both of which exist **now**.

An invariant test that passes because the model happened to behave is not a test of an invariant. One
that passes because the value is unrepresentable is. The second kind needs no model.

## Phases

### EVAL-0 — now, zero schema dependency

1. **The two-gate harness.** A runner that scores two case classes **separately**: an accuracy class
   against a configurable threshold, and an invariant class at **100%**. They must fail the build
   with **different messages and different exit semantics** — not "accuracy dipped" but "the boundary
   was crossed." Wire it into CI as a required check.
2. **Write-path refusal assertions** — prescription-shaped input (`~75`, `75-85`, "next week") is
   refused at the boundary, from any caller. These are the invariant class's first real members and
   they survive GAP-3, because GAP-3 changes the _shapes_ that are representable, not the _rule_ that
   a prescription is not a performance.
3. **The fifteen NL inputs as a fixture**, with each assertion stated in prose and the expected
   output left unbound. The sentences are durable; only their bindings are not.
4. **Seed the accuracy class with trivially-true placeholder cases** so the two-gate mechanism is
   demonstrably working and green before any real case exists.

**Exit:** CI fails one way when an accuracy placeholder is broken on purpose, and a different way when
an invariant case is broken on purpose. **That demo is the artifact** — it is what makes the S4
argument a thing that runs rather than a thing that is argued.

### EVAL-1 — after GAP-3

Bind the fifteen expected outputs to the real typed-measurement schema. Retire the placeholders.
Nothing in the harness or the gates changes.

### EVAL-2 — with AI-1

Wire the model call. The runner, the gates, the CI check and the inputs already exist; this phase
adds the system under test, not the test system.

## Why this ordering is the point, not a compromise

Building the gate before the model is the same discipline the whole AI-1 design rests on:
**deterministic enforcement first, model second.** The eval harness existing before the feature is
not a workaround for AI-1 being far away — it is the ordering the design argues for, applied to the
test infrastructure instead of the runtime.

It also means the honest README line — "designed in full, not yet built" — becomes "the gate is
built and running; the model behind it is not."
