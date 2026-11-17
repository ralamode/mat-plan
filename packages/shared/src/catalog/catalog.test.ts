import { globSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MOVEMENT_SEED_ROWS } from '../catalog-movements';
import { MOVEMENT_PICKER_ALIASES } from '../movement-picker-catalog';
import { movementNameKey } from '../movement-search';
import { MOVEMENT_NAME_MAX, MOVEMENT_PATTERNS, movementSlug, TRACKING_TYPES } from '../movements';
import { code, reachedFrom, specifiersOf, SRC } from '../test-support/source-graph';
import { CATALOG_MOVEMENTS } from './data';
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
 * CAT-3's contract, chunk C0a (docs/specs/cat-3-movement-library.md): criteria V1 to V3, V5, V6 and
 * D2, and what `CATALOG_FIXTURE` promises to cover. V4 and D3 (the lockfile, the approvals and the
 * merge-base check) are in `approvals.test.ts`.
 *
 * ⚠️ `CATALOG_MOVEMENTS` is empty until the first reviewed batch, so every check that walks it
 * passes on nothing until then. Each such check is therefore also run on samples or on
 * `CATALOG_FIXTURE`, which is where it is shown to fail.
 */

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

  it('🔴 refuses a slug the CSV export could not print, whichever name it came from', () => {
    // An alias may hold a comma; a slug taken from one may not. The export prints the slug.
    const viaAlias = { ...base, aliases: ['Squat, goblet'], slug: movementSlug('Squat, goblet') };
    expect(viaAlias.slug).toContain(',');
    expect(accepts(viaAlias)).toBe(false);
    expect(accepts({ ...viaAlias, slug: base.slug })).toBe(true);
    expect(accepts({ ...base, aliases: ['Goblet\nsquat'], slug: 'goblet\nsquat' })).toBe(false);
  });

  it('holds an alias to the label rules: not empty, not blank, not over-long', () => {
    expect(accepts({ ...base, aliases: ['Cup squat'] })).toBe(true);
    expect(accepts({ ...base, aliases: [''] })).toBe(false);
    expect(accepts({ ...base, aliases: ['   '] })).toBe(false);
    expect(accepts({ ...base, aliases: ['x'.repeat(MOVEMENT_NAME_MAX)] })).toBe(true);
    expect(accepts({ ...base, aliases: ['x'.repeat(MOVEMENT_NAME_MAX + 1)] })).toBe(false);
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
  it('parses, entry by entry, to exactly what is written (D2)', () => {
    // Equal, not merely accepted: the schema trims, and the approval hash and the seed both read
    // the entry as written. An untrimmed name must fail here, not be quietly tidied.
    for (const entry of entries) {
      expect(catalogMovementSchema.parse(entry), entry.slug).toEqual(entry);
    }
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

describe('the checks a whole list is held to, on samples', () => {
  it('an entry written with stray spaces does not equal its parse', () => {
    for (const untidy of [
      { ...base, name: `${base.name} `, slug: base.slug },
      { ...base, aliases: [' Cup squat'] },
    ]) {
      expect(accepts(untidy)).toBe(true);
      expect(catalogMovementSchema.parse(untidy)).not.toEqual(untidy);
    }
  });

  it('a data file may import the entry type and its own directory, nothing else (D2)', () => {
    const DATA = resolve(SRC, 'catalog/data');
    const files = globSync('**/*.ts', { cwd: DATA }).map((file) => resolve(DATA, file));
    expect(files).toContain(resolve(DATA, 'index.ts'));
    const outside = files.flatMap((file) =>
      specifiersOf(file)
        .filter(
          (specifier) =>
            specifier !== '../entry' && !(specifier.startsWith('./') && !specifier.includes('..')),
        )
        .map((specifier) => `${file}: ${specifier}`),
    );
    expect(outside).toEqual([]);
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

  it('🔴 shares no alias key with the legacy picker either', () => {
    // A query that alias-hit one movement in each list would have no one answer.
    const legacy = new Set(MOVEMENT_PICKER_ALIASES.map(({ alias }) => movementNameKey(alias)));
    expect(legacy.has(movementNameKey('RDL'))).toBe(true);
    expect(
      CATALOG_FIXTURE.flatMap((e) => [e.name, ...e.aliases]).filter((name) =>
        legacy.has(movementNameKey(name)),
      ),
    ).toEqual([]);
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

  /** `noEquipment` / `no_equipment` as a word of its own, comments aside. */
  const namesTheAnswer = (file: string) => /\bnoEquipment\b|\bno_equipment\b/.test(code(file));
  const ROOT = resolve(SRC, '../../..');
  /**
   * Everywhere a stored answer could live: every package's source (the schema and the DTOs among
   * them), the migrations, and the app. This file is left out: it has to spell the two names.
   */
  const scanned = () =>
    [
      'packages/*/src/**/*.{ts,tsx}',
      'packages/db/migrations/*.sql',
      'apps/web/{app,components,lib}/**/*.{ts,tsx}',
    ]
      .flatMap((pattern) => globSync(pattern, { cwd: ROOT }))
      .map((file) => resolve(ROOT, file))
      .filter((file) => file !== resolve(SRC, 'catalog/catalog.test.ts'));

  it('🔴 is stored nowhere: no field or column is named for the answer', () => {
    const files = scanned();
    expect(files.filter(namesTheAnswer).map((file) => file.slice(ROOT.length + 1))).toEqual([]);
    // Not a vacuous pass: the scan reads the schema, a migration, the option DTO and the data.
    for (const reached of [
      'packages/db/src/schema.ts',
      'apps/web/lib/movements/movement-option.ts',
      'packages/shared/src/catalog/data/index.ts',
      'packages/shared/src/catalog/entry.ts',
    ]) {
      expect(files, reached).toContain(resolve(ROOT, reached));
    }
    expect(files.some((file) => file.endsWith('.sql'))).toBe(true);
  });

  it('is scanned by something that does see the name, as a field or as a column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-scan-'));
    try {
      const plant = (name: string, text: string) => {
        writeFileSync(join(dir, name), text);
        return namesTheAnswer(join(dir, name));
      };
      expect(plant('dto.ts', 'export type Option = { readonly noEquipment: boolean };\n')).toBe(
        true,
      );
      expect(plant('m.sql', 'ALTER TABLE movements ADD COLUMN no_equipment boolean;\n')).toBe(true);
      // The function's own name, and a mention in a comment, are not the stored answer.
      expect(plant('fn.ts', 'export const x = requiresNoEquipment({ equipment: [] });\n')).toBe(
        false,
      );
      expect(plant('doc.ts', '/** not a noEquipment flag */\nexport const y = 1;\n')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
