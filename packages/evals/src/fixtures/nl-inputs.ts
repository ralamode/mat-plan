import type { PendingFixture } from '../harness';

/**
 * The fifteen natural-language inputs, with their expected outputs **deliberately unbound**.
 *
 * [EVAL-0](../../../../docs/plans/eval-0-gate-before-model.md) splits this fixture in two along a
 * dependency line: the sentences are durable, because a parent types them regardless of what schema
 * stores the result, while what they should extract into depends on the typed measurement columns.
 * So the sentences land now, reviewed on their own, and EVAL-1 binds the expectations.
 *
 * Writing them now is not busywork. A fixture authored beside the model it grades is a fixture
 * written to be passable; one authored before the model exists is written to describe what a parent
 * actually types. Several of these are awkward on purpose — a correction mid-sentence, a missing
 * unit, a set count stated two different ways — because those are the inputs that decide whether the
 * extraction is usable, and they are exactly the ones nobody adds later.
 *
 * ⚠️ **Synthetic by requirement.** This repo is public and the app holds minors' data. Every name
 * here is invented and every number is made up; `SYNTH-1` generalises that rule into a generator.
 */
export const nlInputFixtures: PendingFixture[] = [
  {
    id: 'nl-01-simple-three-sets',
    input: 'Athlete One did three sets of eight at 75 pounds on back squat',
    assertion: 'three sets, eight reps each, magnitude 75, unit pounds, movement back squat',
  },
  {
    id: 'nl-02-shorthand-notation',
    input: '3x8 @ 75 back squat',
    assertion: 'the shorthand reads identically to nl-01',
  },
  {
    id: 'nl-03-descending-reps',
    input: 'pull-ups, ten then ten then eight',
    assertion: 'three sets with a per-set reps array of [10, 10, 8], no magnitude',
  },
  {
    id: 'nl-04-bodyweight-no-load',
    input: 'twelve push-ups bodyweight',
    assertion: 'one set, twelve reps, bodyweight mode, no magnitude',
  },
  {
    id: 'nl-05-weighted-bodyweight',
    input: 'chin-ups with an eight pound vest, six reps',
    assertion: 'bodyweight mode AND a magnitude of 8 — the two are not exclusive',
  },
  {
    id: 'nl-06-correction-midsentence',
    input: 'ten, no wait, nine reps on the last set',
    assertion: 'the correction wins; the final set carries nine, not ten, and not both',
  },
  {
    id: 'nl-07-missing-unit',
    input: 'deadlift 5x5 at 135',
    assertion: 'magnitude 135 with the unit left unresolved rather than guessed',
  },
  {
    id: 'nl-08-decimal-magnitude',
    input: 'he did 62.5 kilos for five',
    assertion: 'a decimal magnitude survives, unit kilograms',
  },
  {
    id: 'nl-09-two-movements-one-sentence',
    input: 'squats 3x8 at 95 then lunges 3x10 bodyweight',
    assertion: 'two movements, each with its own sets; neither inherits the other’s load',
  },
  {
    id: 'nl-10-band-no-magnitude',
    input: 'banded face pulls, fifteen',
    assertion: 'band mode, fifteen reps, no magnitude',
  },
  {
    id: 'nl-11-sub-failure',
    input: 'went for eight on the last set but only got six',
    assertion: 'six reps recorded with sub-failure status, not eight',
  },
  {
    id: 'nl-12-skipped-movement',
    input: 'skipped the cleans today, shoulder was sore',
    assertion: 'no set rows for cleans — a movement that did not happen carries zero sets',
  },
  {
    id: 'nl-13-prescription-not-performance',
    input: 'Athlete One is supposed to squat 3x8 at 95 next week',
    assertion:
      '⚠️ the extraction carries NO magnitude. This sentence states a prescription, and the invariant class owns what happens if one is emitted anyway',
  },
  {
    id: 'nl-14-range-in-prose',
    input: 'he worked up to something like 75 to 85 on squat',
    assertion:
      '⚠️ a range is not a performed value; no magnitude is extracted rather than picking an end or averaging',
  },
  {
    id: 'nl-15-relative-to-max',
    input: 'bench at 95 percent of his max for a triple',
    assertion:
      '⚠️ a percentage of max is a prescription idiom; three reps extract, the magnitude does not',
  },
];
