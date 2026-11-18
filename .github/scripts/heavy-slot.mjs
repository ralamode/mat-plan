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
 * - **How many:** `HEAVY_SLOTS_DEFAULT` (1) at once; `MAT_PLAN_HEAVY_SLOTS=<n>` allows more on a machine
 *   that has the headroom (the maintainer, 2026-11-17: more than one suite is fine while the machine
 *   is on power and has resources). Slot 1 is the path below; slot k is `heavy-slot.k.json` beside it.
 * - Busy: exits 2 naming every holder and the load average. Push and let CI gate it, or wait.
 * - `MAT_PLAN_HEAVY_SLOT=off` skips it, for a person who knows the machine is idle.
 * - Under `CI` or `GITHUB_ACTIONS` it does nothing: a runner has one job.
 * - `MAT_PLAN_HEAVY_SLOT_PATH` moves the lock; the self-tests use it, so they never touch a live slot.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpus, homedir, loadavg } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { acquire, holder, liveLock, readLock, release, rewrite } from './pid-lock.mjs';

export const SLOT_BUSY_EXIT = 2;
/** Heavy local runs allowed at once, unless `MAT_PLAN_HEAVY_SLOTS` says otherwise. */
export const HEAVY_SLOTS_DEFAULT = 1;

export function slotCount() {
  const raw = process.env.MAT_PLAN_HEAVY_SLOTS;
  if (raw === undefined || raw === '') return HEAVY_SLOTS_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 16) {
    console.error(
      `✗ MAT_PLAN_HEAVY_SLOTS must be a whole number from 1 to 16, got: ${clean(raw, 20)}`,
    );
    process.exit(64);
  }
  return n;
}

/** Slot k's lock (1-based). Slot 1 is `MAT_PLAN_HEAVY_SLOT_PATH` or `~/.cache/mat-plan/heavy-slot.json`. */
export function slotPath(k = 1) {
  const override = process.env.MAT_PLAN_HEAVY_SLOT_PATH;
  // Resolved, so a relative override cannot quietly make the slot per-directory.
  const first = override
    ? isAbsolute(override)
      ? override
      : resolve(override)
    : join(homedir(), '.cache', 'mat-plan', 'heavy-slot.json');
  return k === 1 ? first : first.replace(/(\.json)?$/, `.${k}$1`);
}

const clean = (text, max) =>
  String(text)
    // C0, DEL, C1 (an 8-bit CSI is U+009B) and the bidi overrides: printed into another lane's terminal.
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
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

/** `CI=false` or `CI=0` is a common export on a laptop; it must not silently turn the slot off. */
const set = (name) => !['', '0', 'false'].includes((process.env[name] ?? '').toLowerCase());

function skipped() {
  if (set('CI') || set('GITHUB_ACTIONS')) {
    console.error('▸ heavy-run slot: skipped (CI)');
    return true;
  }
  if (process.env.MAT_PLAN_HEAVY_SLOT === 'off') {
    console.error('▸ heavy-run slot: skipped (MAT_PLAN_HEAVY_SLOT=off)');
    return true;
  }
  return false;
}

/** Already inside a run that holds a slot: HELD names a live slot lock's own pid. */
function nested(count) {
  const held = process.env.MAT_PLAN_HEAVY_SLOT_HELD;
  if (!held) return false;
  for (let k = 1; k <= count; k += 1) {
    const live = liveLock(readLock(slotPath(k)));
    if (live && String(live.pid) === held) return true;
  }
  return false;
}

function describe(h) {
  return (
    `${clean(h.lane ?? 'unknown lane', 80)} ` +
    `(${clean(h.command ?? '?', 200)}, since ${clean(h.startedAt ?? '?', 40)})`
  );
}

const NOOP = { release() {}, payload: null };

/**
 * Take the slot for this process, or exit 2 when another run holds it. Returns a handle whose
 * `release()` frees it; it is also released at exit. A no-op under CI, when bypassed, or when this
 * process runs under a holder of the slot.
 */
export function takeSlot(command) {
  if (skipped()) return NOOP;
  const count = slotCount();
  if (nested(count)) return NOOP;
  const payload = {
    pid: process.pid,
    lane: lane(),
    command: clean(command, 200),
    startedAt: new Date().toISOString(),
    holders: [holder(process.pid)],
  };
  const busy = [];
  let path = null;
  for (let k = 1; k <= count && !path; k += 1) {
    const result = acquire(slotPath(k), payload);
    if (result.held) path = slotPath(k);
    else busy.push(result.holder);
  }
  if (!path) {
    const load = loadavg()
      .map((n) => n.toFixed(2))
      .join(' ');
    const slots = count === 1 ? 'heavy-run slot' : `all ${count} heavy-run slots`;
    console.error(
      `✗ ${slots} held by ${busy.map(describe).join('; ')}. ` +
        'Push and let CI gate it, or wait.\n' +
        `  load average ${load} on ${cpus().length} cores` +
        (count === 1
          ? '; MAT_PLAN_HEAVY_SLOTS=<n> allows more when the machine has the headroom.'
          : '.'),
    );
    process.exit(SLOT_BUSY_EXIT);
  }
  let released = false;
  const handle = {
    payload,
    path,
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
    // Without the slot (CI, bypass, nested) the wrapper is a plain pass-through.
    stdio: slot.payload ? ['ignore', 'inherit', 'inherit'] : 'inherit',
    detached: Boolean(slot.payload),
    env: slot.payload
      ? { ...process.env, MAT_PLAN_HEAVY_SLOT_HELD: String(process.pid) }
      : process.env,
  });
  if (slot.payload && child.pid) {
    slot.payload.holders.push(holder(child.pid, { group: true }));
    rewrite(slot.path, slot.payload);
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
