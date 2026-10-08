# Logging speed — how a session actually gets logged, and how to make it fast

> **Status: brainstorm / design investigation.** Not a plan, not scoped, no engineering panel. Feeds
> **V1-19** (scaffold the form from the program), **V1-21** (is the form-with-set-rows model right at
> all), and **AI-1**. _(Ray, 2026-09-16 — prompted by the "slower than Notes" finding in
> [product-spec.md §12](../product-spec.md).)_
>
> Backlog: [plan.md](../plan.md) → V1-19 · V1-21. Related: [ADR 0004](../decisions/0004-typed-measurements.md)
> (typed measurements), [ai-1-nl-logging.md](./ai-1-nl-logging.md) (S1 — load provenance).

## 1. The problem, measured

A 3-movement × 3-set session on the current form (`apps/web/app/p/[profileId]/strength-form.tsx`):

| Step                                                                      | Count      |
| ------------------------------------------------------------------------- | ---------- |
| Movement names, typed freehand — `autoComplete="off"` (`:406`), no picker | 3 names    |
| reps + weight per set                                                     | 18 entries |
| "Add set" — each movement starts with exactly one (`:58`)                 | 6 taps     |
| "Add movement"                                                            | 2 taps     |
| Submit                                                                    | 1          |
| **Total**                                                                 | **~30**    |

Ray's real program day (the screenshot) is **7 movements, 25 sets** — roughly **60+ interactions**,
performed between sets, one-handed, on a phone.

**The comparison that matters:** in a notes app this is one line. The product spec names losing to
Notes as a top risk, and this is the only screen where it's true — wake, weigh-in, rice bucket, brain
rep and splits are already one tap.

**The absurdity that should drive the fix:** the "Today's program" card sits directly above the form
and already knows every movement name. The athlete reads it off the screen and retypes it into the
screen.

## 2. What the program card actually contains — and why it settles the reps question

From Ray's real Strength B day:

| #   | Movement                | Prescribed reps                    | Shape                       |
| --- | ----------------------- | ---------------------------------- | --------------------------- |
| 1   | Med-Ball Slam           | `5`                                | ✅ clean integer            |
| 2   | Trap-Bar Deadlift       | `3 (top triple, then 2 back-offs)` | ❌ prose                    |
| 3   | Overhead Shoulder Press | `6`                                | ✅ clean integer            |
| 4   | 1-Arm DB Row            | `8/side`                           | ⚠️ integer + per-side       |
| 5   | Pull-Up                 | `5, last AMRAP`                    | ⚠️ mixed — last set unknown |
| 6   | Bulgarian Split Squat   | `8/leg`                            | ⚠️ integer + per-side       |
| 7   | Ab Rollout              | `8-10, last set to failure`        | ❌ range + unknown          |

**Reps are free text, exactly like loads.** Confirmed in the schema:
`packages/shared/src/programming.ts:97,100` — both `load` and `reps` are `z.string().nullable()`,
transcribed verbatim.

So **2 of 7** prescriptions have a rep count a numeric field could hold today. After GAP-3 moves
per-side onto the movement ([ADR 0004 §4](../decisions/0004-typed-measurements.md)), that becomes
**4 of 7**. Three never will be — because `AMRAP`, `to failure` and `8-10` are _the number you discover
by doing the set._ Prefilling those doesn't just risk a wrong record; it records a fiction about the
one set whose whole purpose was to find out.

**Conclusion:** "prefill the reps" is not one feature. It is a clean case (fill it) and a discovered
case (must stay empty, and should arguably be _highlighted_ as the set that matters).

## 3. Where the safety line actually falls

Worth stating precisely, because it is narrower than it has been applied.

**S1 governs loads, and only loads.** A wrong load is an injury; a wrong rep count is a data-quality
bug. The `packages/engine`/human provenance rule exists because of physical risk, and reps do not
carry it. **Reps are a data-accuracy question, not a safety question** — which means they can be
designed for speed, and loads cannot.

**Prefill ≠ tap-to-confirm, and the distinction is the whole design.**

| Interaction                                           | What it is                                                        | Verdict                          |
| ----------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| Value present in the field on load                    | A prescription recorded as a performance with **no human action** | ❌ what the V1-10 panel rejected |
| Value shown beside an **empty** field, tapped to fill | A human choosing to record the number they were given             | ✅ S1-compliant                  |

Ray's instinct — _"load can be blank or have a chip to confirm"_ — lands exactly on the second row.
Under S1 a load may be written when "a human performed it, or a readable rule derived it": a
**parent-authored prescription is a readable rule authored by a human**, and the athlete tapping it is
recording that they did what it said. The origin is the parent, never a model. This is also the shape
[ONB-1 R8](./onb-1-self-serve-onboarding-prd.md) already settled for imported loads — _"static source
beside an empty field, tap to fill, at the moment of use."_

**The one guardrail to carry over:** ONB-1's _"no 'fill all', ever"_. A single tap that fills twenty-five
loads is a tap nobody read. Per-set or per-movement confirmation, never per-session.

## 4. Ideas, ranked by (speed gained ÷ cost)

### Tier 1 — large win, low cost, no new concepts

**A. Scaffold the form from the program (V1-19, as already planned).** One tap builds a card per
prescription with the right number of blank set rows and supersets pre-grouped. **Kills all 3 typed
names and all 8 structural taps** in the 3×3 example; for Ray's real day, ~7 names and ~25 taps.
_This is the single biggest win available and it is already in the backlog._

**B. Reps prefilled where the prescription is a clean integer; blank where it is not.** From §2: 2 of 7
today, 4 of 7 after GAP-3. The discovered-rep sets (`AMRAP`, `to failure`, `8-10`) stay empty **and
get visually marked** as the ones to pay attention to — turning a limitation into the feature that
tells the athlete which set is the hard one.

**C. Load chips — tap the suggested value to fill it.** Ray's idea. One tap replaces three digits, and
it is S1-legal per §3. Where the suggestion is text (`BW`, `15-20 lb ball`, `~145-150`), the chip
fills what it can and the rest stays manual — which GAP-3's typed columns make tractable rather than
a parsing problem.

**D. "Same as previous set" inheritance.** After set 1 is entered, each new set row inherits its reps
and load, editable in place. Most sets in a straight-set scheme repeat. Cuts the 18 numeric entries to
roughly 6 plus corrections.

### Tier 2 — bigger win, needs design

**E. Log by exception — the real unlock.** If prescribed is `4×5 @ 135` and the athlete did exactly
that, the ideal interaction count is **one**. A per-movement "did it as written" that materializes the
prescribed sets as performed, with any deviation edited afterward. This is how experienced lifters
actually log.
**The tension to resolve:** it is `fill all` wearing a different hat. The honest distinction is scope
and moment — per movement, at the moment that movement finishes, with the values visible — versus a
session-wide accept at the end. **Needs a UX panel; do not ship it on this paragraph alone.**

**F. "Same as last time" instead of / alongside the prescription.** Chip the values from the last
session of this movement. Often _better_ information than the prescription — progressive overload
means the athlete is usually at or past it, and it reflects what their body actually did. Reuses the
V1-19 read path; no new data.

**G. Rep steppers instead of a keyboard.** Reps are small integers. `+`/`−` at ≥44px beats summoning a
numeric pad that covers half a phone screen. Loads keep the keypad — the range is too wide.

### Tier 3 — the real question, which is V1-21's

**H. The form is session-shaped; the athlete is set-shaped.** The current model asks for the whole
session in one form and one submit, but the athlete lives it one set at a time with 90 seconds between.
A **"current set" view** — one movement, one set, log it, rest timer, next — matches the actual
activity. Everything in Tiers 1–2 optimizes the existing shape; **this asks whether the shape is
right**, which is precisely V1-21's remit and should be answered before over-investing in the form.

**I. Voice / NL entry (AI-1).** _"Athlete One did three sets of eight pull-ups."_ Genuinely the fastest input
for the ad-hoc case with no prescription to scaffold from. Note it is **not** the fix for the
programmed case — scaffolding already reduces that to taps, and taps beat talking in a loud room.

## 5. Recommendation

1. **V1-19 (A) is the fix.** It is already planned, needs no migration, and removes the majority of the
   interactions on its own. Ship it with **B** and **C** folded in — the reps/load nuance is a small
   delta on the same work, and splitting it would touch the same file twice.
2. **D and G are cheap follow-ons** to the same form.
3. **E and H go to V1-21's design review** rather than being decided here — E because it needs the
   `fill all` boundary drawn properly, H because it may invalidate the form it would optimize.
4. **F is the sleeper.** "What you did last time" may be more useful than "what you were told to do,"
   and it costs one query.

### What this changes in V1-19's spec

V1-19 currently reads _"movement names and set STRUCTURE only. **Loads and reps stay BLANK.**"_ That
line was written when reps and loads were assumed to share a risk profile. §3 says they don't. The
revision: **loads stay blank-with-a-chip; clean-integer reps prefill; discovered reps stay blank and
get marked.** The no-authored-loads boundary is untouched — it is enforced more precisely, not relaxed.

## 6. Open questions

1. **Re-tap after a partial log** — replace, append, or disable? (Already V1-19's stated open question;
   unchanged.)
2. **Does a load chip need to record that it was tapped rather than typed?** `entries.raw_load` and the
   prescription link (GAP-1 `prescribed`) may already cover the provenance question.
3. **Is "as written" (E) acceptable at movement scope**, given ONB-1's _no fill-all, ever_?
4. **Does V1-21 make any of Tier 1–2 moot?** Sequencing risk: V1-19 is the obvious incremental fix, and
   V1-21 exists to ask whether the thing being incrementally fixed should exist.
