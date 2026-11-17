import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MOVEMENT_SEED_ROWS } from '../catalog-movements';
import { movementNameKey } from '../movement-search';
import { MOVEMENT_PATTERNS, movementSlug, TRACKING_TYPES } from '../movements';
import { code, reachedFrom, SRC } from '../test-support/source-graph';
import {
  approvalIssues,
  entryHash,
  lockfileIssues,
  type ApprovedFile,
  type ShippedFile,
} from './approvals';
import { CATALOG_MOVEMENTS, CATALOG_SLUGS } from './data';
import { catalogMovementSchema, requiresNoEquipment, type CatalogMovement } from './entry';
import { CATALOG_FIXTURE, CATALOG_FIXTURE_IDS } from './fixture';
import {
  EQUIPMENT,
  EQUIPMENT_LABELS,
  MODALITIES,
  MODALITY_LABELS,
  MUSCLE_LABELS,
  MUSCLES,
  QUERY_SHORT_FORMS,
  SUPERVISION,
  SUPERVISION_LABELS,
} from './vocabulary';

/**
 * CAT-3's contract, chunk C0a (docs/specs/cat-3-movement-library.md): criteria V1 to V6, D2 and
 * D3, and what `CATALOG_FIXTURE` promises to cover.
 */

const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(SRC, 'catalog/data', name), 'utf8')) as T;
const SHIPPED = readJson<ShippedFile>('shipped.json');
const APPROVED = readJson<ApprovedFile>('approved.json');

const [first] = CATALOG_FIXTURE;
if (!first) throw new Error('CATALOG_FIXTURE is empty');
/** A valid strength entry to change one field of. */
const base: CatalogMovement = { ...first };
const accepts = (entry: unknown) => catalogMovementSchema.safeParse(entry).success;

describe('the vocabularies (V1)', () => {
  const LISTS = { EQUIPMENT, MUSCLES, MODALITIES, SUPERVISION } as const;

  it.each(Object.entries(LISTS))('%s holds lower-case codes, none twice', (_, list) => {
    expect(new Set<string>(list).size).toBe(list.length);
    for (const value of list) expect(value).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('labels every member, and no two members of a list alike', () => {
    const labelled = [
      [EQUIPMENT, EQUIPMENT_LABELS],
      [MUSCLES, MUSCLE_LABELS],
      [MODALITIES, MODALITY_LABELS],
      [SUPERVISION, SUPERVISION_LABELS],
    ] as const;
    for (const [list, labels] of labelled) {
      expect(Object.keys(labels).sort()).toEqual([...list].sort());
      const words = Object.values(labels);
      expect(new Set(words).size).toBe(words.length);
    }
  });

  it('has no "none" among the supervision values: an unmarked entry makes no claim (K14)', () => {
    expect([...SUPERVISION]).toEqual(['coach']);
  });

  it('expands a short form to words the search folds, and to nothing else', () => {
    for (const [short, long] of Object.entries(QUERY_SHORT_FORMS)) {
      expect(short).toMatch(/^[a-z]{2,4}$/);
      expect(long).toMatch(/^[a-z]+( [a-z]+)*$/);
      expect(movementNameKey(long)).not.toBe(movementNameKey(short));
    }
  });

  it('leaves the lift patterns as they were: modality is a second axis, not new patterns', () => {
    expect(MOVEMENT_PATTERNS).toHaveLength(11);
    expect([...MOVEMENT_PATTERNS]).not.toContain('conditioning');
  });
});

describe('one entry (V2)', () => {
  it('accepts every fixture entry, unchanged by the parse', () => {
    for (const entry of CATALOG_FIXTURE) {
      expect(catalogMovementSchema.parse(entry), entry.slug).toEqual(entry);
    }
  });

  it('🔴 is strict and has no id: a public id, a source or any other key is refused', () => {
    expect(accepts(base)).toBe(true);
    expect(accepts({ ...base, publicId: CATALOG_FIXTURE_IDS[base.slug] })).toBe(false);
    expect(accepts({ ...base, source: 'anywhere' })).toBe(false);
    expect(accepts({ ...base, noEquipment: true })).toBe(false);
  });

  it('🔴 refuses a name the CSV export could not print', () => {
    // The export prints a movement's slug; a comma or a line break there fails the whole month.
    expect(accepts({ ...base, name: 'Squat, goblet', slug: movementSlug('Squat, goblet') })).toBe(
      false,
    );
    expect(accepts({ ...base, name: 'Goblet\nsquat', slug: movementSlug('Goblet\nsquat') })).toBe(
      false,
    );
    expect(accepts({ ...base, name: '   ', slug: 'x' })).toBe(false);
  });

  it('holds the slug to the name or to an alias, so a corrected name keeps its row', () => {
    expect(base.slug).toBe(movementSlug(base.name));
    expect(accepts({ ...base, slug: 'something_else' })).toBe(false);
    // A rename: the slug stays, the old name becomes an alias.
    const renamed = { ...base, name: 'Goblet squat (dumbbell)', aliases: [base.name] };
    expect(renamed.slug).not.toBe(movementSlug(renamed.name));
    expect(accepts(renamed)).toBe(true);
    // The same rename with the old name dropped is refused.
    expect(accepts({ ...renamed, aliases: [] })).toBe(false);
  });

  it('needs a pattern and a primary muscle for strength, and neither for anything else', () => {
    expect(accepts({ ...base, pattern: null })).toBe(false);
    expect(accepts({ ...base, primaryMuscle: null })).toBe(false);
    const run = { ...base, modality: 'conditioning', pattern: null, primaryMuscle: null };
    expect(accepts({ ...run, secondaryMuscles: [] })).toBe(true);
  });

  it('refuses a primary muscle among the secondaries, and any member twice', () => {
    expect(accepts({ ...base, secondaryMuscles: [base.primaryMuscle] })).toBe(false);
    expect(accepts({ ...base, equipment: ['dumbbell', 'dumbbell'] })).toBe(false);
    expect(accepts({ ...base, aliases: ['Cup squat', 'Cup squat'] })).toBe(false);
    expect(accepts({ ...base, secondaryMuscles: ['glutes', 'glutes'] })).toBe(false);
  });

  it('takes a supervision value from the list, or none', () => {
    expect(accepts({ ...base, supervision: 'coach' })).toBe(true);
    expect(accepts({ ...base, supervision: 'none' })).toBe(false);
    expect(accepts({ ...base, supervision: null })).toBe(false);
  });

  it('takes words from the vocabularies only', () => {
    expect(accepts({ ...base, equipment: ['kettle'] })).toBe(false);
    expect(accepts({ ...base, primaryMuscle: 'core' })).toBe(false);
    expect(accepts({ ...base, modality: 'cardio' })).toBe(false);
    expect(accepts({ ...base, trackingType: 'weight' })).toBe(false);
  });
});

/** V3, for one list: no slug twice, and no name or alias sharing a key with another entry's. */
function collisions(entries: readonly CatalogMovement[]): string[] {
  const seen = new Map<string, string>();
  const found: string[] = [];
  const claim = (key: string, owner: string) => {
    const other = seen.get(key);
    if (other !== undefined && other !== owner) found.push(`${key}: ${other} and ${owner}`);
    seen.set(key, owner);
  };
  const slugs = entries.map((entry) => entry.slug);
  for (const slug of slugs) {
    if (slugs.indexOf(slug) !== slugs.lastIndexOf(slug)) found.push(`slug twice: ${slug}`);
  }
  for (const entry of entries) {
    for (const name of [entry.name, ...entry.aliases]) claim(movementNameKey(name), entry.slug);
  }
  return [...new Set(found)];
}

describe.each([
  ['CATALOG_FIXTURE', CATALOG_FIXTURE],
  ['CATALOG_MOVEMENTS', CATALOG_MOVEMENTS],
])('%s as a whole (V3, D2)', (_, entries) => {
  it('parses, entry by entry', () => {
    for (const entry of entries) expect(accepts(entry), entry.slug).toBe(true);
  });

  it('has no slug twice and no name or alias that reads as another entry', () => {
    expect(collisions(entries)).toEqual([]);
  });

  it('has no alias that is an equipment short form', () => {
    const short = new Set(Object.keys(QUERY_SHORT_FORMS).map(movementNameKey));
    const offending = entries.flatMap((entry) =>
      entry.aliases.filter((alias) => short.has(movementNameKey(alias))),
    );
    expect(offending).toEqual([]);
  });
});

describe('the collision check itself', () => {
  it('sees a shared slug, a shared name key and an alias that is another entry’s name', () => {
    const other = { ...base, slug: 'cup_squat', name: 'Cup squat' };
    expect(collisions([base, other])).toEqual([]);
    expect(collisions([base, { ...base }])).not.toEqual([]);
    expect(
      collisions([base, { ...other, name: 'GOBLET  squats', aliases: ['Cup squat'] }]),
    ).not.toEqual([]);
    expect(collisions([base, { ...other, aliases: [base.name] }])).not.toEqual([]);
  });
});

describe('CATALOG_FIXTURE covers what it says it covers', () => {
  const some = (test: (entry: CatalogMovement) => boolean) => CATALOG_FIXTURE.some(test);

  it('every tracking type, every modality and every lift pattern', () => {
    expect(new Set(CATALOG_FIXTURE.map((e) => e.trackingType))).toEqual(new Set(TRACKING_TYPES));
    expect(new Set(CATALOG_FIXTURE.map((e) => e.modality))).toEqual(new Set(MODALITIES));
    expect(new Set(CATALOG_FIXTURE.flatMap((e) => (e.pattern ? [e.pattern] : [])))).toEqual(
      new Set(MOVEMENT_PATTERNS),
    );
  });

  it('the shapes the picker and the seed must handle', () => {
    expect(some((e) => e.equipment.length === 0 && e.primaryMuscle !== null)).toBe(true);
    expect(some((e) => e.equipment.length === 0 && e.primaryMuscle === null)).toBe(true);
    expect(some((e) => e.equipment.length === 2)).toBe(true);
    expect(some((e) => e.aliases.length > 0)).toBe(true);
    expect(some((e) => e.supervision === 'coach')).toBe(true);
    expect(some((e) => e.isBodyweight && e.equipment.length > 0)).toBe(true);
    // One movement logged two ways is two entries.
    const rowing = CATALOG_FIXTURE.filter((e) => e.equipment.includes('rowing_machine'));
    expect(new Set(rowing.map((e) => e.trackingType)).size).toBe(2);
  });

  it('gives each entry a stable id beside it, never in it', () => {
    expect(Object.keys(CATALOG_FIXTURE_IDS)).toEqual(CATALOG_FIXTURE.map((e) => e.slug));
    expect(new Set(Object.values(CATALOG_FIXTURE_IDS)).size).toBe(CATALOG_FIXTURE.length);
    for (const entry of CATALOG_FIXTURE) expect(entry).not.toHaveProperty('publicId');
  });

  it('🔴 shares no slug and no name key with the legacy seed list (V3)', () => {
    // A fixtures database holds both until the legacy list is retired (spec E4, F1).
    const legacySlugs = new Set<string>(MOVEMENT_SEED_ROWS.map((row) => row.slug));
    const legacyKeys = new Set(MOVEMENT_SEED_ROWS.map((row) => movementNameKey(row.name)));
    expect(CATALOG_FIXTURE.filter((e) => legacySlugs.has(e.slug)).map((e) => e.slug)).toEqual([]);
    expect(
      CATALOG_FIXTURE.flatMap((e) => [e.name, ...e.aliases]).filter((name) =>
        legacyKeys.has(movementNameKey(name)),
      ),
    ).toEqual([]);
  });
});

describe('the library starts empty (C0a)', () => {
  it('holds no entry, no shipped line and no approval until the first reviewed batch', () => {
    expect(CATALOG_MOVEMENTS).toEqual([]);
    expect([...CATALOG_SLUGS]).toEqual([]);
    expect(SHIPPED).toEqual({});
    expect(APPROVED).toEqual({});
  });
});

describe('the lockfile and the approvals (V4, D3)', () => {
  it('the library agrees with both files', () => {
    expect(lockfileIssues(CATALOG_MOVEMENTS, SHIPPED)).toEqual([]);
    expect(approvalIssues(CATALOG_MOVEMENTS, APPROVED)).toEqual([]);
  });

  const shipped: ShippedFile = { [base.slug]: base.trackingType };
  const approved: ApprovedFile = { '1': { [base.slug]: entryHash(base) } };

  it('🔴 an entry needs its line in the lockfile, with its own tracking type', () => {
    expect(lockfileIssues([base], shipped)).toEqual([]);
    expect(lockfileIssues([base], {})).toHaveLength(1);
    expect(lockfileIssues([{ ...base, trackingType: 'reps' }], shipped)).toHaveLength(1);
  });

  it('🔴 a shipped slug with no entry is a removed or renamed entry', () => {
    expect(lockfileIssues([], shipped)).toHaveLength(1);
    expect(
      lockfileIssues([{ ...base, slug: 'cup_squat', aliases: ['Cup squat'] }], shipped),
    ).toHaveLength(2);
  });

  it('🔴 an entry needs an approval for what it holds NOW: an edit needs a new line', () => {
    expect(approvalIssues([base], approved)).toEqual([]);
    expect(approvalIssues([base], {})).toHaveLength(1);
    for (const edited of [
      { ...base, name: 'Goblet Squat' },
      { ...base, equipment: [] },
      { ...base, secondaryMuscles: [] },
      { ...base, supervision: 'coach' as const },
      { ...base, aliases: ['Cup squat'] },
      { ...base, isBodyweight: true },
    ]) {
      expect(approvalIssues([edited], approved), JSON.stringify(edited)).toHaveLength(1);
    }
    // The edit, approved in a later batch, passes; the first approval stays in the file.
    const edited = { ...base, equipment: [] };
    expect(
      approvalIssues([edited], { ...approved, '2': { [base.slug]: entryHash(edited) } }),
    ).toEqual([]);
  });

  it('an approval for one slug does not cover another entry with the same content', () => {
    const twin = { ...base, slug: 'cup_squat', name: 'Cup squat' };
    expect(approvalIssues([twin], { '1': { [base.slug]: entryHash(twin) } })).toHaveLength(1);
  });

  it('hashes an entry the same whatever order its keys are written in, and differently per field', () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as CatalogMovement;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(base));
    expect(entryHash(reordered)).toBe(entryHash(base));
    expect(entryHash(base)).toMatch(/^[0-9a-f]{64}$/);
    // Array order is content: a reordered list is an edit.
    const two = { ...base, secondaryMuscles: ['glutes', 'hamstrings'] as const };
    expect(entryHash({ ...two, secondaryMuscles: [...two.secondaryMuscles] })).not.toBe(
      entryHash({ ...two, secondaryMuscles: [...two.secondaryMuscles].reverse() }),
    );
  });
});

describe('no equipment is computed (V5)', () => {
  it('is true for an empty required set and for nothing else', () => {
    expect(requiresNoEquipment({ equipment: [] })).toBe(true);
    expect(requiresNoEquipment({ equipment: ['wall'] })).toBe(false);
    const empty = CATALOG_FIXTURE.filter(requiresNoEquipment).map((e) => e.slug);
    expect(empty).toEqual(
      CATALOG_FIXTURE.filter((e) => e.equipment.length === 0).map((e) => e.slug),
    );
    expect(empty.length).toBeGreaterThan(0);
  });

  it('🔴 is stored nowhere: no field or column is named for the answer', () => {
    const { files } = reachedFrom(resolve(SRC, 'index.ts'));
    const more = ['catalog/data/index.ts', 'catalog/fixture.ts', 'catalog/approvals.ts'].map((f) =>
      resolve(SRC, f),
    );
    const named = [...files, ...more].filter((file) =>
      /\bnoEquipment\b|\bno_equipment\b/.test(code(file)),
    );
    expect(named).toEqual([]);
    // The control: the scan does see the function's own name.
    expect(code(resolve(SRC, 'catalog/entry.ts'))).toMatch(/\brequiresNoEquipment\b/);
  });
});

describe('the library stays out of the browser (V6)', () => {
  const barrel = reachedFrom(resolve(SRC, 'index.ts')).files;
  const under = (dir: string) => (file: string) => file.startsWith(resolve(SRC, dir));

  it('🔴 the root barrel reaches the vocabularies and the entry, never the data', () => {
    expect(barrel).toContain(resolve(SRC, 'catalog/vocabulary.ts'));
    expect(barrel).toContain(resolve(SRC, 'catalog/entry.ts'));
    expect(barrel.filter(under('catalog/data'))).toEqual([]);
    expect(barrel).not.toContain(resolve(SRC, 'catalog/approvals.ts'));
  });

  it('is scanned by something that does see the data from where it is exported', () => {
    expect(reachedFrom(resolve(SRC, 'catalog/data/index.ts')).files).toContain(
      resolve(SRC, 'catalog/data/index.ts'),
    );
    expect(reachedFrom(resolve(SRC, 'catalog/approvals.ts')).packages).toContain('node:crypto');
  });
});
