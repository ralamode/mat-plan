#!/usr/bin/env node
/**
 * The heavy-run slot: one heavy local run at a time, machine-wide (DX-18 D3; plan:
 * docs/plans/dx-18-heavy-runs-to-ci.md).
 *
 * The slot is `~/.cache/mat-plan/heavy-slot.json`, per user, so it covers every clone and worktree on
 * the machine. It is taken INSIDE the heavy runners (`db:mutations`, `e2e:local`,
 * `screenshot:ephemeral`), so a `pnpm --filter …` form cannot go around it, and by this script's
 * wrapper for `pnpm verify`:
 *
 *   node .github/scripts/heavy-slot.mjs -- pnpm verify:run
 *
 * The wrapper records its child's process group as a second holder, so a `kill -9` of the wrapper
 * does not free the slot while the run underneath it continues. A runner started under the wrapper
 * sees `MAT_PLAN_HEAVY_SLOT_HELD`, which counts only when it equals the live lock's pid: a stray
 * `export` cannot turn the slot off.
 *
 * - Busy: exits 2 with who holds it. Push and let CI gate it, or wait.
 * - `MAT_PLAN_HEAVY_SLOT=off` skips it, for a person who knows the machine is idle.
 * - Under `CI` or `GITHUB_ACTIONS` it does nothing: a runner has one job.
 * - `MAT_PLAN_HEAVY_SLOT_PATH` moves the lock; the self-tests use it, so they never touch a live slot.
 */
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { acquire, holder, liveLock, readLock, release, rewrite } from './pid-lock.mjs';

export const SLOT_BUSY_EXIT = 2;

export function slotPath() {
  return (
    process.env.MAT_PLAN_HEAVY_SLOT_PATH || join(homedir(), '.cache', 'mat-plan', 'heavy-slot.json')
  );
}

const clean = (text, max) =>
  String(text)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, max);

function lane() {
  try {
    return clean(
      execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
      80,
    );
  } catch {
    return 'unknown lane';
  }
}

function skipped() {
  if (process.env.CI || process.env.GITHUB_ACTIONS) return true;
  if (process.env.MAT_PLAN_HEAVY_SLOT === 'off') {
    console.error('▸ heavy-run slot: skipped (MAT_PLAN_HEAVY_SLOT=off)');
    return true;
  }
  return false;
}

/** Already inside a run that holds the slot: HELD names the live lock's own pid. */
function nested(path) {
  const held = process.env.MAT_PLAN_HEAVY_SLOT_HELD;
  if (!held) return false;
  const live = liveLock(readLock(path));
  return Boolean(live) && String(live.pid) === held;
}

const NOOP = { release() {}, payload: null };

/**
 * Take the slot for this process, or exit 2 when another run holds it. Returns a handle whose
 * `release()` frees it; it is also released at exit. A no-op under CI, when bypassed, or when this
 * process runs under a holder of the slot.
 */
export function takeSlot(command) {
  const path = slotPath();
  if (skipped() || nested(path)) return NOOP;
  const payload = {
    pid: process.pid,
    lane: lane(),
    command: clean(command, 200),
    startedAt: new Date().toISOString(),
    holders: [holder(process.pid)],
  };
  const result = acquire(path, payload);
  if (!result.held) {
    const h = result.holder;
    console.error(
      `✗ heavy-run slot held by ${clean(h.lane ?? 'unknown lane', 80)} ` +
        `(${clean(h.command ?? '?', 200)}, since ${clean(h.startedAt ?? '?', 40)}). ` +
        'Push and let CI gate it, or wait.',
    );
    process.exit(SLOT_BUSY_EXIT);
  }
  let released = false;
  const handle = {
    payload,
    release() {
      if (released) return;
      released = true;
      release(path, payload);
    },
  };
  process.on('exit', () => handle.release());
  return handle;
}

/** `heavy-slot.mjs -- <command…>`: run the command holding the slot, and pass its exit through. */
function cli(argv) {
  const at = argv.indexOf('--');
  const command = at >= 0 ? argv.slice(at + 1) : argv;
  if (command.length === 0) {
    console.error('usage: node .github/scripts/heavy-slot.mjs -- <command> [args…]');
    process.exit(64);
  }
  const slot = takeSlot(command.join(' '));
  // Its own process group, so the group can be recorded as a holder and signalled as one; async, so
  // the signal handlers below run while it does (a spawnSync blocks every handler, lessons.md).
  const child = spawn(command[0], command.slice(1), {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    env: slot.payload
      ? { ...process.env, MAT_PLAN_HEAVY_SLOT_HELD: String(process.pid) }
      : process.env,
  });
  if (slot.payload && child.pid) {
    slot.payload.holders.push(holder(child.pid, { group: true }));
    rewrite(slotPath(), slot.payload);
  }
  const forward = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* the group has already gone */
    }
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, () => forward(signal));
  child.on('error', (error) => {
    console.error(`✗ ${command[0]}: ${error.message}`);
    slot.release();
    process.exit(127);
  });
  child.on('close', (code, signal) => {
    slot.release();
    if (signal) {
      for (const s of signals) process.removeAllListeners(s);
      process.kill(process.pid, signal); // die by the same signal, so the shell sees 128+n
      return;
    }
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli(process.argv.slice(2));
}
