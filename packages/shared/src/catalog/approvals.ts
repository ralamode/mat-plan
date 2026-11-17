import { createHash } from 'node:crypto';

import type { CatalogMovement } from './entry';

/**
 * The two files that stand behind every library entry
 * ([spec](../../../../docs/specs/cat-3-movement-library.md), V4 and D3), and the checks that hold
 * an entry to them.
 *
 * - **`data/shipped.json`, the lockfile:** slug to tracking type. A shipped slug and its type never
 *   change (spec rule 4; FAM-1 plan D25), so the file only grows.
 * - **`data/approved.json`:** batch number to slug to the hash of the entry the maintainer
 *   approved. A new entry, **and an edited one**, has no matching hash until an approval line is
 *   added, so it cannot reach `main` unreviewed.
 *
 * ⚠️ **Server and test code only** (`node:crypto`). Nothing a browser loads imports this file, and
 * the catalog module's index does not export it.
 *
 * That both files only grow is checked against the merge base by
 * `.github/scripts/check-catalog-append-only.mjs`; these functions check the head against itself.
 */

/** slug → tracking type. */
export type ShippedFile = Readonly<Record<string, string>>;
/** batch number → slug → hash. A slug may appear in more than one batch: once when added, again for each approved edit. */
export type ApprovedFile = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A value as JSON with every object's keys sorted, so two spellings of one entry hash alike. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The hash an approval line holds: SHA-256 over the entry's canonical JSON, every field included.
 * Array order counts (an alias list reordered is an edit); key order does not.
 */
export function entryHash(entry: CatalogMovement): string {
  return createHash('sha256').update(canonical(entry)).digest('hex');
}

/** What is wrong between the entries and the lockfile; empty when they agree. */
export function lockfileIssues(
  entries: readonly CatalogMovement[],
  shipped: ShippedFile,
): string[] {
  const issues: string[] = [];
  const slugs = new Set(entries.map((entry) => entry.slug));
  for (const entry of entries) {
    const locked = shipped[entry.slug];
    if (locked === undefined) issues.push(`${entry.slug}: no line in shipped.json`);
    else if (locked !== entry.trackingType) {
      issues.push(
        `${entry.slug}: shipped as ${locked}, now ${entry.trackingType} (a type is set once)`,
      );
    }
  }
  for (const slug of Object.keys(shipped)) {
    if (!slugs.has(slug))
      issues.push(`${slug}: in shipped.json with no entry (a shipped entry stays)`);
  }
  return issues;
}

/** The entries with no approval line for what they hold now; empty when every one is approved. */
export function approvalIssues(
  entries: readonly CatalogMovement[],
  approved: ApprovedFile,
): string[] {
  const hashes = new Map<string, Set<string>>();
  for (const batch of Object.values(approved)) {
    for (const [slug, hash] of Object.entries(batch)) {
      hashes.set(slug, (hashes.get(slug) ?? new Set()).add(hash));
    }
  }
  return entries
    .filter((entry) => !hashes.get(entry.slug)?.has(entryHash(entry)))
    .map((entry) => `${entry.slug}: no approval for this content (expected ${entryHash(entry)})`);
}
