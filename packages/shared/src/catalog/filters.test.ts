import { describe, expect, it } from 'vitest';

import {
  EQUIPMENT_CHOICES,
  EQUIPMENT_FILTER_SHOWN_FIRST,
  filterMovementOptions,
  movementFiltersOn,
  NO_MOVEMENT_FILTERS,
  passesMovementFilters,
  type MovementFilters,
} from '../movement-filters';
import {
  equipmentFilterOrder,
  movementFilterCounts,
  searchMovementOptions,
} from '../movement-search';
import { CATALOG_FIXTURE } from './fixture';
import { catalogOptionOf } from './option';
import { EQUIPMENT, MUSCLES, type Equipment, type Muscle } from './vocabulary';

type Option = {
  readonly name: string;
  readonly isCatalog: boolean;
  readonly aliases: readonly string[];
  readonly equipment?: readonly Equipment[];
  readonly primaryMuscle?: Muscle | null;
};
const lib = (
  name: string,
  equipment: readonly Equipment[],
  primaryMuscle: Muscle | null,
  aliases: readonly string[] = [],
): Option => ({ name, isCatalog: true, aliases, equipment, primaryMuscle });
const own = (name: string): Option => ({ name, isCatalog: false, aliases: [] });

const pushUp = lib('Push-up', [], 'chest', ['Press-up']);
const incline = lib('Incline push-up', ['bench'], 'chest');
const row = lib('Dumbbell row', ['dumbbell', 'bench'], 'lats');
const curl = lib('Dumbbell curl', ['dumbbell'], 'biceps');
const pullUp = lib('Pull-up', ['pull_up_bar'], 'lats');
const plank = lib('Plank', [], 'abdominals');
const run = lib('Easy run', [], null);
const ladder = own('Push-up ladder');
const myRow = own('My row');
const ALL: readonly Option[] = [pushUp, incline, row, curl, pullUp, plank, run, ladder, myRow];

const filters = (given: Partial<MovementFilters>): MovementFilters => ({
  ...NO_MOVEMENT_FILTERS,
  ...given,
});
const NONE = filters({ equipment: 'none' });
const chosen = (...items: Equipment[]) => filters({ equipment: 'chosen', chosenEquipment: items });
const search = (query: string, given?: MovementFilters, options: readonly Option[] = ALL) =>
  searchMovementOptions(options, given ? { query, filters: given } : { query });
const names = (rows: readonly Option[]) => rows.map((option) => option.name);

describe('the filters (P7)', () => {
  it('equipment is one choice of three', () => {
    expect(EQUIPMENT_CHOICES).toEqual(['any', 'none', 'chosen']);
    expect(NO_MOVEMENT_FILTERS).toEqual({ equipment: 'any', chosenEquipment: [], muscles: [] });
    expect(EQUIPMENT_FILTER_SHOWN_FIRST).toBe(10);
  });

  it('"no equipment" keeps a movement whose set is empty, and nothing else', () => {
    const kept = ALL.filter((option) => passesMovementFilters(option, NONE));
    expect(names(kept)).toEqual(['Push-up', 'Plank', 'Easy run']);
  });

  it('🔴 chosen items keep a movement that uses AT LEAST ONE of them', () => {
    const pass = (given: MovementFilters) =>
      names(ALL.filter((option) => passesMovementFilters(option, given)));
    expect(pass(chosen('bench'))).toEqual(['Incline push-up', 'Dumbbell row']);
    expect(pass(chosen('dumbbell'))).toEqual(['Dumbbell row', 'Dumbbell curl']);
    // Ticking a second item only adds: it is "any of", never "only what I have".
    expect(pass(chosen('dumbbell', 'pull_up_bar'))).toEqual([
      'Dumbbell row',
      'Dumbbell curl',
      'Pull-up',
    ]);
    // A movement with no equipment uses none of them.
    expect(pass(chosen('bench'))).not.toContain('Push-up');
  });

  it('"chosen" with nothing ticked filters nothing', () => {
    const empty = chosen();
    expect(movementFiltersOn(empty)).toBe(0);
    expect(ALL.filter((option) => passesMovementFilters(option, empty))).toEqual(
      ALL.filter((option) => option.isCatalog),
    );
  });

  it('🔴 changing the choice clears nothing: ticked items are kept and count again', () => {
    const ticked: Equipment[] = ['bench', 'dumbbell'];
    const asAny = filters({ equipment: 'any', chosenEquipment: ticked });
    const asNone = filters({ equipment: 'none', chosenEquipment: ticked });
    const asChosen = filters({ equipment: 'chosen', chosenEquipment: ticked });
    // Kept, and not applied while another choice is selected.
    expect(movementFiltersOn(asAny)).toBe(0);
    expect(passesMovementFilters(pullUp, asAny)).toBe(true);
    expect(movementFiltersOn(asNone)).toBe(1);
    expect(passesMovementFilters(pushUp, asNone)).toBe(true);
    expect(passesMovementFilters(incline, asNone)).toBe(false);
    expect(movementFiltersOn(asChosen)).toBe(2);
    expect(passesMovementFilters(pullUp, asChosen)).toBe(false);
  });

  it('muscles filter by the PRIMARY muscle; a movement with none passes no muscle filter', () => {
    const lats = filters({ muscles: ['lats'] });
    expect(names(ALL.filter((option) => passesMovementFilters(option, lats)))).toEqual([
      'Dumbbell row',
      'Pull-up',
    ]);
    const secondary = { ...curl, secondaryMuscles: ['lats'] };
    expect(passesMovementFilters(secondary, lats)).toBe(false);
    expect(passesMovementFilters(run, lats)).toBe(false);
    expect(passesMovementFilters(run, NONE)).toBe(true);
  });

  it('different kinds together keep what passes each', () => {
    const both = filters({
      equipment: 'chosen',
      chosenEquipment: ['bench'],
      muscles: ['lats', 'biceps'],
    });
    expect(names(ALL.filter((option) => passesMovementFilters(option, both)))).toEqual([
      'Dumbbell row',
    ]);
    expect(movementFiltersOn(both)).toBe(3);
  });

  it('counts each filter once, however the lists were built', () => {
    expect(movementFiltersOn(NO_MOVEMENT_FILTERS)).toBe(0);
    expect(movementFiltersOn(chosen('bench', 'bench', 'dumbbell'))).toBe(2);
    expect(movementFiltersOn(filters({ muscles: ['lats', 'lats'] }))).toBe(1);
  });

  it('🔴 a custom item never passes a filter: it has nothing a filter could judge', () => {
    for (const given of [NONE, chosen('bench'), filters({ muscles: ['chest'] }), chosen()]) {
      expect(passesMovementFilters(ladder, given)).toBe(false);
    }
    // Even one that carries fields it should not have.
    expect(passesMovementFilters({ ...ladder, equipment: [], primaryMuscle: 'chest' }, NONE)).toBe(
      false,
    );
  });
});

describe('browsing under the filters (P9, P12)', () => {
  it('gives the library movements that fit, and the custom items apart, each in the order given', () => {
    expect(filterMovementOptions(ALL, NONE)).toEqual({
      fitting: [pushUp, plank, run],
      custom: [ladder, myRow],
    });
  });

  it('with no filter on, every library movement fits', () => {
    for (const off of [NO_MOVEMENT_FILTERS, chosen()]) {
      expect(filterMovementOptions(ALL, off)).toEqual({
        fitting: ALL.filter((option) => option.isCatalog),
        custom: [ladder, myRow],
      });
    }
  });

  it('lists an option once', () => {
    const twice = filterMovementOptions([pushUp, ladder, pushUp, ladder], NONE);
    expect(twice).toEqual({ fitting: [pushUp], custom: [ladder] });
  });
});

describe('searching under the filters (P7 to P10)', () => {
  it('with no filter on, nothing changes and nothing is set apart', () => {
    for (const query of ['push', 'dumbell', 'row zzzz', 'incline push-up', '', 'zzzz']) {
      const plain = search(query);
      expect(plain).toMatchObject({ custom: [], hitsOutsideFilters: [], outsideFilters: 0 });
      for (const off of [NO_MOVEMENT_FILTERS, chosen(), filters({ chosenEquipment: ['bench'] })]) {
        expect(search(query, off), query).toEqual(plain);
      }
    }
    // A custom item sits among the matches like any row.
    expect(names(search('push').matches)).toEqual(['Push-up', 'Push-up ladder', 'Incline push-up']);
  });

  it('🔴 removes what does not pass, counts it, and never reorders', () => {
    const found = search('push', NONE);
    expect(names(found.matches)).toEqual(['Push-up']);
    expect(names(found.custom)).toEqual(['Push-up ladder']);
    expect(found.outsideFilters).toBe(1);
    const dumbbells = search('dumbbell', chosen('bench'));
    expect(names(dumbbells.matches)).toEqual(['Dumbbell row']);
    expect(dumbbells.outsideFilters).toBe(1);
    expect(dumbbells.custom).toEqual([]);
  });

  it('🔴 a hit is listed first whatever the filters, and marked when it is outside them (P8)', () => {
    // An exact name.
    const exact = search('incline push-up', NONE);
    expect(exact.exact).toBe(true);
    expect(exact.hits).toEqual([incline]);
    expect(exact.matches[0]).toBe(incline);
    expect(exact.hitsOutsideFilters).toEqual([incline]);
    expect(exact.outsideFilters).toBe(0);
    // An exact alias.
    const alias = search('press up', chosen('bench'));
    expect(alias.aliasHit).toBe('Press-up');
    expect(alias.matches).toEqual([pushUp]);
    expect(alias.hitsOutsideFilters).toEqual([pushUp]);
    // The movement a short form spells.
    const short = search('db row', NONE);
    expect(short.shortFormHit).toBe(row);
    expect(short.matches).toEqual([row]);
    expect(short.hitsOutsideFilters).toEqual([row]);
    // A hit inside the filters is first and not marked.
    const inside = search('push-up', NONE);
    expect(inside.matches[0]).toBe(pushUp);
    expect(inside.hitsOutsideFilters).toEqual([]);
  });

  it('a custom item that is the hit stays first and is not called "outside the filters"', () => {
    const found = search('my row', NONE);
    expect(found.hits).toEqual([myRow]);
    expect(found.matches).toEqual([myRow]);
    expect(found.hitsOutsideFilters).toEqual([]);
    expect(found.custom).toEqual([]);
  });

  it('two hits (a household name that is also a library alias) are both first, in order', () => {
    const stray = own('Press up');
    const found = search('press-up', NONE, [...ALL, stray]);
    expect(found.hits).toEqual([stray, pushUp]);
    expect(found.matches.slice(0, 2)).toEqual([stray, pushUp]);
    expect(found.hitsOutsideFilters).toEqual([]);
    expect(search('press-up', chosen('bench'), [...ALL, stray]).hitsOutsideFilters).toEqual([
      pushUp,
    ]);
  });

  it('🔴 custom items the query finds are set apart, never dropped and never judged (P9)', () => {
    const found = search('row', chosen('pull_up_bar'));
    expect(found.matches).toEqual([]);
    expect(found.custom).toEqual([myRow]);
    expect(found.outsideFilters).toBe(1);
    // A custom near miss and a custom some-words row are set apart too, in that order.
    const near = search('laddr', NONE);
    expect(near.matches).toEqual([]);
    expect(near.near).toEqual([]);
    expect(near.custom).toEqual([ladder]);
    expect(names(search('laddr').near)).toEqual(['Push-up ladder']);
    const some = search('ladder zzzz', NONE);
    expect(some.someWords).toEqual([]);
    expect(some.custom).toEqual([ladder]);
  });

  it('near misses and some-words rows are filtered like matches, and counted (P10)', () => {
    expect(names(search('dumbell').near)).toEqual(['Dumbbell curl', 'Dumbbell row']);
    const near = search('dumbell', filters({ muscles: ['biceps'] }));
    expect(names(near.near)).toEqual(['Dumbbell curl']);
    expect(near.outsideFilters).toBe(1);
    const some = search('dumbbell zzzz', filters({ muscles: ['biceps'] }));
    expect(names(some.someWords)).toEqual(['Dumbbell curl']);
    expect(some.outsideFilters).toBe(1);
  });

  it('when rows were found and none passes, it says how many and falls back to nothing (P10)', () => {
    const found = search('curl', NONE);
    expect(found).toMatchObject({ matches: [], near: [], someWords: [], custom: [] });
    expect(found.outsideFilters).toBe(1);
    // With no match at all there is nothing outside the filters either.
    expect(search('zzzz', NONE).outsideFilters).toBe(0);
  });

  it('under a short form, the some-words rows are the typed words’ first, then the expanded words’', () => {
    const rowing = lib('Rowing machine', ['rowing_machine'], null);
    const options = [curl, rowing, lib('Dumbbell fly', ['dumbbell'], 'chest')];
    // Nothing holds all of "db rowing zzz". "rowing" is a typed word; "dumbbell" is what `db` means.
    const found = search('db rowing zzz', undefined, options);
    expect(found.matches).toEqual([]);
    expect(names(found.someWords)).toEqual(['Rowing machine', 'Dumbbell curl', 'Dumbbell fly']);
    expect(names(search('db rowing zzz', chosen('dumbbell'), options).someWords)).toEqual([
      'Dumbbell curl',
      'Dumbbell fly',
    ]);
  });

  it('a row offered as a close spelling is not offered again for one of its words (P5)', () => {
    const options = [lib('Kettlebell swing', ['kettlebell'], 'glutes'), lib('Swing set', [], null)];
    const found = search('kettelbell swing', undefined, options);
    expect(names(found.near)).toEqual(['Kettlebell swing']);
    expect(names(found.someWords)).toEqual(['Swing set']);
  });
});

describe('the same search, over the test library (properties)', () => {
  const options: Option[] = [
    ...CATALOG_FIXTURE.map((entry, index) => ({
      ...catalogOptionOf(entry, `id-${index}`),
      isCatalog: true,
    })),
    own('Dumbbell complex'),
    own('Garage carry'),
    own('RDL'),
  ];
  const queries = [
    ...CATALOG_FIXTURE.flatMap((entry) => [entry.name, entry.name.slice(0, 4), ...entry.aliases]),
    ...['db', 'db row', 'row', 'press', 'dumbell', 'carry zzzz', 'rdl', 'garage', 'zzzz', 'squta'],
  ];
  const settings: MovementFilters[] = [
    NONE,
    chosen('dumbbell'),
    chosen('bench', 'rowing_machine'),
    filters({ muscles: ['chest', 'quadriceps'] }),
    filters({ equipment: 'none', muscles: ['obliques'] }),
    filters({ equipment: 'chosen', chosenEquipment: ['dumbbell'], muscles: ['lats'] }),
    // Items stay ticked while another equipment choice is on: `equipmentChosen` counts them.
    filters({ equipment: 'none', chosenEquipment: ['bench'] }),
    filters({ equipment: 'any', chosenEquipment: ['dumbbell'], muscles: ['lats'] }),
  ];
  const isSubsequence = <T>(part: readonly T[], whole: readonly T[]) => {
    let at = 0;
    for (const item of whole) if (item === part[at]) at += 1;
    return at === part.length;
  };

  it('🔴 every row the query found is shown, set apart or counted: exactly one of the three', () => {
    let checked = 0;
    for (const query of queries) {
      const plain = searchMovementOptions(options, { query });
      const beyondHits = plain.matches.filter((option) => !plain.hits.includes(option));
      const found = [...new Set([...beyondHits, ...plain.near, ...plain.someWords])];
      for (const given of settings) {
        const under = searchMovementOptions(options, { query, filters: given });
        const label = `${query} ${JSON.stringify(given)}`;
        // What the filters cannot change.
        expect(
          [under.exact, under.aliasHit, under.shortFormHit, under.hits, under.foundByAlias],
          label,
        ).toEqual([
          plain.exact,
          plain.aliasHit,
          plain.shortFormHit,
          plain.hits,
          plain.foundByAlias,
        ]);
        // Hits first; the rest in the unfiltered order.
        expect(under.matches.slice(0, plain.hits.length), label).toEqual(plain.hits);
        expect(isSubsequence(under.matches, plain.matches), label).toBe(true);
        expect(isSubsequence(under.near, plain.near), label).toBe(true);
        expect(isSubsequence(under.someWords, plain.someWords), label).toBe(true);
        // The partition.
        const shown = [
          ...under.matches.slice(plain.hits.length),
          ...under.near,
          ...under.someWords,
        ];
        for (const option of shown) {
          expect(option.isCatalog && passesMovementFilters(option, given), label).toBe(true);
        }
        expect(under.custom, label).toEqual(found.filter((option) => !option.isCatalog));
        expect(new Set([...shown, ...under.custom]).size, label).toBe(
          shown.length + under.custom.length,
        );
        expect(shown.length + under.custom.length + under.outsideFilters, label).toBe(found.length);
        expect(under.hitsOutsideFilters, label).toEqual(
          plain.hits.filter((option) => option.isCatalog && !passesMovementFilters(option, given)),
        );
        expect(
          under.near.filter((option) => under.someWords.includes(option)),
          label,
        ).toEqual([]);
        // Enter: a hit, or a row that matched (never one only offered), and never by an alias.
        if (plain.hits[0]) expect(under.enterTarget, label).toBe(plain.hits[0]);
        else if (under.enterTarget !== null) {
          expect(plain.matches, label).toContain(under.enterTarget);
          expect(plain.foundByAlias.has(under.enterTarget), label).toBe(false);
        }
        if (plain.matches.length === 0) expect(under.enterTarget, label).toBeNull();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('the counts beside each choice are what ticking it alone would find', () => {
    for (const query of ['', 'row', 'dumbell', 'db', 'rdl', 'press']) {
      for (const given of [NO_MOVEMENT_FILTERS, ...settings]) {
        const counts = movementFilterCounts(options, { query, filters: given });
        // What the list would show: with a query every list of the result; with none, the
        // library movements that fit.
        const shownUnder = (other: MovementFilters) => {
          if (query === '') return filterMovementOptions(options, other).fitting.length;
          const under = searchMovementOptions(options, { query, filters: other });
          return (
            under.matches.length + under.custom.length + under.near.length + under.someWords.length
          );
        };
        const label = `${query} ${JSON.stringify(given)}`;
        expect(counts.total, label).toBe(shownUnder(given));
        expect(counts.equipmentAny, label).toBe(shownUnder({ ...given, equipment: 'any' }));
        expect(counts.equipmentNone, label).toBe(shownUnder({ ...given, equipment: 'none' }));
        expect(counts.equipmentChosen, label).toBe(shownUnder({ ...given, equipment: 'chosen' }));
        expect([...counts.equipment.keys()], label).toEqual([...EQUIPMENT]);
        expect([...counts.muscles.keys()], label).toEqual([...MUSCLES]);
        for (const item of ['dumbbell', 'bench', 'rowing_machine', 'pool'] as const) {
          expect(counts.equipment.get(item), `${label} ${item}`).toBe(
            shownUnder({ ...given, equipment: 'chosen', chosenEquipment: [item] }),
          );
        }
        for (const muscle of ['chest', 'lats', 'shins'] as const) {
          expect(counts.muscles.get(muscle), `${label} ${muscle}`).toBe(
            shownUnder({ ...given, muscles: [muscle] }),
          );
        }
      }
    }
  });
});

describe('the counts in the panel (P7)', () => {
  it('🔴 a choice that would find nothing counts zero: the panel greys it', () => {
    const browsing = movementFilterCounts(ALL, { query: '', filters: NO_MOVEMENT_FILTERS });
    expect(browsing.total).toBe(7);
    expect(browsing.equipmentNone).toBe(3);
    expect(browsing.equipment.get('bench')).toBe(2);
    expect(browsing.equipment.get('kettlebell')).toBe(0);
    expect(browsing.muscles.get('lats')).toBe(2);
    expect(browsing.muscles.get('shins')).toBe(0);
  });

  it('🔴 gives each of the three equipment choices its number, from one call', () => {
    const browsing = movementFilterCounts(ALL, { query: '', filters: NO_MOVEMENT_FILTERS });
    expect(browsing.equipmentAny).toBe(7);
    // "Uses at least one of…" with nothing ticked filters nothing.
    expect(browsing.equipmentChosen).toBe(7);
    // "No equipment" is on and Bench is still ticked from before: each choice says what it would show.
    const none = movementFilterCounts(ALL, {
      query: '',
      filters: filters({ equipment: 'none', chosenEquipment: ['bench'] }),
    });
    expect(none.total).toBe(3);
    expect(none.equipmentNone).toBe(3);
    expect(none.equipmentAny).toBe(7);
    expect(none.equipmentChosen).toBe(2);
    // The muscles stay as they are under every one of the three.
    const lats = movementFilterCounts(ALL, {
      query: '',
      filters: filters({ equipment: 'none', chosenEquipment: ['dumbbell'], muscles: ['lats'] }),
    });
    expect(lats.equipmentAny).toBe(2);
    expect(lats.equipmentNone).toBe(0);
    expect(lats.equipmentChosen).toBe(1);
  });

  it('counts under the other kind’s filters, and under the query', () => {
    const benchOnly = movementFilterCounts(ALL, { query: '', filters: chosen('bench') });
    expect(benchOnly.total).toBe(2);
    expect(benchOnly.muscles.get('lats')).toBe(1);
    expect(benchOnly.muscles.get('biceps')).toBe(0);
    // A count for an equipment item replaces the ticked items; the muscles stay.
    const lats = movementFilterCounts(ALL, { query: '', filters: filters({ muscles: ['lats'] }) });
    expect(lats.equipment.get('dumbbell')).toBe(1);
    expect(lats.equipmentNone).toBe(0);
    // "push" finds Push-up, Incline push-up and the custom Push-up ladder, which is always shown.
    const typed = movementFilterCounts(ALL, { query: 'push', filters: NO_MOVEMENT_FILTERS });
    expect(typed.total).toBe(3);
    expect(typed.equipment.get('bench')).toBe(2);
    expect(typed.equipment.get('dumbbell')).toBe(1);
    // A query that finds library rows only can grey a choice.
    const curls = movementFilterCounts(ALL, { query: 'curl', filters: NO_MOVEMENT_FILTERS });
    expect(curls.total).toBe(1);
    expect(curls.equipment.get('bench')).toBe(0);
    expect(curls.equipmentNone).toBe(0);
  });

  it('🔴 counts what is shown whatever the filters: a hit and the custom items the query found', () => {
    // An exact name is typed: every choice still leaves that row, so nothing greys.
    const hit = movementFilterCounts(ALL, {
      query: 'incline push-up',
      filters: NO_MOVEMENT_FILTERS,
    });
    expect(hit.total).toBe(1);
    expect(hit.equipmentNone).toBe(1);
    expect(hit.equipment.get('kettlebell')).toBe(1);
    expect(hit.muscles.get('shins')).toBe(1);
    // "row" finds Dumbbell row and the custom My row: chest leaves My row on the screen.
    const rows = movementFilterCounts(ALL, { query: 'row', filters: NO_MOVEMENT_FILTERS });
    expect(rows.total).toBe(2);
    expect(rows.muscles.get('chest')).toBe(1);
    expect(rows.muscles.get('lats')).toBe(2);
    expect(search('row', filters({ muscles: ['chest'] })).custom).toEqual([myRow]);
    // With no query the custom items are their own section and are not in the number.
    expect(movementFilterCounts(ALL, { query: '', filters: NONE }).total).toBe(3);
  });

  it('a library row whose taxonomy was not read passes no filter, and is counted outside them', () => {
    const bare: Option = { name: 'Push press', isCatalog: true, aliases: [] };
    for (const given of [NONE, chosen('bench'), filters({ muscles: ['chest'] })]) {
      expect(passesMovementFilters(bare, given)).toBe(false);
    }
    const found = search('push', NONE, [pushUp, bare]);
    expect(found.matches).toEqual([pushUp]);
    expect(found.outsideFilters).toBe(1);
    expect(found.custom).toEqual([]);
    // With no filter on it is a row like any other.
    expect(search('push', undefined, [pushUp, bare]).matches).toEqual([pushUp, bare]);
  });

  it('lists equipment by how many movements each would leave, most first; zero last (P7)', () => {
    const counts = movementFilterCounts(ALL, { query: '', filters: NO_MOVEMENT_FILTERS });
    const order = equipmentFilterOrder(counts);
    expect([...order].sort()).toEqual([...EQUIPMENT].sort());
    // bench 2 and dumbbell 2 (the vocabulary's order between them), pull-up bar 1, then the unused.
    const used = order.filter((item) => (counts.equipment.get(item) ?? 0) > 0);
    expect(used).toEqual(
      EQUIPMENT.indexOf('bench') < EQUIPMENT.indexOf('dumbbell')
        ? ['bench', 'dumbbell', 'pull_up_bar']
        : ['dumbbell', 'bench', 'pull_up_bar'],
    );
    expect(order.slice(0, used.length)).toEqual(used);
    expect(order.slice(used.length)).toEqual(EQUIPMENT.filter((item) => !used.includes(item)));
    expect(order.slice(0, EQUIPMENT_FILTER_SHOWN_FIRST)).toHaveLength(10);
  });
});

describe('what Enter picks (P5)', () => {
  it('a hit, whatever else matched and whatever the filters', () => {
    expect(search('push-up').enterTarget).toBe(pushUp);
    expect(search('incline push-up', NONE).enterTarget).toBe(incline);
    expect(search('db row', NONE).enterTarget).toBe(row);
  });

  it('the only match, when it was found by its own name or through a short form', () => {
    expect(search('plan').enterTarget).toBe(plank);
    expect(search('db', undefined, [row, plank]).enterTarget).toBe(row);
    expect(search('push', NONE, [pushUp, incline]).enterTarget).toBe(pushUp);
    expect(search('push', undefined, [pushUp, incline]).enterTarget).toBeNull();
  });

  it('🔴 never a row found by another name, a close spelling or a some-words row', () => {
    const alias = search('press-u', undefined, [pushUp, plank]);
    expect(alias.matches).toEqual([pushUp]);
    expect(alias.enterTarget).toBeNull();
    for (const query of ['plnak', 'plank zzzz', 'zzzz', '']) {
      expect(search(query).enterTarget, query).toBeNull();
    }
  });

  it('nothing when there are two to choose from, counting custom matches set apart', () => {
    expect(search('push').enterTarget).toBeNull();
    // One filtered match and one custom match: two rows on the screen.
    expect(search('push', NONE).enterTarget).toBeNull();
    // A lone custom item that MATCHED is the only row, under a filter as without one.
    expect(search('ladder', NONE).enterTarget).toBe(ladder);
    expect(search('ladder').enterTarget).toBe(ladder);
  });

  it('🔴 a filter never turns an offer into what Enter picks', () => {
    // A custom item found as a close spelling, or by one of its words, is set apart under a
    // filter and is still only an offer.
    for (const query of ['laddr', 'ladder zzzz']) {
      expect(search(query).enterTarget, query).toBeNull();
      const under = search(query, NONE);
      expect(under.custom, query).toEqual([ladder]);
      expect(under.enterTarget, query).toBeNull();
    }
    // A library near miss that passes the filters is an offer too.
    expect(search('plnak', NONE).near).toEqual([plank]);
    expect(search('plnak', NONE).enterTarget).toBeNull();
  });
});
