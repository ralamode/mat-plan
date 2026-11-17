import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SRC } from '../test-support/source-graph';
import {
  approvalIssues,
  entryHash,
  lockfileIssues,
  type ApprovedFile,
  type ShippedFile,
} from './approvals';
import { CATALOG_MOVEMENTS, CATALOG_SLUGS } from './data';
import { catalogMovementSchema, type CatalogMovement } from './entry';
import { CATALOG_FIXTURE } from './fixture';

/**
 * CAT-3's contract, chunk C0a (docs/specs/cat-3-movement-library.md): V4 and D3. Every library
 * entry agrees with the lockfile and has an approval for what it holds now, and the two record
 * files only grow.
 *
 * ⚠️ The first test is the one a batch PR turns red or green; it passes on nothing while the
 * library is empty. The rest hold the checks themselves, on samples.
 */

const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(SRC, 'catalog/data', name), 'utf8')) as T;

const [first] = CATALOG_FIXTURE;
if (!first) throw new Error('CATALOG_FIXTURE is empty');
/** A valid entry to change one field of. */
const base: CatalogMovement = { ...first };

describe('the library and its two record files (V4, D3)', () => {
  it('🔴 every entry has its lockfile line and an approval for what it holds now', () => {
    expect(lockfileIssues(CATALOG_MOVEMENTS, readJson<ShippedFile>('shipped.json'))).toEqual([]);
    expect(approvalIssues(CATALOG_MOVEMENTS, readJson<ApprovedFile>('approved.json'))).toEqual([]);
    expect([...CATALOG_SLUGS]).toEqual(CATALOG_MOVEMENTS.map((entry) => entry.slug));
  });
});

describe('the lockfile check', () => {
  const shipped: ShippedFile = { [base.slug]: base.trackingType };

  it('🔴 an entry needs its line in the lockfile, with its own tracking type', () => {
    expect(lockfileIssues([base], shipped)).toEqual([]);
    expect(lockfileIssues([base], {})).toHaveLength(1);
    expect(lockfileIssues([{ ...base, trackingType: 'reps' }], shipped)).toHaveLength(1);
  });

  it('🔴 a shipped slug with no entry is a removed or renamed entry', () => {
    expect(lockfileIssues([], shipped)).toHaveLength(1);
    const renamed = { ...base, slug: 'cup_squat', aliases: ['Cup squat'] };
    expect(lockfileIssues([renamed], shipped)).toHaveLength(2);
  });
});

describe('the approvals check', () => {
  const approved: ApprovedFile = { '1': { [base.slug]: entryHash(base) } };

  /**
   * One edit for every field an entry has. Typed over the entry's own keys, so a field added to
   * the schema does not compile until it has an edit here.
   */
  const EDITED: { [K in keyof Required<CatalogMovement>]: CatalogMovement[K] } = {
    slug: 'cup_squat',
    name: 'Cup squat',
    aliases: ['Cup squat'],
    modality: 'mobility',
    pattern: 'lunge',
    trackingType: 'reps',
    unitDefault: 'kg',
    isBodyweight: true,
    equipment: ['kettlebell'],
    primaryMuscle: 'glutes',
    secondaryMuscles: ['hamstrings'],
    supervision: 'coach',
  };
  const fields = Object.keys(EDITED) as (keyof typeof EDITED)[];
  const edited = (field: keyof typeof EDITED): CatalogMovement => ({
    ...base,
    [field]: EDITED[field],
  });

  it('has an edit for every field of the schema, each one a real change', () => {
    expect([...fields].sort()).toEqual(Object.keys(catalogMovementSchema.shape).sort());
    for (const field of fields) expect(EDITED[field], field).not.toEqual(base[field]);
  });

  it('🔴 an entry needs an approval for what it holds NOW: an edit to ANY field needs a new line', () => {
    expect(approvalIssues([base], approved)).toEqual([]);
    expect(approvalIssues([base], {})).toHaveLength(1);
    for (const field of fields) {
      // The old approval, moved to the edited entry's slug where the slug is the edit.
      const stale: ApprovedFile = { '1': { [edited(field).slug]: entryHash(base) } };
      expect(approvalIssues([edited(field)], stale), field).toHaveLength(1);
    }
  });

  it.each(fields)('🔴 the hash covers %s', (field) => {
    expect(entryHash(edited(field))).not.toBe(entryHash(base));
  });

  it('gives every one of those edits a hash of its own', () => {
    const hashes = [base, ...fields.map(edited)].map(entryHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('an approved edit passes, and the first approval stays in the file', () => {
    const now = edited('equipment');
    expect(approvalIssues([now], { ...approved, '2': { [base.slug]: entryHash(now) } })).toEqual(
      [],
    );
  });

  it('an approval for one slug does not cover another entry with the same content', () => {
    const twin = { ...base, slug: 'cup_squat', name: 'Cup squat' };
    expect(approvalIssues([twin], { '1': { [base.slug]: entryHash(twin) } })).toHaveLength(1);
  });

  it('hashes an entry the same whatever order its keys are written in', () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as CatalogMovement;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(base));
    expect(entryHash(reordered)).toBe(entryHash(base));
    expect(entryHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('counts array order as content: a reordered list is an edit', () => {
    const two: CatalogMovement = { ...base, secondaryMuscles: ['glutes', 'hamstrings'] };
    const swapped: CatalogMovement = { ...base, secondaryMuscles: ['hamstrings', 'glutes'] };
    expect(entryHash(swapped)).not.toBe(entryHash(two));
  });

  it('hashes an absent supervision and an undefined one alike, and a set one differently', () => {
    const { supervision: _, ...without } = { ...base, supervision: undefined };
    expect(entryHash({ ...base, supervision: undefined })).toBe(entryHash(without));
    expect(entryHash({ ...base, supervision: 'coach' })).not.toBe(entryHash(without));
  });
});

describe('the record files only grow (V4, the merge-base check)', () => {
  type AppendOnly = (base: unknown, head: unknown) => string[];
  // The check is a plain node script that CI runs before anything is installed. Its comparison
  // and its handling of the base are tested here, with the rest of the contract's tests.
  const ROOT = resolve(SRC, '../../..');
  const script = resolve(ROOT, '.github/scripts/check-catalog-append-only.mjs');
  const load = async () =>
    ((await import(/* @vite-ignore */ script)) as { appendOnlyIssues: AppendOnly })
      .appendOnlyIssues;
  const run = (baseRef: string) =>
    spawnSync(process.execPath, [script, baseRef], { cwd: ROOT, encoding: 'utf8' });

  it('lets a batch add slugs, batches and approvals', async () => {
    const issues = await load();
    expect(issues({}, { goblet_squat: 'weight_reps' })).toEqual([]);
    expect(issues({ a: 'reps' }, { a: 'reps', b: 'reps' })).toEqual([]);
    expect(issues({ '1': { a: 'h1' } }, { '1': { a: 'h1', b: 'h2' }, '2': { a: 'h3' } })).toEqual(
      [],
    );
  });

  it('🔴 refuses a retyped slug, a removed slug and a rewritten or removed approval', async () => {
    const issues = await load();
    expect(issues({ a: 'reps' }, { a: 'weight_reps' })).toHaveLength(1);
    expect(issues({ a: 'reps', b: 'reps' }, { b: 'reps' })).toHaveLength(1);
    expect(issues({ a: 'reps' }, { a_renamed: 'reps' })).toHaveLength(1);
    expect(issues({ '1': { a: 'h1' } }, { '1': { a: 'h9' } })).toHaveLength(1);
    expect(issues({ '1': { a: 'h1' } }, { '1': {} })).toHaveLength(1);
    expect(issues({ '1': { a: 'h1' } }, { '2': { a: 'h1' } })).toHaveLength(1);
    expect(issues({ '1': { a: 'h1' } }, [])).toHaveLength(1);
    expect(issues({ a: 'reps' }, { a: null })).toHaveLength(1);
    expect(issues({ '1': { a: 'h1' } }, { '1': 'h1' })).toHaveLength(1);
  });

  it('does not take an inherited name for a kept key', async () => {
    const issues = await load();
    expect(issues({ toString: 'reps' }, {})).toHaveLength(1);
  });

  it('🔴 fails, and does not pass, when the base is not a commit it can read', () => {
    const missing = run('no-such-ref-for-the-catalog-check');
    expect(missing.status).toBe(2);
    expect(missing.stdout).not.toContain('OK');
    // The control: the same script against a base that exists.
    const here = run('HEAD');
    expect(here.status, here.stderr).toBe(0);
    expect(here.stdout).toContain('Catalog records OK');
  });
});
