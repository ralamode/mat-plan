#!/usr/bin/env node
/**
 * `pnpm probe` — run ONE mutation against the working tree, report whether a gate caught it, and put
 * the tree back.
 *
 * ## Why this is a script and not a rule
 *
 * The rule has been written down since #367: a probe must distinguish red, green and DID-NOT-RUN, and
 * a probe's `git checkout` must not be aimed at a dirty file.
 * [lessons.md](../../docs/lessons.md) → "A mutation probe reported GREEN because the mutant did not
 * COMPILE" says both. It was then violated **three more times in one session**, in the same shape
 * every time: an ad-hoc `git checkout -- <file>` reverted work that had never been committed, and the
 * next probes in the batch reported RED against a tree with nothing in it to test.
 *
 * Writing the rule down again would be the fourth attempt at the same control. So the control is
 * mechanical here, and it is **not** "refuse when the file is dirty" — that refusal fires on the
 * legitimate case too, because the mutation itself makes the file dirty. It is:
 *
 * 🔴 **RESTORE FROM A SNAPSHOT OF WHAT WAS THERE, NEVER FROM `HEAD`.** Before touching anything,
 * `git stash create` writes a commit object for the whole working tree — ⚠️ **without pushing onto
 * the stash stack**, which matters because several worktrees share that stack and another session may
 * be using it. The restore reads the file back out of that commit, so uncommitted work in the probed
 * file survives even when the precondition below is waived.
 *
 * And then it **verifies the restore**, byte for byte, against the snapshot. That check is what would
 * have turned three silent losses into one loud failure.
 *
 * ## Usage
 *
 *   pnpm probe --file <path> --from <literal> --to <literal> --gate "<command>" [--expect "<text>"]
 *
 *   --file    the file to mutate, relative to the repo root
 *   --from    the exact literal to replace. Must appear EXACTLY ONCE, or the probe aborts having
 *             changed nothing — an ambiguous target is how a probe mutates the wrong line.
 *   --to      what to replace it with (`--to ""` deletes the line's content)
 *   --gate    the command that should go RED, e.g. "pnpm --filter web exec vitest run my-suite"
 *   --expect  a substring the gate's output must contain when it fails. ⚠️ **Pass it.** Without it a
 *             probe proves only "something went red", which is the vacuity this repo keeps finding in
 *             its own proofs, pointed at the proof instead of the code.
 *   --allow-dirty   probe a file with uncommitted changes. The snapshot still protects it; this only
 *                   waives the "commit first" precondition, and the reason it exists is that waiving
 *                   it is now SAFE rather than forbidden.
 *
 * Exit 0 means the gate went red for the named reason — the probe passed. Any other outcome exits 1
 * and says which of the three it was.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** `git`, captured, trimmed, never through a shell. */
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();

const fail = (message) => {
  console.error(`✖ probe: ${message}`);
  process.exit(1);
};

function parseArgs(argv) {
  const out = { expect: null, allowDirty: false };
  const want = {
    '--file': 'file',
    '--from': 'from',
    '--to': 'to',
    '--gate': 'gate',
    '--expect': 'expect',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--allow-dirty') {
      out.allowDirty = true;
      continue;
    }
    const key = want[arg];
    if (!key) fail(`unknown argument ${arg}`);
    // `--to ""` is meaningful (delete the text), so an empty string is accepted but a MISSING value
    // is not — `--to` as the last argument would otherwise silently become `--to undefined`.
    if (i + 1 >= argv.length) fail(`${arg} needs a value`);
    out[key] = argv[(i += 1)];
  }
  for (const key of ['file', 'from', 'to', 'gate']) {
    if (out[key] === undefined) fail(`--${key} is required`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const root = git(['rev-parse', '--show-toplevel']);
const path = resolve(root, args.file);
const relative = git(['ls-files', '--full-name', '--', path]) || args.file;

// ── 1. The precondition, and the reason it is only a precondition ────────────────────────────────
const dirty = git(['status', '--porcelain', '--', path]) !== '';
if (dirty && !args.allowDirty) {
  fail(
    `${relative} has uncommitted changes.\n` +
      `  Commit first — a probe is run against COMMITTED code, so a failure is attributable to the\n` +
      `  mutation and nothing else (lessons.md). The snapshot below would protect the work either\n` +
      `  way; pass --allow-dirty if you mean it.`,
  );
}

// ── 2. The snapshot. A commit object for the WHOLE tree, and the stash stack is untouched ────────
// `git stash create` on a clean tree prints nothing, in which case HEAD already is the tree.
const snapshot = git(['stash', 'create']) || git(['rev-parse', 'HEAD']);
const before = readFileSync(path, 'utf8');

// ── 3. The mutation. Exactly one occurrence, or nothing happens ──────────────────────────────────
const occurrences = before.split(args.from).length - 1;
if (occurrences !== 1) {
  fail(
    `--from appears ${occurrences} times in ${relative}; it must appear exactly once.\n` +
      `  Nothing was changed. An ambiguous target is how a probe mutates a line it was not aiming at.`,
  );
}
writeFileSync(path, before.replace(args.from, args.to));

// ── 4. Run the gate, then ALWAYS restore, then verify the restore ────────────────────────────────
const run = spawnSync(args.gate, { shell: true, encoding: 'utf8', cwd: root });
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

let restoreError = null;
try {
  // 🔴 From the SNAPSHOT, not from HEAD. This is the whole point of the file.
  git(['checkout', snapshot, '--', relative]);
} catch (error) {
  restoreError = error;
}
const after = readFileSync(path, 'utf8');
if (after !== before) {
  // Loud, and exit 1 regardless of the verdict: a probe that leaves the tree changed has done
  // something worse than fail to prove anything.
  console.error(
    `✖ probe: THE RESTORE DID NOT MATCH.\n` +
      `  ${relative} differs from what it was before the mutation.\n` +
      `  A snapshot of the pre-probe tree is the commit ${snapshot} — recover with:\n` +
      `    git checkout ${snapshot} -- ${relative}\n` +
      (restoreError ? `  The restore itself errored: ${restoreError.message}\n` : ''),
  );
  process.exit(1);
}

// ── 5. Three outcomes, never two ─────────────────────────────────────────────────────────────────
// `spawnSync` sets `error` when the command could not be spawned at all, and a shell reports an
// unknown command as 127. Either is DID-NOT-RUN, not a gap.
if (run.error || run.status === 127) {
  fail(`the gate could not run (${run.error?.message ?? 'exit 127'}). Nothing was proved.`);
}
if (run.status === 0) {
  console.error(
    `🔴 probe: GREEN — THE ASSERTION CANNOT FAIL.\n` +
      `  ${relative} was mutated and \`${args.gate}\` still passed.\n` +
      `  A proof that cannot fail is the same defect as a test that cannot fail, one level up.`,
  );
  process.exit(1);
}
if (args.expect && !output.includes(args.expect)) {
  console.error(
    `⚠️ probe: RED, BUT NOT FOR THE NAMED REASON.\n` +
      `  The gate failed (exit ${run.status}) without printing: ${args.expect}\n` +
      `  Red for the wrong reason tells the next reader the wrong cause, which is the whole value of\n` +
      `  the message. Either the mutation hit something else, or --expect names the wrong assertion.`,
  );
  process.exit(1);
}
if (!args.expect) {
  console.warn(
    `⚠️ probe: RED (exit ${run.status}) — but no --expect was given, so this proves only that\n` +
      `  SOMETHING went red, not that the assertion you care about did.`,
  );
}
console.log(
  `✓ probe: RED — \`${args.gate}\` caught the mutation to ${relative}` +
    (args.expect ? `, on: ${args.expect}` : ''),
);
