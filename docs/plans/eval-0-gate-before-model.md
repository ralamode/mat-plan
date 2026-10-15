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

**Phase EVAL-0 implemented 2026-10-15.** Both gates were broken on purpose and watched fail, which is
what this section exists to record.

| Gate                | Deliberate break                                                           | Result                                                                      |
| ------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Accuracy class**  | `acc-placeholder-scalar` expected `9`, given `8`                           | `ACCURACY BELOW THRESHOLD: 66.7% … below the 100.0% threshold` — **exit 1** |
| **Invariant class** | `inv-range` pointed at `'75'`, a representable value, instead of `'75-85'` | `BOUNDARY CROSSED: 1 of 15 invariant cases failed` — **exit 2**             |

**The green run in CI**, with the step wired as a required check:
[run 38748744439 → quality → "EVAL-0 gates (accuracy + invariant)"](https://github.com/ralamode/mat-plan/actions/runs/38748744439/job/116469214660)

```
EVAL-0 — two gates, scored separately

  invariant  15/15 (100.0%) — required 100%
  accuracy   3/3 (100.0%) — threshold 100.0%
  pending    15 natural-language fixtures registered, expectations unbound until EVAL-1

Both gates green.
```

The invariant break printed **93.3%** next to the boundary message — the exact number S4 names as
the one a threshold must never average over. Seeing it rendered beside a refusal to treat it as a
threshold is the clearest demonstration available that the two gates are not the same gate.

**The failure modes are also asserted permanently**, in `packages/evals/src/harness.test.ts`: that
each class fails with its own headline and never the other's, that a threshold below 1 cannot buy an
invariant pass, that a breach outranks a regression when both fail, and that a throwing case is a
failed case rather than a crashed run. A deliberate break proves a gate fired once; the tests prove it
still fires on the day somebody simplifies the exit codes.

### What landed

| Piece                                             | Where                                       |
| ------------------------------------------------- | ------------------------------------------- |
| The two-gate mechanism                            | `packages/evals/src/gates.ts`, `harness.ts` |
| Write-path refusal assertions + positive controls | `packages/evals/src/cases/invariants.ts`    |
| Placeholder accuracy cases                        | `packages/evals/src/cases/accuracy.ts`      |
| The fifteen NL inputs, expectations unbound       | `packages/evals/src/fixtures/nl-inputs.ts`  |
| CI required check                                 | `.github/workflows/ci.yml` → "EVAL-0 gates" |

⚠️ **The stale anchor this plan carried is corrected in the implementation, not here.** This document
says enforcement lives in `PRESCRIPTION_SHAPE`; that constant was deleted by GAP-3 PR 4a along with
`parseLoad`, as [ai-1-nl-logging](./ai-1-nl-logging.md) flagged for this PR to fix. The rule survived
and got cheaper: refusal is now the **format check** on `strengthSetSchema`'s `weight`
(`packages/shared/src/strength.ts:75`), a type rather than a regex blocklist. The reasoning is in the
docblock of `cases/invariants.ts`, and it strengthens the plan's own argument — the cases now pass
because the value is unrepresentable, not because someone enumerated the bad shapes.

**Beyond the plan:** the invariant class also carries **five positive controls**. Ten refusals alone
would stay green if the boundary refused _everything_, which would be a vacuous gate of exactly the
kind this plan was written to prevent.
