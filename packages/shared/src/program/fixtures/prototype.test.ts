import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FIXTURE_ITEM_KEYS } from './ids';
import { FIXTURE_SWITCH_DAY, FIXTURE_TODAY, seedWorld, type ProtoWorld } from './world';

/**
 * `./world` is a transcription of the accepted prototype, and a transcription can be wrong in one
 * number without any fixture noticing. So this reads the prototype itself
 * (`docs/prototypes/beta-0/index.html`), runs ITS data functions, and requires `seedWorld()` to
 * equal what they return: every item, prescription, instruction, label, week slot, assignment and
 * logged value.
 *
 * It also fails when the prototype's data changes, which is the point: the fixtures are the
 * accepted prototype's data, so a new prototype version means re-transcribing, not drifting.
 *
 * The prototype's script is one closure, so its functions are lifted out by name and evaluated on
 * their own. They are pure data builders: no DOM, no storage, no clock.
 */

const html = readFileSync(
  fileURLToPath(new URL('../../../../../docs/prototypes/beta-0/index.html', import.meta.url)),
  'utf8',
);

/** The source of `function <name>(…) { … }`, found by matching its braces. */
function functionSource(name: string): string {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`the prototype has no function ${name}`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`function ${name} never closes`);
}

function declared(name: string): string {
  const match = new RegExp(`\\b${name} = '(\\d{4}-\\d{2}-\\d{2})'`).exec(html);
  if (!match?.[1]) throw new Error(`the prototype does not declare ${name}`);
  return match[1];
}

type PrototypeState = {
  day: string;
  athletes: Array<{ id: string; name: string }>;
  catalog: Record<string, { name: string; type: string }>;
  programs: Array<{
    id: string;
    name: string;
    workouts: Array<{ items: Array<{ iid: string; cat: string }> } & Record<string, unknown>>;
    week: unknown;
  }>;
  assign: unknown;
  entries: Array<{
    id: string;
    cat: string;
    ath: string;
    day: string;
    slot: string;
    wid: string;
    iid: string;
    set: number;
    v: unknown;
  }>;
};

const today = declared('TODAY');
const switchDay = declared('SWITCH');
const DATA_FUNCTIONS = [
  'baseCatalog',
  'mk',
  'baseProgram',
  'every',
  'stretchProgram',
  'adultProgram',
  'seed',
];
const prototype = new Function(
  `var TODAY = ${JSON.stringify(today)}, SWITCH = ${JSON.stringify(switchDay)};
   ${DATA_FUNCTIONS.map(functionSource).join('\n')}
   return seed();`,
)() as PrototypeState;

/** The prototype's two type names that the contract spells differently. */
const TYPE_NAME: Record<string, string> = { weight: 'weight_reps', timeset: 'time_sets' };

/** The prototype's seed, in `./world`'s shape: the same data, with nothing chosen or rounded. */
function asWorld(state: PrototypeState): unknown {
  return {
    today: state.day,
    athletes: state.athletes.map(({ id, name }) => ({ id, name })),
    catalog: Object.fromEntries(
      Object.entries(state.catalog).map(([key, { name, type }]) => [
        key,
        { name, type: TYPE_NAME[type] ?? type },
      ]),
    ),
    programs: state.programs.map((program) => ({
      ...program,
      // An item's `cat` (its catalog key) is its `iid` throughout the seed; `./world` keeps one.
      workouts: program.workouts.map((workout) => ({
        ...workout,
        items: workout.items.map(({ cat: _cat, ...item }) => item),
      })),
    })),
    assign: state.assign,
    // Workout rows only: the Bodyweight and Life entries are lane S's. The number is the entry's own.
    entries: state.entries
      .filter((entry) => entry.cat === 'row')
      .map(({ id, ath, day, slot, wid, iid, set, v }) => ({
        n: Number(id.slice(1)),
        ath,
        day,
        prog: slot.slice(0, slot.indexOf('_')),
        wid,
        iid,
        set,
        v,
      })),
  };
}

describe('the fixture world is the accepted prototype’s data', () => {
  it('reads the prototype it was transcribed from', () => {
    expect(html).toContain("var KEY = 'matplan-beta0-proto-v12'");
    expect(prototype.entries.length).toBeGreaterThan(50);
    expect(prototype.programs).toHaveLength(3);
  });

  it('stands on the prototype’s calendar', () => {
    expect(FIXTURE_TODAY).toBe(today);
    expect(FIXTURE_SWITCH_DAY).toBe(switchDay);
  });

  it('equals the prototype’s seed: every item, prescription, slot, assignment and logged row', () => {
    const world: ProtoWorld = seedWorld();
    expect(world).toEqual(asWorld(prototype));
  });

  it('keys items as the prototype’s catalog does, in its order', () => {
    expect([...FIXTURE_ITEM_KEYS]).toEqual(Object.keys(prototype.catalog));
    for (const program of prototype.programs) {
      for (const item of program.workouts.flatMap((workout) => workout.items)) {
        expect(item.cat).toBe(item.iid);
      }
    }
  });

  it('numbers entries as the prototype does, skipping the two that are not workout rows', () => {
    const others = prototype.entries.filter((entry) => entry.cat !== 'row').map((e) => e.id);
    expect(others).toEqual(['e48', 'e63']);
    const numbers = new Set(seedWorld().entries.map((entry) => entry.n));
    expect(numbers.has(48) || numbers.has(63)).toBe(false);
    expect(numbers.size).toBe(prototype.entries.length - others.length);
  });
});
