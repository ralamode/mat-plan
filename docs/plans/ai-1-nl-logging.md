# AI-1 — NL logging via Anthropic structured outputs (plan)

> Backlog: [plan.md](../plan.md) → AI-1 · spec: [spec.md](../spec.md):203.
> Branch: `docs/ai-1-nl-logging` (off `main`). **Plan only** — implementation
> follows as its own PR. **Decisions complete (S1–S5).** Still to come before any
> implementation: the engineering + UX panels, and **GAP-3 must land first (S5).**

## Goal

**What's broken.** Logging a strength session today is hand-typing, on a phone, mid-set. The V1-10
card shows the day's movements; the athlete then types every movement name and adds a set row per
set — and does it between sets, one-handed, in a gym. `V1-21` exists because of this: it asks whether
the form-with-set-rows model is the right shape at all. `V1-19` is the incremental answer (one tap
builds the form from the program). **AI-1 is the answer for everything not in the program** — the
ad-hoc set, the substitution, the thing a kid did that nobody planned, which no prefill can reach
because there is no prescription to prefill from.

**What it does.** A parent or coach says what happened in natural language. Anthropic structured
outputs extract it into fields that match this app's entry schema. The extraction surfaces as a
**chip** — the parse, shown back for correction, not approval theatre (**S2**).

**Confirm prefills the form; it does not write.** The chip's confirm lands the extracted values in the
existing strength form — movement names, set count, reps — with the **load field empty**. The human
types the loads and submits through the shipped V1-8-2 write path, which stays the single writer. Two
things fall out of that, rather than being bolted on: **S1** holds structurally (the model's output
never reaches a load field, because it never reaches the database at all — a human does), and the
whole validated write path, its zod schemas and its error envelope are reused rather than duplicated
for a second caller. It is the same shape V1-19 uses, for the same reason.

The friction is real and accepted: an entry that carries no load — a wake time, practice minutes —
still routes through a form it does not need. Worth one branch fewer and one write path fewer.

## Acceptance

Each is stated so a test can fail it.

- **The extraction never reaches the database.** Confirm prefills the form; the V1-8-2 strength write
  path stays the only writer. Asserted by exercising the extraction path and showing it performs no
  write.
- **The model never emits a load.** Enforced by the emit-schema — there is no load field to
  populate — not by prompt instruction (**S1**). Asserted as a **binary** gate over the invariant
  cases (**S4**): any violation fails, regardless of accuracy.
- **The extraction matches what was performed.** The 15-case golden set asserts field-level equality
  against expected output on the fields the model may emit — profile, movement, activity, set count,
  reps, duration. (Replaces "model extracts what was performed", which named no comparison and so
  could not fail.)
- **The eval runs on every PR**, as a required check, under **two separate gates** — an accuracy
  threshold over the accuracy cases, and the binary invariant above (**S4**).

> **On `packages/engine`:** an earlier draft said "load comes from `packages/engine`." It does not,
> and cannot — `packages/engine/src/index.ts` is `export {}`, a placeholder whose real contents land
> at **v2**. Under **S1** a load has two legitimate origins; at AI-1 only the first exists, so **the
> human types it** into the prefilled form. The engine becomes the second origin at v2. Stating it as
> an AI-1 acceptance criterion made AI-1 silently depend on all of v2.

## Decisions

**S1 — a load is safe to write only by provenance.** A load may only be written if a human performed
it, or a readable rule derived it. An LLM never emits a load.

A logged load has three origins: a human typed what the athlete performed, the engine derived it from
rules the parent can read, or a model produced it. Once in the row, the origin is indistinguishable —
the first two carry a property that the third does not, in that someone did the work or a readable
rule accounts for the number.

Rejected: enforce the invariant in the prompt — instruct the model never to emit a load, and rely on
it obeying. Tempting because it is the cheapest possible implementation: one sentence of English, no
schema change, no write-path work, and it is genuinely effective most of the time — a good model
following a clear instruction will comply on the overwhelming majority of inputs. It reads like the
constraint has been implemented, and a high pass rate on the eval would appear to confirm that.

It costs the difference between a constraint and a request. A write path can refuse; a prompt can
only ask. The gap shows up exactly where it matters least often and hurts most: the odd input, the
ambiguous phrasing, the case nobody wrote a golden vector for. And it degrades silently — the prompt
does not report that it was overridden, so the first evidence is a load in a row with no human and no
rule behind it, indistinguishable from the two legitimate origins once stored.

There is a second, quieter cost. A prompt-enforced invariant is **not testable as an invariant** — the
same objection S2 raises about the chip. You can measure how often the model complied on fifteen
cases; you cannot assert that it will comply on the sixteenth. That makes it a scalar, which is
precisely the thing S4 refuses to let the binary property become. Put the constraint in the schema and
the write path — where a violation is a rejected request rather than an unlucky sample — and the
property is one CI can actually gate.

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

**S3 — the structured output carries performed facts only.** A prescription is a target and can be
a range — `25-35` means "work somewhere in this range." A performance is a single fact of what was
actually performed. The model extracts performances, so range-shaped and target-shaped values are
out of bounds by construction.

Given this - the fields the model emits will not contain ranges, or odd abbreviations that might be done in handwriting or typed into a spreadsheet as shortcuts. They will be shapes that are compatible with the entry schema for mat-plan.

Rejected: let the model emit the parent's raw string and parse it afterward. Tempting because
`parseLoad` already does exactly this — it is a working, tested, shipped function that turns
`"62.5"`, `"BW"`, `"30in"` into a stored value, so routing model output through it looks like reuse
rather than a new decision. It costs the thing [ADR 0004](../decisions/0004-typed-measurements.md)
spent a PR buying. That function's last branch is a **permissive fallthrough** — every guard is a
named rejection (`~75`, `12-15`, `1e3`, `SKIPPED`, a comma), and anything reaching the end becomes a
text label (`packages/shared/src/strength.ts:137`). A blocklist is only as good as its authors'
imagination of what arrives, which is an acceptable bet against a parent typing on a phone and a bad
one against a model: it produces the unanticipated shape at a volume no human matches, and each one
that slips through is stored, not surfaced. ADR 0004 §3 already settles the direction — the
extractor's job is **conformance, not accommodation**, and a value that cannot be normalized is shown
to a human rather than kept as a string "for later." Emitting a raw string inverts that on the one
path best equipped to abuse it.

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

**S5 — AI-1 waits for GAP-3, because the schema it extracts into is being replaced.**
[plan.md](../plan.md):70 says AI-1 "only needs the entry schema + a write path (both present after
v1)." Both are present. Neither is settled — and "present" is true of the wrong thing.

[ADR 0004](../decisions/0004-typed-measurements.md) replaces the measurement columns in the log path:
`weight_label` drops, `weight_num`/`weight_unit`/`is_band` and the distance/height overrides arrive,
and `parseLoad` becomes numeric-only. Its implementation plan is **deliberately unwritten**, pending
the four legacy CSV samples that also block V1-13. So the target of the extraction is a moving
schema, and AI-1 has carried an undocumented dependency on GAP-3 since the day ADR 0004 was accepted.

Three ways out: scope AI-1's emitted fields around GAP-3's blast radius; ship against today's columns
and rewrite later; or sequence AI-1 behind GAP-3. **Taken: sequence behind it** — legacy CSV samples
→ GAP-3 plan + panels → GAP-3 → V1-13 → AI-1. The extractor is written once, against the schema it
will live on.

Rejected: ship the extractor against today's columns and rewrite it when GAP-3 lands. Tempting
because AI-1 is the repo's headline and the thing blocking it is a find-four-files task rather than
engineering — which reads like waiting on nothing, and makes the wait feel like a choice rather than
a dependency. It costs the extractor twice, and that is the **exact** cost ADR 0004 already priced
when it put V1-13 behind GAP-3 for the same reason ("doing V1-13 first means writing the formatter
twice"). Paying it a second time, for a second consumer, would promote a named one-off into the way
this repo sequences work.

Also rejected: narrow the emitted fields until they miss GAP-3 — defensible, since S1 already forbids
the load and the load is most of what GAP-3 touches, leaving only `seconds` and `is_band` genuinely
overlapping. It fails on the eval. The golden cases are the artifact AI-1 is judged on, and cases
written against a schema mid-replacement have to be re-authored with it — so the narrow scope saves
the extractor and spends the fixture, which is the more expensive half.

---

## Open — next pass

_Clear._ S1–S5 are written, the Goal states the problem, and every acceptance criterion names a
comparison a test can fail.

**Not open, but load-bearing — the gates this plan must pass before implementation:**

- The **engineering panel** (≥3 adversarial lenses) and, because the chip is UI, the **UX panel** —
  both **before** implementation code, per [AGENTS.md](../../AGENTS.md).
- **S5's sequencing** means the panels are not the next action either. AI-1 sits behind GAP-3, which
  sits behind the four legacy CSV samples. Those samples are the live blocker.
