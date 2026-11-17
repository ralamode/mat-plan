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
 * 🔴 **A base it cannot read is a failure (exit 2), never "nothing to compare".** Only a file that
 * the base commit does not hold counts as empty there; a mistyped or unfetched base, or any other
 * git error, stops the check instead of passing it.
 *
 * Usage:
 *   node .github/scripts/check-catalog-append-only.mjs [baseRef]   # default: as the other guards
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { defaultBase } from './default-base.mjs';

const DIR = 'packages/shared/src/catalog/data';
export const FILES = [`${DIR}/shipped.json`, `${DIR}/approved.json`];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * What the head lost or changed that the base had: every key of the base must still be there, with
 * the same value, at every depth. New keys are what a batch adds and are never an issue.
 */
export function appendOnlyIssues(base, head, path = []) {
  const at = path.length ? path.map((key) => JSON.stringify(key)).join(' → ') : '(the file)';
  if (!isObject(base)) {
    return JSON.stringify(base) === JSON.stringify(head)
      ? []
      : [`${at}: was ${JSON.stringify(base)}, now ${JSON.stringify(head)}`];
  }
  if (!isObject(head)) return [`${at}: is no longer an object`];
  return Object.keys(base).flatMap((key) =>
    Object.hasOwn(head, key)
      ? appendOnlyIssues(base[key], head[key], [...path, key])
      : [`${[...path, key].map((k) => JSON.stringify(k)).join(' → ')}: removed`],
  );
}

const fail = (code, message) => {
  console.error(message);
  process.exit(code);
};

function parse(text, where) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fail(1, `✗ ${where} is not JSON: ${error.message}`);
  }
}

function main() {
  const base = defaultBase(process.argv[2]);
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  } catch {
    fail(2, `✗ The base '${base}' is not a commit in this checkout, so nothing can be compared.`);
  }

  let failed = false;
  for (const file of FILES) {
    // After the base is known to be a commit, an empty listing means one thing: the base does not
    // hold the file (this is the PR that adds it). Any other git failure throws and stops the run.
    const atBase = git('ls-tree', '--name-only', base, '--', file).trim() !== '';
    const atHead = existsSync(file);
    if (!atBase && !atHead) continue;
    if (atBase && !atHead) {
      console.error(`✗ ${file} → removed`);
      failed = true;
      continue;
    }
    const before = atBase ? parse(git('show', `${base}:${file}`), `${file} at ${base}`) : {};
    const issues = appendOnlyIssues(before, parse(readFileSync(file, 'utf8'), file));
    for (const issue of issues) console.error(`✗ ${file} → ${issue}`);
    failed ||= issues.length > 0;
  }
  if (failed) {
    fail(
      1,
      "\nThe library's record files only grow. A shipped slug keeps its tracking type and its line;" +
        '\nan approval is never rewritten or removed. Add a line; do not change one.',
    );
  }
  console.log(`Catalog records OK — nothing shipped or approved before ${base} was changed.`);
}

// When imported (the contract's tests do), argv[1] is not this file, and may not be a path at all.
const runAsScript = () => {
  try {
    return (
      !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
};
if (runAsScript()) main();
