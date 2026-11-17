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
 * - **Signals:** the gate is an async, detached child, so SIGINT/SIGTERM/SIGHUP are handled while it
 *   runs: restore first, then end the gate's whole process group, then die by the same signal.
 * - **SIGKILL** cannot be trapped: the next run (or `--recover`) restores from the journal, by the
 *   same three-state rule, and ends the orphaned gate.
 * - **At exit** every path any patch touches is byte-identical to what it was at the start.
 *
 * Usage: `node scripts/mutations.mjs` (all patches) · `node scripts/mutations.mjs --recover` (only
 * restore an interrupted run's journal, then exit).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
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
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

// ── The lock: one run per worktree ──────────────────────────────────────────────────────────────
let lockHeld = false;
function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      closeSync(fd);
      lockHeld = true;
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = null;
      try {
        holder = JSON.parse(readFileSync(LOCK, 'utf8')).pid;
      } catch {
        /* an unreadable lock is a stale one: its writer died mid-write */
      }
      if (holder && alive(holder)) {
        console.error(
          `✗ mutation gate: another db:mutations run is in flight in this worktree (pid ${holder}).\n` +
            `  Two runs in one worktree apply patches under each other's gate. Wait for it to finish.`,
        );
        process.exit(1);
      }
      unlinkSync(LOCK); // stale: its pid is gone
    }
  }
  throw new Error(`mutation gate: could not take the lock at ${LOCK}`);
}
function releaseLock() {
  if (!lockHeld) return;
  lockHeld = false;
  try {
    unlinkSync(LOCK);
  } catch {
    /* already gone: nothing to release */
  }
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
 * handler and from `exit`. Returns true when every file is back to its snapshot (and deletes the
 * journal); false, leaving the journal in place, when any file holds content that is neither.
 */
function restore(journal) {
  const unsafe = [];
  for (const f of journal.files) {
    const abs = join(REPO, f.path);
    const current = existsSync(abs) ? sha(readFileSync(abs)) : null;
    if (current === f.snapshotSha) continue;
    if (current === f.patchedSha) {
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
        `\n  The journal is kept at ${JOURNAL}. Compare each file with \`git diff\`, remove the` +
        `\n  patch's change by hand (\`git apply -R ${join(DIR, journal.patch)}\` if it still applies),` +
        `\n  then delete the journal.`,
    );
    return false;
  }
  unlinkSync(JOURNAL);
  return true;
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
/** End an orphaned gate from a SIGKILLed run, only if its pid still names a pnpm (pid reuse). */
function endOrphan(pgid) {
  if (!pgid) return;
  let command = '';
  try {
    command = execFileSync('ps', ['-o', 'command=', '-p', String(pgid)], { encoding: 'utf8' });
  } catch {
    return; // no such process
  }
  if (command.includes('pnpm')) endGroup(pgid);
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
  console.log(`✓ recovered: restored ${journal.files.map((f) => f.path).join(', ')}`);
  return true;
}

// ── Signals and crashes ─────────────────────────────────────────────────────────────────────────
let inFlight = null; // the journal of the patch currently applied
let stopping = false;
function stop(reason) {
  if (stopping) return;
  stopping = true;
  const journal = inFlight;
  inFlight = null;
  if (journal) {
    restore(journal); // restore FIRST: nothing below may throw before it
    endGroup(journal.pgid);
  }
  releaseLock();
  if (typeof reason === 'string') {
    process.removeAllListeners(reason);
    process.kill(process.pid, reason); // die by the same signal, so the shell sees 128+n
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(sig));
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (error) => {
    stop();
    console.error(error);
    process.exit(1);
  });
}
process.on('exit', () => {
  if (!stopping && inFlight) restore(inFlight);
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

async function main() {
  const recoverOnly = process.argv.includes('--recover');
  acquireLock();
  if (!recover()) process.exit(1);
  if (recoverOnly) return;

  const patches = readdirSync(DIR)
    .filter((f) => f.endsWith('.patch'))
    .sort();
  if (patches.length === 0) {
    console.error('mutation gate: no patches found — the gate would pass vacuously');
    process.exit(1);
  }

  // A patch left applied by a run that wrote no journal (an older runner, a probe, a hand edit):
  // stop before applying anything on top of it.
  const stillApplied = patches.filter((patch) => {
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
    console.error(
      `✗ mutation gate: still applied in the working tree, by an earlier run that left no journal:\n` +
        stillApplied.map((p) => `    ${p} — restore with: git apply -R ${join(DIR, p)}`).join('\n'),
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
      break; // a gate that cannot start will not start for the next patch either
    }
    inFlight = null;
    if (!restore(journal)) process.exit(1);

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
  console.log(`\n✓ mutation gate: ${patches.length} mutations, all RED`);
}

await main();
