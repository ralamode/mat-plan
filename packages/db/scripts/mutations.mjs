#!/usr/bin/env node
/**
 * The `db:verify` mutation gate (TEN-1 1b, the plan's R5 mitigation 2).
 *
 * For each committed patch in `scripts/mutations/`: `git apply` it, run `db:verify`, assert a
 * **non-zero** exit on the patch's expected assertion, and restore the patched files. A patch that
 * leaves `db:verify` green is a patch whose assertions were proving nothing — which, for a BOLA
 * predicate, is strictly worse than having no test, because it is counted as coverage.
 *
 * Patch files, never a runtime flag: a switch that can disable the household conjunct must not exist
 * in shipped `packages/db` source. See `scripts/mutations/README.md` for what each one must redden.
 *
 * 🔴 **It edits tracked source while it runs, so it must never leave an edit behind** (a killed run
 * left patch 153 in `writers/practice.ts` and patch 150 in a commit, 2026-11-17; plan:
 * `docs/plans/dx-mutations-kill-safe.md`):
 *
 * - **One run per worktree:** a lock in the worktree's git dir; a second run refuses while the first
 *   is alive, and only a lock whose pid is gone is treated as stale.
 * - **A journal before every apply** (same git dir, written then renamed): the patched paths, their
 *   pre-patch bytes and hash, the patched hash, and the gate's process group.
 * - **Restore by hash, three states:** a file equal to its snapshot is left alone; a file equal to
 *   the patched bytes gets the snapshot written back and re-hashed; ANY other content (someone edited
 *   it meanwhile) is never touched: the run fails and the journal stays, with the recovery command.
 *   Never from `HEAD`, so uncommitted work in a patched file survives.
 * - **Signals:** the gate is an async, detached child, so SIGINT/SIGTERM/SIGHUP/SIGQUIT are handled while it
 *   runs: restore first, then end the gate's whole process group, then die by the same signal.
 * - **SIGKILL** cannot be trapped: the next run (or `--recover`) restores from the journal, by the
 *   same three-state rule, and ends the orphaned gate.
 * - **At exit** every path any patch touches is byte-identical to what it was at the start.
 * - **The heavy-run slot** (DX-18 D3, `.github/scripts/heavy-slot.mjs`) is taken first: one heavy
 *   local run machine-wide. `--recover` does not take it.
 *
 * Usage: `node scripts/mutations.mjs` (all patches) · `--recover` (only restore an interrupted run's
 * journal, then exit) · `--only 271-278` or `--only <text>` (some patches) · `--shard i/n` (CI: every
 * n-th patch from i, 0-based) · `--report <file>` (write what ran, as JSON) · `--list` (print the
 * selection, run nothing) · `--list-paths` (every path any patch touches, for `changed-scopes.mjs`) ·
 * `--verify-reports <dir>` (CI: the shards' reports ran every patch exactly once). DX-18 D6.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { takeSlot } from '../../../.github/scripts/heavy-slot.mjs';
import { acquire, holder, release } from '../../../.github/scripts/pid-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const DIR = join(HERE, 'mutations');
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: HERE,
  encoding: 'utf8',
}).trim();

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const gitPath = (name) => resolve(REPO, git('rev-parse', '--git-path', name).trim());
const LOCK = gitPath('mat-plan-mutations.lock');
const JOURNAL = gitPath('mat-plan-mutations-inflight.json');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const shaOf = (rel) => sha(readFileSync(join(REPO, rel)));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ── The lock: one run per worktree (on the shared helper, `.github/scripts/pid-lock.mjs`) ──────────
let lockPayload = null;
function acquireLock() {
  const payload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    holders: [holder(process.pid)],
  };
  const result = acquire(LOCK, payload);
  if (!result.held) {
    console.error(
      `✗ mutation gate: another db:mutations run is in flight in this worktree (pid ${result.holder.pid}).\n` +
        `  Two runs in one worktree apply patches under each other's gate. Wait for it to finish\n` +
        `  (its lock: ${LOCK}).`,
    );
    process.exit(1);
  }
  lockPayload = payload;
}
function releaseLock() {
  if (!lockPayload) return;
  const payload = lockPayload;
  lockPayload = null;
  release(LOCK, payload);
}

// ── The journal ─────────────────────────────────────────────────────────────────────────────────
function writeJournal(journal) {
  const tmp = `${JOURNAL}.tmp`;
  writeFileSync(tmp, JSON.stringify(journal));
  renameSync(tmp, JOURNAL);
}
function readJournal() {
  return existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, 'utf8')) : null;
}

/**
 * Restore every file in `journal` by the three-state rule. Synchronous, so it is safe from a signal
 * handler and from `exit`. Returns true when every file is back to its snapshot; false when any file
 * holds content that is neither (it is left as it is). The CALLER deletes the journal, after ending
 * the gate, so a kill in between still leaves the gate's group recorded.
 *
 * A MISSING file counts as the patched state: `git apply` replaces a file by removing it and writing
 * a new one, so a kill in that instant leaves no file at all, and no patch here deletes a file (one
 * that would is refused before it runs).
 */
function restore(journal) {
  const unsafe = [];
  for (const f of journal.files) {
    const abs = join(REPO, f.path);
    const current = existsSync(abs) ? sha(readFileSync(abs)) : null;
    if (current === f.snapshotSha) continue;
    if (current === null || current === f.patchedSha) {
      writeFileSync(abs, Buffer.from(f.snapshot, 'base64'));
      if (shaOf(f.path) !== f.snapshotSha) unsafe.push(`${f.path} (the write-back did not verify)`);
    } else {
      unsafe.push(`${f.path} (edited since the patch was applied: left as it is)`);
    }
  }
  if (unsafe.length > 0) {
    console.error(
      `✗ mutation gate: could not safely restore after ${journal.patch}:\n` +
        unsafe.map((u) => `    ${u}`).join('\n') +
        `\n  The journal is kept at ${JOURNAL}: it holds each file's PRE-PATCH bytes` +
        `\n  (files[].snapshot, base64), which may be the only copy of uncommitted work. Do not delete it` +
        `\n  unread. Compare each file with \`git diff\`, remove the patch's change by hand` +
        `\n  (\`git apply -R ${join(DIR, journal.patch)}\` if it still applies), then delete the journal.`,
    );
    return false;
  }
  return true;
}
function clearJournal() {
  try {
    unlinkSync(JOURNAL);
  } catch {
    /* already gone */
  }
}
/**
 * The hash each file WILL have once `patch` is applied, computed before the tree is touched: the
 * patch is applied to a copy of the snapshot in a scratch directory outside the repository. So the
 * journal holds both hashes before `git apply` runs, and a kill at any instant leaves a journal that
 * can tell "patched" from "edited by someone else".
 */
function patchedHashes(patch, files) {
  const scratch = mkdtempSync(join(tmpdir(), 'mat-plan-mutation-'));
  try {
    for (const f of files) {
      mkdirSync(dirname(join(scratch, f.path)), { recursive: true });
      writeFileSync(join(scratch, f.path), Buffer.from(f.snapshot, 'base64'));
    }
    execFileSync('git', ['apply', join(DIR, patch)], { cwd: scratch, stdio: 'pipe' });
    return files.map((f) => sha(readFileSync(join(scratch, f.path))));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** End a detached gate's whole process group: TERM, up to ~2 s, then KILL. Best-effort. */
function endGroup(pgid) {
  if (!pgid) return;
  const signal = (s) => {
    try {
      process.kill(-pgid, s);
      return true;
    } catch {
      return false; // ESRCH: the group is already gone
    }
  };
  if (!signal('SIGTERM')) return;
  for (let waited = 0; waited < 2000 && signal(0); waited += 100) sleepSync(100);
  signal('SIGKILL');
}
/**
 * End an orphaned gate from a SIGKILLed run. Probes the GROUP, not its leader (the pnpm leader may be
 * gone while tsx or node live on), and ends it only if a member's command still names `db:verify` or
 * the gate's tooling, so a reused pgid belonging to something else is left alone.
 */
function endOrphan(pgid) {
  if (!pgid) return;
  try {
    process.kill(-pgid, 0);
  } catch {
    return; // the group is gone
  }
  let table = '';
  try {
    table = execFileSync('ps', ['-A', '-o', 'pgid=,command='], { encoding: 'utf8' });
  } catch {
    return;
  }
  const members = table
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter((m) => m && Number(m[1]) === pgid)
    .map((m) => m[2]);
  if (members.some((c) => /db:verify|pnpm|tsx|verify\.ts/.test(c))) endGroup(pgid);
}

// ── Recovery: an interrupted run's journal ──────────────────────────────────────────────────────
function recover() {
  const journal = readJournal();
  if (!journal) return true;
  console.log(
    `⚠ mutation gate: ${journal.patch} was left in flight by an interrupted run; recovering`,
  );
  endOrphan(journal.pgid);
  if (!restore(journal)) return false;
  clearJournal();
  console.log(`✓ recovered: restored ${journal.files.map((f) => f.path).join(', ')}`);
  return true;
}

// ── Signals and crashes ─────────────────────────────────────────────────────────────────────────
let inFlight = null; // the journal of the patch currently applied
let stopping = false;
let slot = null; // the machine-wide heavy-run slot (DX-18 D3); `--recover` is not a heavy run
function stop(reason) {
  if (stopping) return;
  stopping = true;
  const journal = inFlight;
  inFlight = null;
  if (journal) {
    const restored = restore(journal); // restore FIRST: nothing below may throw before it
    endGroup(journal.pgid);
    if (restored) clearJournal(); // only now: until the group is ended, the journal names it
  }
  releaseLock();
  slot?.release(); // dying by a signal skips 'exit', where the slot is otherwise released
  if (typeof reason === 'string') {
    process.removeAllListeners(reason);
    process.kill(process.pid, reason); // die by the same signal, so the shell sees 128+n
  }
}
// SIGQUIT too: Node does not handle it, so untrapped it ends the run like SIGKILL, patch applied.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) process.on(sig, () => stop(sig));
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (error) => {
    stop();
    console.error(error);
    process.exit(1);
  });
}
process.on('exit', () => {
  if (!stopping && inFlight && restore(inFlight)) clearJournal();
  releaseLock();
});

// ── The gate ────────────────────────────────────────────────────────────────────────────────────
function runGate(onSpawn) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('pnpm', ['db:verify'], {
      cwd: PKG,
      detached: true, // its own process group, so the whole tree can be ended together
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    // Decoded as streams, so a multi-byte character split across two chunks is not mangled (40 of
    // the .expect lines hold non-ASCII).
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject); // ENOENT: the gate never ran
    child.on('close', (status, signal) => resolvePromise({ status, signal, stdout, stderr }));
    if (child.pid) onSpawn(child.pid);
  });
}

function touchedPaths(path) {
  return git('apply', '--numstat', '-z', path)
    .split('\0')
    .filter(Boolean)
    .map((line) => line.split('\t').slice(2).join('\t'));
}

// ── Which patches a run takes (DX-18 D6) ──────────────────────────────────────────────────────────
/** Every committed patch, by file name, in the one order every selection and shard is cut from. */
export function allPatches(dir = DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.patch'))
    .sort();
}

/**
 * The patches `--only <spec>` names: a number (`288`) or an inclusive range (`271-278`) of the
 * leading number, or else any patch whose name contains the text.
 */
export function selectOnly(patches, spec) {
  const range = /^(\d+)(?:-(\d+))?$/.exec(spec);
  if (!range) return patches.filter((p) => p.includes(spec));
  const [lo, hi] = [Number(range[1]), Number(range[2] ?? range[1])];
  return patches.filter((p) => {
    const n = Number(/^(\d+)/.exec(p)?.[1]);
    return n >= lo && n <= hi;
  });
}

/**
 * Shard `index` of `total` (0-based, as `strategy.job-index` is): every `total`-th patch from
 * `index`, so each shard gets a spread of the directory rather than one block of numbers.
 */
export function selectShard(patches, index, total) {
  return patches.filter((_, i) => i % total === index);
}

function parseShard(value) {
  const m = /^(\d+)\/(\d+)$/.exec(value ?? '');
  const [index, total] = m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
  if (!(total >= 1 && index >= 0 && index < total)) {
    console.error(`✗ mutation gate: --shard takes i/n with 0 <= i < n, got ${value}`);
    process.exit(1);
  }
  return { index, total };
}

function flag(name) {
  const at = process.argv.indexOf(name);
  if (at === -1) return undefined;
  const value = process.argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`✗ mutation gate: ${name} needs a value`);
    process.exit(1);
  }
  return value;
}

/**
 * `--verify-reports <dir>`: the shards' `--report` files, read together. Exit 0 only when they name
 * one shard count, every shard of it once, and every committed patch exactly once across them.
 */
function verifyReports(dir) {
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.json'));
  const reports = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const problems = [];
  const totals = new Set(reports.map((r) => r.total));
  if (reports.length === 0) problems.push('no shard reports were found');
  if (totals.size > 1) problems.push(`the reports disagree on the shard count: ${[...totals]}`);
  const total = reports[0]?.total;
  const shards = reports.map((r) => r.index).sort((x, y) => x - y);
  const wantShards = Array.from({ length: total ?? 0 }, (_, i) => i);
  if (JSON.stringify(shards) !== JSON.stringify(wantShards)) {
    problems.push(`shards reported: [${shards}], expected [${wantShards}]`);
  }
  const ran = reports.flatMap((r) => r.patches);
  const all = allPatches();
  const twice = ran.filter((p, i) => ran.indexOf(p) !== i);
  const missing = all.filter((p) => !ran.includes(p));
  const unknown = ran.filter((p) => !all.includes(p));
  if (twice.length) problems.push(`run more than once: ${[...new Set(twice)].join(', ')}`);
  if (missing.length) problems.push(`never run: ${missing.join(', ')}`);
  if (unknown.length) problems.push(`not a committed patch: ${unknown.join(', ')}`);
  if (problems.length) {
    console.error(
      `✗ mutation gate: the shards did not run every patch exactly once:\n    ${problems.join('\n    ')}`,
    );
    process.exit(1);
  }
  console.log(`✓ mutation gate: ${total} shards ran all ${all.length} patches, each exactly once`);
}

async function main() {
  // Read-only modes first: none of them applies a patch, so none takes the slot or the lock.
  if (process.argv.includes('--list-paths')) {
    const paths = new Set(allPatches().flatMap((p) => touchedPaths(join(DIR, p))));
    for (const path of [...paths].sort()) console.log(path);
    return;
  }
  const reportsDir = flag('--verify-reports');
  if (reportsDir !== undefined) return verifyReports(reportsDir);

  const only = flag('--only');
  const shardFlag = flag('--shard');
  const shard = shardFlag === undefined ? null : parseShard(shardFlag);
  const reportPath = flag('--report');
  let selected = allPatches();
  if (only !== undefined) selected = selectOnly(selected, only);
  if (shard) selected = selectShard(selected, shard.index, shard.total);
  if (process.argv.includes('--list')) {
    for (const p of selected) console.log(p);
    return;
  }

  const recoverOnly = process.argv.includes('--recover');
  if (!recoverOnly) slot = takeSlot('db:mutations');
  acquireLock();
  if (!recover()) process.exit(1);
  if (recoverOnly) return;

  const patches = selected;
  if (patches.length === 0) {
    console.error(
      only !== undefined || shard
        ? `mutation gate: no patch matches${only !== undefined ? ` --only ${only}` : ''}${shard ? ` --shard ${shardFlag}` : ''} — the gate would pass vacuously`
        : 'mutation gate: no patches found — the gate would pass vacuously',
    );
    process.exit(1);
  }

  // A patch left applied by a run that wrote no journal (an older runner, a probe, a hand edit):
  // stop before applying anything on top of it.
  // Every committed patch, not only this run's selection: one left in the tree breaks the others too.
  const stillApplied = allPatches().filter((patch) => {
    const path = join(DIR, patch);
    try {
      git('apply', '--check', path);
      return false;
    } catch {
      try {
        git('apply', '-R', '--check', path);
        return true;
      } catch {
        return false; // neither way: reported as "does not apply" below
      }
    }
  });
  if (stillApplied.length > 0) {
    const lines = stillApplied.map((p) => {
      const paths = touchedPaths(join(DIR, p));
      let committed = false;
      try {
        git('diff', '--quiet', 'HEAD', '--', ...paths);
        committed = true; // no difference from HEAD: the commit itself carries the mutation
      } catch {
        /* differs from HEAD: the mutation is uncommitted */
      }
      return committed
        ? `    still applied: ${p} — and COMMITTED (HEAD carries it): revert it in a new commit`
        : `    still applied: ${p} — restore with: git apply -R ${join(DIR, p)}`;
    });
    console.error(
      `✗ mutation gate: a patch is already in the tree (a probe, a hand edit, or a run that left no\n` +
        `  journal); nothing was applied on top of it:\n` +
        lines.join('\n'),
    );
    process.exit(1);
  }

  // Every path any patch touches, hashed now and re-checked at the end.
  const watched = new Map();
  for (const patch of patches) {
    for (const rel of touchedPaths(join(DIR, patch))) {
      if (!watched.has(rel) && existsSync(join(REPO, rel))) watched.set(rel, shaOf(rel));
    }
  }

  let failed = 0;
  for (const patch of patches) {
    const path = join(DIR, patch);
    try {
      git('apply', '--check', path);
    } catch {
      console.error(`✗ ${patch}: does not apply — regenerate it (see mutations/README.md)`);
      failed += 1;
      continue;
    }
    // Creations, deletions, renames and mode changes are not restorable by bytes: none exists today,
    // so refuse one rather than half-handle it.
    if (git('apply', '--summary', path).trim() !== '') {
      console.error(`✗ ${patch}: creates, deletes, renames or re-modes a file — not supported`);
      failed += 1;
      continue;
    }
    const files = touchedPaths(path).map((rel) => {
      const bytes = readFileSync(join(REPO, rel));
      return {
        path: rel,
        snapshot: bytes.toString('base64'),
        snapshotSha: sha(bytes),
        patchedSha: null,
      };
    });
    patchedHashes(patch, files).forEach((h, i) => (files[i].patchedSha = h));
    const journal = { patch, pgid: null, files };
    writeJournal(journal); // BEFORE the apply: a kill from here on leaves a recoverable journal
    inFlight = journal;
    git('apply', path);
    const off = files.filter((f) => shaOf(f.path) !== f.patchedSha);
    if (off.length > 0) {
      throw new Error(
        `${patch}: applied bytes differ from the precomputed ones (${off.map((f) => f.path)})`,
      );
    }

    let run;
    try {
      run = await runGate((pid) => {
        journal.pgid = pid;
        writeJournal(journal);
      });
    } catch (error) {
      console.error(`✗ ${patch}: DID-NOT-RUN — the gate could not start (${error.message})`);
      failed += 1;
      inFlight = null;
      if (!restore(journal)) process.exit(1);
      clearJournal();
      break; // a gate that cannot start will not start for the next patch either
    }
    inFlight = null;
    if (!restore(journal)) process.exit(1);
    clearJournal();

    if (run.status === 0) {
      console.error(
        `✗ ${patch}: db:verify STAYED GREEN under this mutation — the proofs it should break are vacuous`,
      );
      failed += 1;
      continue;
    }
    const why =
      (run.stderr || run.stdout || '').match(/AssertionError[^\n]*\n?[^\n]*/)?.[0] ??
      (run.signal ? `killed by ${run.signal}` : `exit ${run.status}`);
    const summary = why.replace(/\s+/g, ' ').trim();
    // The patch's `.expect` file names the assertion that must be the FIRST to fail. Without this
    // the runner only proved "something went red", so two patches breaking the same assertion were
    // indistinguishable — and a patch's reason for existing (03: the first failure is a 1c one) was
    // asserted in four documents and checked by nothing. A gate that cannot tell which proof it
    // broke is the vacuity this directory exists to catch, pointed at itself.
    const expectPath = join(DIR, patch.replace(/\.patch$/, '.expect'));
    const expected = existsSync(expectPath) ? readFileSync(expectPath, 'utf8').trim() : '';
    if (expected && !summary.includes(expected)) {
      console.error(
        `✗ ${patch}: RED, but on the WRONG assertion.\n    expected first failure: ${expected}\n    got:                    ${summary.slice(0, 200)}`,
      );
      failed += 1;
    } else {
      console.log(`✓ ${patch}: RED (expected) — ${summary.slice(0, 160)}`);
    }
  }

  const changed = [...watched].filter(
    ([rel, before]) => !existsSync(join(REPO, rel)) || shaOf(rel) !== before,
  );
  if (changed.length > 0) {
    console.error(
      `✗ mutation gate: these files are not byte-identical to how the run found them:\n` +
        changed.map(([rel]) => `    ${rel}`).join('\n'),
    );
    process.exit(1);
  }
  if (failed > 0) {
    console.error(`\nmutation gate: ${failed} of ${patches.length} patches did not do their job`);
    process.exit(1);
  }
  if (reportPath) {
    // What this shard ran, for the CI job that checks the shards together (`--verify-reports`).
    writeFileSync(
      reportPath,
      JSON.stringify({ index: shard?.index ?? 0, total: shard?.total ?? 1, patches }) + '\n',
    );
  }
  console.log(`\n✓ mutation gate: ${patches.length} mutations, all RED`);
}

await main();
