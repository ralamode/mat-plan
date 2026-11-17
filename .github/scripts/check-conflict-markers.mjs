#!/usr/bin/env node
// Fails when a tracked file still holds a merge-conflict marker (DX-17).
//
//   node .github/scripts/check-conflict-markers.mjs            # every tracked file (format:check, CI)
//   node .github/scripts/check-conflict-markers.mjs --staged   # the index (pre-commit, before Prettier)
//
// Why it exists: twice (#437, #522) a merge committed its markers and every gate stayed green.
// Prettier reflows a marker inside a markdown table into table rows, and a closing marker into a
// blockquote of seven spaced `>`s, so `prettier --check` passes on the damage. The last two
// patterns are the reflowed forms (`> > > > > > >`, and a marker Prettier put in a table cell or
// quote, `| <<<<<<< HEAD |` or `> \=======`); the pre-commit run sees the raw markers, before
// Prettier rewrites them. A trailing `\r` or space after `=======` still counts (CRLF files).
// A markdown heading underlined with exactly seven `=` also matches: use more, or fewer.
import { spawnSync } from 'node:child_process';

const PATTERN = [
  '^(<{7}|[|]{7}|>{7})( |$)',
  '^={7}[[:space:]]*$',
  '^ *(> ){6}>',
  '^([|] |> )\\\\?(<{7}|={7}|>{7})( |$)',
].join('|');
const staged = process.argv.includes('--staged');

const args = ['grep', '-nIE', PATTERN];
if (staged) args.splice(1, 0, '--cached');
const run = spawnSync('git', args, { encoding: 'utf8' });

// git grep: 0 = found, 1 = none, anything else = it could not look. Never read that as clean.
if (run.status === 1) {
  console.log(
    `Conflict-marker guard OK — no markers in ${staged ? 'the index' : 'tracked files'}.`,
  );
  process.exit(0);
}
if (run.status !== 0) {
  console.error(
    `Conflict-marker guard could not run git grep (exit ${run.status}): ${run.error?.message ?? run.stderr}`,
  );
  process.exit(2);
}
console.error(
  `Merge-conflict markers in ${staged ? 'staged' : 'tracked'} files — resolve them before committing:\n` +
    run.stdout +
    '\nThe "> > > > > > >" form is a closing marker Prettier reflowed into a blockquote (docs/lessons.md → GitHub / PRs).',
);
process.exit(1);
