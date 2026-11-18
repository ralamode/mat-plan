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
 * - **How many:** `HEAVY_SLOTS_DEFAULT` (1) at once, unless the machine allows more (the maintainer,
 *   2026-11-17: more than one suite is fine while the machine is on power and has resources). In
 *   order: `MAT_PLAN_HEAVY_SLOTS=<n>` for one shell; else the machine file `heavy-slots` beside the
 *   lock (one number, read on every take, so one edit reaches every session:
 *   `echo 3 > ~/.cache/mat-plan/heavy-slots`; delete it to go back to 1); else the default.
 *   Slot 1 is the path below; slot k is `heavy-slot.k.json` beside it.
 * - Busy: exits 2 naming every holder and the load average. Push and let CI gate it, or wait.
 * - `MAT_PLAN_HEAVY_SLOT=off` skips it, for a person who knows the machine is idle.
 * - Under `CI` or `GITHUB_ACTIONS` it does nothing: a runner has one job.
 * - `MAT_PLAN_HEAVY_SLOT_PATH` moves the lock; the self-tests use it, so they never touch a live slot.
 */
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants, cpus, homedir, loadavg } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { acquire, holder, liveLock, readLock, release, rewrite } from './pid-lock.mjs';

export const SLOT_BUSY_EXIT = 2;
/** Heavy local runs allowed at once, unless `MAT_PLAN_HEAVY_SLOTS` says otherwise. */
export const HEAVY_SLOTS_DEFAULT = 1;
/** The most slots a count may allow; nesting checks all of them, whatever the count is now. */
export const MAX_SLOTS = 16;

/** The machine-wide count file: one number, beside the slot locks. */
export function slotCountFile() {
  return join(dirname(slotPath(1)), 'heavy-slots');
}

function parseCount(raw, source) {
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) {
    console.error(
      `✗ ${source} must be a whole number from 1 to ${MAX_SLOTS}, got: ${clean(raw, 20)}`,
    );
    process.exit(64);
  }
  return n;
}

/** The env var for one shell, else the machine file, else the default. */
export function slotCount() {
  const env = process.env.MAT_PLAN_HEAVY_SLOTS;
  if (env !== undefined && env !== '') return parseCount(env, 'MAT_PLAN_HEAVY_SLOTS');
  let file;
  try {
    file = readFileSync(slotCountFile(), 'utf8').slice(0, 64);
  } catch (error) {
    if (error.code === 'ENOENT') return HEAVY_SLOTS_DEFAULT;
    console.error(`✗ could not read ${slotCountFile()}: ${error.code ?? error.message}`);
    process.exit(64);
  }
  return file.trim() === '' ? HEAVY_SLOTS_DEFAULT : parseCount(file, slotCountFile());
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
function nested() {
  const held = process.env.MAT_PLAN_HEAVY_SLOT_HELD;
  if (!held) return false;
  // Every possible slot, not 1..count: the machine file can be lowered while a run holds slot 2.
  for (let k = 1; k <= MAX_SLOTS; k += 1) {
    const live = liveLock(readLock(slotPath(k)));
    if (live && String(live.pid) === held) return true;
  }
  return false;
}

/** A recorded process group whose leader has gone but whose members still run (signal 0 only). */
function leftoverGroup(lock) {
  const group = (lock.holders ?? []).find((h) => h?.group && Number.isInteger(h.pid) && h.pid > 1);
  if (!group) return null;
  const alive = (target) => {
    try {
      process.kill(target, 0);
      return true;
    } catch (error) {
      return error.code === 'EPERM';
    }
  };
  return !alive(group.pid) && alive(-group.pid) ? group.pid : null;
}

function describe(h) {
  const left = leftoverGroup(h);
  return (
    `${clean(h.lane ?? 'unknown lane', 80)} ` +
    `(${clean(h.command ?? '?', 200)}, since ${clean(h.startedAt ?? '?', 40)})` +
    (left ? ` [only leftover processes, group ${left}: kill -TERM -- -${left} ends them]` : '')
  );
}

const NOOP = { release() {}, payload: null };
const WRAPPER = fileURLToPath(import.meta.url);

/**
 * For a runner (`e2e:local`, `screenshot:ephemeral`): re-run this process under the wrapper, unless it
 * already runs under a holder of a slot (or the slot is skipped). Returns true when it re-ran: the
 * caller returns at once, and this process exits with the wrapped run's code. The wrapper records the
 * run's whole process group, so the slot stays held until every child in that group (the build,
 * Playwright, Postgres) has exited, even when the runner itself is killed with -9. A child a runner
 * starts `detached` (screenshot's `next start`, Playwright's own server) is in a group of its own and
 * is not waited for.
 */
export function runUnderSlot(command) {
  if (skipped() || nested()) return false;
  const child = spawn(
    process.execPath,
    [WRAPPER, '--', process.execPath, ...process.execArgv, ...process.argv.slice(1)],
    { stdio: 'inherit', env: { ...process.env, MAT_PLAN_HEAVY_SLOT_LABEL: clean(command, 200) } },
  );
  // The terminal gives Ctrl-C / Ctrl-\ to the wrapper too (same group), which passes them on; Ctrl-Z
  // is held by the wrapper. A signal sent to this pid alone is passed to the wrapper.
  for (const signal of ['SIGINT', 'SIGQUIT', 'SIGTSTP']) process.on(signal, () => {});
  for (const signal of ['SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    });
  }
  child.on('error', (error) => {
    console.error(`✗ heavy-run slot: could not re-run under the wrapper: ${error.message}`);
    process.exit(127);
  });
  child.on('close', (code, signal) => process.exit(code ?? 128 + (constants.signals[signal] ?? 0)));
  return true;
}

/**
 * Take the slot for this process, or exit 2 when another run holds it. Returns a handle whose
 * `release()` frees it; it is also released at exit. A no-op under CI, when bypassed, or when this
 * process runs under a holder of the slot.
 */
export function takeSlot(command) {
  if (skipped()) return NOOP;
  // Nesting first: a run already holding a slot must not be refused because the count changed.
  if (nested()) return NOOP;
  const count = slotCount();
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
          ? `; MAT_PLAN_HEAVY_SLOTS=<n> (one shell) or ${slotCountFile()} (the machine) allows more when it has the headroom.`
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
  const slot = takeSlot(process.env.MAT_PLAN_HEAVY_SLOT_LABEL || command.join(' '));
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
    try {
      slot.payload.holders.push(holder(child.pid, { group: true }));
      rewrite(slot.path, slot.payload);
    } catch {
      /* ps could not read the child: the wrapper stays the only holder, and the run is not orphaned */
    }
  }
  let waiting = false;
  const forward = (signal) => {
    try {
      // A detached child leads its own group; a plain pass-through child is not a group leader.
      // Once the child has gone, the leftovers are stopped outright: waiting for them must end.
      // SIGHUP reaches the group as SIGTERM: Postgres reads a HUP as "reload config" and stays up.
      if (slot.payload)
        process.kill(-child.pid, waiting ? 'SIGKILL' : signal === 'SIGHUP' ? 'SIGTERM' : signal);
      // A pass-through child shares the terminal's group and already got Ctrl-C / Ctrl-\ from it.
      else if (signal !== 'SIGINT' && signal !== 'SIGQUIT') child.kill(signal);
    } catch {
      /* the child has already gone */
    }
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
  for (const signal of signals) process.on(signal, () => forward(signal));
  // Ctrl-Z would stop the wrapper while the detached run went on: held, with a note, while we hold a
  // slot. A pass-through wrapper's child is in the terminal's group and stops with it, as usual.
  if (slot.payload) {
    process.on('SIGTSTP', () =>
      console.error('▸ Ctrl-Z is held while a heavy run has the slot; Ctrl-C stops the run.'),
    );
  }
  child.on('error', (error) => {
    console.error(`✗ ${command[0]}: ${error.message}`);
    slot.release();
    process.exit(127);
  });
  child.on('close', (code, signal) => {
    // The direct child is gone, but what it started may not be (a runner killed with -9 leaves
    // Playwright, next or Postgres running in the group): keep the slot until the group is empty.
    const groupAlive = () => {
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        return error.code === 'EPERM';
      }
    };
    if (slot.payload && groupAlive()) {
      waiting = true;
      console.error(
        `▸ heavy-run slot: waiting for the run's remaining processes (group ${child.pid}) to exit. ` +
          'Ctrl-C ends them.',
      );
      const timer = setInterval(() => {
        if (groupAlive()) return;
        clearInterval(timer);
        finish(code, signal);
      }, 200);
      return;
    }
    finish(code, signal);
  });
  function finish(code, signal) {
    slot.release();
    if (signal) {
      for (const s of signals) process.removeAllListeners(s);
      process.kill(process.pid, signal); // die by the same signal, so the shell sees 128+n
      // A signal Node ignores or handles itself (SIGPIPE, SIGUSR1) would not end us: never report 0.
      process.exit(128 + (constants.signals[signal] ?? 0));
    }
    process.exit(code ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli(process.argv.slice(2));
}
