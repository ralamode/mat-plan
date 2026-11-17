#!/usr/bin/env node
/**
 * The movement library's two record files only grow (CAT-3 spec, V4).
 *
 * `packages/shared/src/catalog/data/shipped.json` (slug to tracking type) and `approved.json`
 * (batch to slug to the hash the maintainer approved) are what stop a shipped entry being retyped,
 * renamed, removed or re-approved after the fact. A unit test can only compare the head with
 * itself: it cannot see a line that was deleted. This compares the head with the PR's base.
 *
 * It parses both sides and compares values, not lines: adding a key to a JSON object rewrites the
 * line before it, so a line diff would fail every honest batch.
 *
 * Usage:
 *   node .github/scripts/check-catalog-append-only.mjs [baseRef]   # default: as the other guards
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { defaultBase } from './default-base.mjs';

const DIR = 'packages/shared/src/catalog/data';
export const FILES = [`${DIR}/shipped.json`, `${DIR}/approved.json`];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * What the head lost or changed that the base had: every key of the base must still be there, with
 * the same value, at every depth. New keys are what a batch adds and are never an issue.
 */
export function appendOnlyIssues(base, head, path = '') {
  if (!isObject(base)) {
    return JSON.stringify(base) === JSON.stringify(head)
      ? []
      : [`${path}: was ${JSON.stringify(base)}, now ${JSON.stringify(head)}`];
  }
  if (!isObject(head)) return [`${path || '(file)'}: is no longer an object`];
  return Object.keys(base).flatMap((key) => {
    const at = path ? `${path}.${key}` : key;
    return key in head ? appendOnlyIssues(base[key], head[key], at) : [`${at}: removed`];
  });
}

function main() {
  const base = defaultBase(process.argv[2]);
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let failed = false;
  for (const file of FILES) {
    let before = '{}';
    try {
      before = git('show', `${base}:${file}`);
    } catch {
      // The file does not exist at the base: this is the PR that adds it.
    }
    const issues = appendOnlyIssues(JSON.parse(before), JSON.parse(readFileSync(file, 'utf8')));
    for (const issue of issues) console.error(`✗ ${file} → ${issue}`);
    failed ||= issues.length > 0;
  }
  if (failed) {
    console.error(
      "\nThe library's record files only grow. A shipped slug keeps its tracking type and its line;" +
        '\nan approval is never rewritten or removed. Add a line; do not change one.',
    );
    process.exit(1);
  }
  console.log(`Catalog records OK — nothing shipped or approved before ${base} was changed.`);
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url)
  main();
