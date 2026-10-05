# EVAL-0 — the safety gate ships before the model

> Backlog: [plan.md](../plan.md) → AI-1 · design: [ai-1-nl-logging.md](./ai-1-nl-logging.md) S4.
> **Plan only.** Answers a sequencing question: how much of AI-1's eval can be built now without
> being rewritten when GAP-3 lands?

## Why this exists

This app writes training loads for children. The design rule that follows from that — **the model can
never emit a load** — is the one claim in the system where being approximately right is the same as
being wrong. S4 of the AI-1 plan argues it needs its own gate at 100%, separate from accuracy, failing
with a different message, because a bug and a boundary breach demand different responses.

Right now that is an argument in a document. Nothing enforces it in CI.

AI-1 itself sits behind GAP-3 → authoring → scheduling → beta, which is correct sequencing — the
schema it extracts into is being replaced. But **the enforcement does not have to wait for the
feature.** Shipping the gate first means the rule is already held when the model arrives, rather than
being retrofitted around behaviour that already exists.

## What is and is not schema-dependent

| Piece                                                                            | Depends on                         | Build now? |
| -------------------------------------------------------------------------------- | ---------------------------------- | ---------- |
| The fifteen natural-language **inputs**                                          | nothing — sentences a parent types | ✅ durable |
| The **expected structured outputs**                                              | GAP-3 typed columns                | ❌ wait    |
| The **two-gate mechanism** — two case classes, two thresholds, two failure modes | nothing                            | ✅ durable |
| The **runner / reporter**                                                        | loosely, the comparison shape      | ✅ mostly  |
| The **model call**                                                               | AI-1's parse path (does not exist) | ⛔ cannot  |
| **Write-path refusal** assertions                                                | the write path, which exists today | ✅ durable |

## The invariant does not need the model

**The three invariant cases do not test model behaviour.** They test that _the write path refuses_,
whatever the model emits. That is a different and stronger claim, and it has a different dependency:
enforcement lives in `PRESCRIPTION_SHAPE` (`packages/shared/src/strength.ts`) and in ADR 0005's
by-construction `ScaffoldRow` — both of which exist today.

An invariant test that passes because the model happened to behave is not a test of an invariant. One
that passes because the value is **unrepresentable** is. Only the second kind is worth gating a build
on, and it needs no model.

## Phases

### EVAL-0 — now, zero schema dependency

1. **The two-gate harness.** A runner scoring two case classes **separately**: an accuracy class
   against a configurable threshold, and an invariant class at **100%**. They must fail with
   **different messages and different exit semantics** — not "accuracy dipped" but "the boundary was
   crossed." Wired into CI as a required check.
2. **Write-path refusal assertions.** Prescription-shaped input (`~75`, `75-85`, "next week") is
   refused at the boundary, from any caller. These are the invariant class's first real members, and
   they survive GAP-3: that work changes which _shapes_ are representable, not the rule that a
   prescription is not a performance.
3. **The fifteen NL inputs as a fixture**, each assertion stated in prose with the expected output
   left unbound. The sentences are durable; only their bindings are not.
4. **Placeholder accuracy cases**, trivially true, so the mechanism is demonstrably working and green
   before any real case exists.

**Acceptance — prove both gates fire, and link the runs.** A PR that breaks an accuracy placeholder on
purpose must fail with the accuracy message. A separate PR that breaks an invariant case on purpose
must fail with the boundary message. **Link both CI runs from this document.** A gate nobody has seen
fail is an untested gate, and the two failure modes being genuinely distinct is the whole claim of S4
— so it gets verified, not asserted.

### EVAL-1 — after GAP-3

Bind the fifteen expected outputs to the real typed-measurement schema. Retire the placeholders.
Nothing in the harness or the gates changes.

### EVAL-2 — with AI-1

Wire the model call. The runner, the gates, the CI check and the inputs already exist; this phase adds
the system under test, not the test system.

## Why this ordering is the design, not a workaround

The AI-1 design rests on deterministic enforcement first and the model second. Applying the same
ordering to the test infrastructure is consistency, not expedience: the constraint is in place before
anything exists that could violate it, which is the only ordering under which "it was never possible"
is a true statement rather than a hopeful one.

It also removes a class of mistake. A gate retrofitted around a working feature gets its thresholds
tuned until the feature passes. A gate that predates the feature sets the bar the feature has to meet.

## Verified gate runs

_(Filled in by EVAL-0's acceptance step.)_

| Gate            | Deliberate break | CI run |
| --------------- | ---------------- | ------ |
| Accuracy class  | _TBD_            | _TBD_  |
| Invariant class | _TBD_            | _TBD_  |
