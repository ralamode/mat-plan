#!/usr/bin/env node
/**
 * The migration snapshot chain: every `meta/NNNN_snapshot.json` has a `prevId` equal to the `id` of
 * the snapshot before it, and no snapshot's `prevId` is its own `id`.
 * Plan: docs/plans/dx-snapshot-chain-script.md.
 *
 * Why: drizzle walks this chain only when APPENDING a migration, so a broken link is invisible
 * (`generate` reports "No schema changes" and `db:verify` passes) until the NEXT migration dies with
 * "are pointing to a parent snapshot ... which is a collision". Exactly that shipped in #139 and sat
 * on main undetected: merging two generated migrations and promoting the second snapshot to the
 * first's filename left `prevId === id`, a self-reference. `drizzle-kit check` (pnpm db:check)
 * passes that case, so this check stays. The break is introduced by one PR and surfaces in a later,
 * unrelated one, so it runs on every event, not only on PRs that touch migrations.
 *
 * ⚠️ GAPS IN THE NUMBERING ARE ALLOWED. Main has no `0018_snapshot.json`: `0019`'s `prevId` is
 * `0017`'s `id` (#139/#147). Only adjacent EXISTING files, in name order, are compared. Never tighten
 * this into "the numbers are consecutive" or "one snapshot per journal entry": main would turn red.
 *
 * It reads only the tree, so it needs no base commit and no dependencies. CI runs it before
 * `Setup pnpm`, on the runner's preinstalled Node, so it uses `readdirSync` and a regex (no fs.glob).
 *
 *   node .github/scripts/check-snapshot-chain.mjs [--dir <meta dir>]
 *
 * Exit 0: the chain is intact. Exit 1: a broken link or a self-reference. Exit 2: it could not check
 * (no directory, no snapshots, a name that is not NNNN_snapshot.json, a file that is not a JSON
 * object with a string `id` and `prevId`, or any unexpected error). Every file is read before any
 * link is judged, so an unreadable file always exits 2. Values from the files are printed through
 * JSON.stringify, so none can be read by Actions as a workflow command.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_META_DIR = 'packages/db/migrations/meta';
const SNAPSHOT_NAME = /^\d{4}_snapshot\.json$/;

const REPAIR = `
Each meta/NNNN_snapshot.json must have prevId == the PREVIOUS snapshot's id (gaps in the numbering
are allowed: the previous snapshot is the one before it that exists). drizzle only walks this chain
when appending, so a break is silent until the NEXT migration fails to generate. Outside a merge
with main (the two-pass add-or-drop in the db-migration skill), fix it by setting the offending
prevId to the id of the snapshot before it: the snapshot files are NOT applied to prod and are safe
to repair. NOT after merging main or after a regenerate: then a snapshot of yours main lacks is
probably still in meta/, and the .sql may hold main's DDL. Don't hand-edit the prevId; follow
.claude/skills/db-migration/SKILL.md -> "Regenerate on top of main".`;

class CannotCheck extends Error {}

/** The snapshots in `dir`, in name order, each read and shape-checked. Throws CannotCheck. */
export function readSnapshots(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('_snapshot.json'));
  } catch {
    throw new CannotCheck(`cannot read the directory ${JSON.stringify(dir)}`);
  }
  if (names.length === 0) throw new CannotCheck(`no *_snapshot.json in ${JSON.stringify(dir)}`);
  const bad = names.filter((n) => !SNAPSHOT_NAME.test(n));
  if (bad.length) {
    throw new CannotCheck(
      `not named NNNN_snapshot.json: ${bad.map((n) => JSON.stringify(n)).join(', ')}`,
    );
  }
  return names.sort().map((name) => {
    let body;
    try {
      body = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch {
      throw new CannotCheck(`${JSON.stringify(name)} is not readable JSON`);
    }
    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.id !== 'string' ||
      typeof body.prevId !== 'string'
    ) {
      throw new CannotCheck(`${JSON.stringify(name)} is not an object with a string id and prevId`);
    }
    return { name, id: body.id, prevId: body.prevId };
  });
}

/** Every break in the chain, as one line each; empty when it is intact. */
export function chainProblems(snapshots) {
  const problems = [];
  snapshots.forEach((s, i) => {
    const before = snapshots[i - 1];
    if (before && s.prevId !== before.id) {
      problems.push(
        `${JSON.stringify(s.name)}: prevId=${JSON.stringify(s.prevId)}, expected ${JSON.stringify(before.id)} (the id of ${JSON.stringify(before.name)})`,
      );
    }
    if (s.prevId === s.id) {
      problems.push(
        `${JSON.stringify(s.name)}: prevId === id (self-referential), id=${JSON.stringify(s.id)}`,
      );
    }
  });
  return problems;
}

function main(argv) {
  const at = argv.indexOf('--dir');
  const dir = at === -1 ? DEFAULT_META_DIR : argv[at + 1];
  const onCi = Boolean(process.env.GITHUB_ACTIONS);
  try {
    const snapshots = readSnapshots(dir);
    const problems = chainProblems(snapshots);
    if (problems.length === 0) {
      console.log(
        `Snapshot chain OK — ${snapshots.length} snapshot(s), each prevId is the id before it.`,
      );
      return 0;
    }
    console.log(`Broken snapshot chain:\n  ${problems.join('\n  ')}\n${REPAIR}`);
    if (onCi)
      console.log('::error::Broken migration snapshot chain (see log; AGENTS.md → DB rules).');
    return 1;
  } catch (e) {
    const why =
      e instanceof CannotCheck ? e.message : `unexpected error: ${JSON.stringify(String(e))}`;
    console.log(`Snapshot chain could not be checked — ${why}`);
    if (onCi) console.log('::error::Migration snapshot chain could not be checked (see log).');
    return 2;
  }
}

const self = realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && realpathSync(process.argv[1]) === self) {
  process.exitCode = main(process.argv.slice(2));
}
