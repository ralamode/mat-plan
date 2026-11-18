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
 * - **A stale lock is taken over by rename**, then the moved content is re-read: only the dead
 *   holder's content is discarded. Anything else is put back with `link`, never `rename`, so it can
 *   never overwrite a lock taken in the meantime.
 *
 * Best-effort, like the guards: it keeps two runs on one machine from colliding, it is not a
 * security boundary.
 */
import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ATTEMPTS = 5;

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
  writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
  return tmp;
}

/**
 * Take the lock at `path` for `payload` (which must carry `holders`). Returns `{ held: true }`, or
 * `{ held: false, holder }` with the live lock's parsed content when someone else has it.
 */
export function acquire(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
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
      // Stale: move it aside, then check that what moved is the dead lock we judged.
      const moved = `${path}.stale.${process.pid}`;
      try {
        renameSync(path, moved);
      } catch {
        continue; // another taker moved it first
      }
      const movedContent = readLock(moved);
      if (movedContent !== content && liveLock(movedContent)) {
        try {
          linkSync(moved, path); // not ours to break; link, so a newer lock is never overwritten
        } catch {
          /* a newer lock is already in place: the moved one is superseded */
        }
      }
      try {
        unlinkSync(moved);
      } catch {
        /* already gone */
      }
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
