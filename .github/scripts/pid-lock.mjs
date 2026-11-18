/**
 * One lock file, held by a set of live processes (DX-18 D3; plan: docs/plans/dx-18-heavy-runs-to-ci.md).
 *
 * The heavy-run slot (`heavy-slot.mjs`) is built on it; `db:mutations`' per-worktree lock moves onto
 * it in DX-18 PR 2, so there is one implementation of the three rules below.
 *
 * - **Created with its content.** The payload goes to a private temp file, then `linkSync(tmp, lock)`,
 *   which fails if the lock exists. No reader ever sees an empty lock.
 * - **A holder is alive** when its pid answers `kill(pid, 0)` (or `EPERM`) AND its start time
 *   (`ps -o lstart=`) is the one recorded, so a reused pid counts as dead. A `group` holder is a
 *   process group: it is alive while any member is, because a pid is never reused while a group of
 *   that id exists; when its leader is still running, the leader's start time must match too.
 * - **A stale lock is cleared only under a steal guard** (`<lock>.steal`, taken with the same
 *   link-from-temp). Under it the lock is re-read, and removed only if it is still dead: no one else
 *   can replace a lock that exists, and only the guard's holder removes one, so a fresh lock is never
 *   removed. (The plan's steal-by-rename lost a fresh lock when three takers raced over a stale one;
 *   the race case in `heavy-slot.test.sh` caught it.) A guard left by a crashed stealer is removed
 *   when its holder is dead.
 *
 * Best-effort, like the guards: it keeps two runs on one machine from colliding, it is not a
 * security boundary.
 */
import { execFileSync } from 'node:child_process';
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

const ATTEMPTS = 200;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The process's start time as `ps` reports it, or null when it is gone. */
export function startTime(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null; // ps exits 1 for a pid that is not running
  }
}

function signalled(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** A holder record for `pid`: `{ pid, start }`, plus `group: true` for its process group. */
export function holder(pid, { group = false } = {}) {
  return { pid, start: startTime(pid), ...(group ? { group: true } : {}) };
}

export function holderAlive(h) {
  if (!h || !Number.isInteger(h.pid) || h.pid < 2) return false;
  if (h.group) {
    if (!signalled(-h.pid)) return false;
    // The group exists. A live leader must be the one recorded; a dead leader with live members is
    // still this group, because its id cannot be handed to a new process while the group exists.
    return signalled(h.pid) ? startTime(h.pid) === h.start : true;
  }
  return signalled(h.pid) && startTime(h.pid) === h.start;
}

/** The parsed lock, or null when it is unreadable or every holder is gone. */
export function liveLock(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const holders = Array.isArray(parsed?.holders) ? parsed.holders : [];
  return holders.some(holderAlive) ? parsed : null;
}

export function readLock(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function writePrivate(path, payload) {
  const tmp = `${path}.${process.pid}.tmp`;
  // Exclusive and fresh: a leftover from a killed run with a reused pid is removed first, and `wx`
  // (O_EXCL) never follows a symlink planted at the name, so the file really is private.
  rmSync(tmp, { force: true });
  writeFileSync(tmp, JSON.stringify(payload), { flag: 'wx', mode: 0o600 });
  return tmp;
}

/**
 * Take the lock at `path` for `payload` (which must carry `holders`). Returns `{ held: true }`, or
 * `{ held: false, holder }` with the live lock's parsed content when someone else has it.
 */
export function acquire(path, payload) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = writePrivate(path, payload);
  try {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      try {
        linkSync(tmp, path);
        return { held: true };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const content = readLock(path);
      if (content === null) continue; // released between our link and our read
      const live = liveLock(content);
      if (live) return { held: false, holder: live };
      clearIfStale(path, payload);
    }
    throw new Error(`could not take the lock at ${path}; delete it if no run is live`);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* the temp file is only the link's source */
    }
  }
}

/** Remove the lock at `path` if it is still dead, holding the steal guard; else wait a moment. */
function clearIfStale(path, payload) {
  const guard = `${path}.steal`;
  const tmp = writePrivate(guard, { pid: process.pid, holders: payload.holders });
  try {
    linkSync(tmp, guard);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const held = readLock(guard);
    if (held !== null && !liveLock(held) && readLock(guard) === held) unlinkSync(guard); // crashed
    sleepSync(10);
    return;
  } finally {
    unlinkSync(tmp);
  }
  try {
    const now = readLock(path);
    if (now !== null && !liveLock(now)) unlinkSync(path);
  } finally {
    unlinkSync(guard);
  }
}

/** Is the lock at `path` ours: same first holder pid and start time as `payload`? */
function ours(path, payload) {
  const content = readLock(path);
  if (content === null) return false;
  try {
    const mine = payload.holders[0];
    const theirs = JSON.parse(content).holders?.[0];
    return theirs?.pid === mine.pid && theirs?.start === mine.start;
  } catch {
    return false;
  }
}

/** Replace a lock we hold with new content (e.g. a holder added after a spawn). */
export function rewrite(path, payload) {
  if (!ours(path, payload)) return false;
  renameSync(writePrivate(path, payload), path);
  return true;
}

/** Release a lock we hold. Never removes a lock someone else has taken since. */
export function release(path, payload) {
  if (!ours(path, payload)) return;
  try {
    unlinkSync(path);
  } catch {
    /* already gone: nothing to release */
  }
}
