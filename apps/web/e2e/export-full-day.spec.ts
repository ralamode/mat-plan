import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SEED_PROFILE_PUBLIC_ID } from '@mat-plan/db';
import {
  BODYWEIGHT_HEADER,
  bodyweightPath,
  CHECKINS_HEADER,
  checkinsPath,
  STRENGTH_LOG_HEADER,
  strengthLogPath,
} from '@mat-plan/shared/csv';
import { expect, type Page, test } from '@playwright/test';

import { STRENGTH_COPY } from '../lib/constants';

import {
  bodyweightEntryLine,
  isoDaysAgo,
  logBodyweight,
  openStrengthForm,
  SEED_PROFILE_ROUTE,
} from './steps';

/**
 * **V1-14b — the full-day round trip.** Log a day through the real UI, download the real export,
 * open it with a real unzip, and assert the bytes.
 *
 * ## Why this test exists
 *
 * V1-13's risk table names the gap it closes in one line: the exporter is *"provable only against
 * fixtures we wrote."* Every V1-13 proof — the golden vectors, the `db:verify` reads, the unit tests
 * — starts from a row shape **I typed**. If the form writes something other than what those fixtures
 * assume, all of them stay green and the export is wrong. This is the only test where the input is
 * produced by the application rather than by the test, so it is the only one that can catch that
 * class of bug. It is the MVP's finish line for that reason.
 *
 * ## Why the real `unzip` and not a reader we write
 *
 * `buildZip` is hand-rolled (`packages/shared/src/csv/zip.ts`). A reader written against the same
 * mental model would inherit its mistakes — a wrong offset would round-trip cleanly and prove
 * nothing. The system `unzip` is an independent implementation of the actual spec, so a malformed
 * local header fails here instead of in Ray's downloads folder. It is preinstalled on macOS and on
 * GitHub's `ubuntu-latest`; if it is ever missing the test **fails rather than skips** — a
 * self-skipping gate reporting green is the exact failure mode this repo has now hit four times
 * (docs/lessons.md).
 *
 * ## Why the assertions are CONTAINMENT, not file equality
 *
 * `fullyParallel` is on and every spec shares one ephemeral database and one seeded profile, so the
 * bodyweight file legitimately carries other specs' rows. Asserting the whole file would make this
 * test fail whenever a sibling spec logged first — flake that teaches people to rerun rather than
 * read. So: the probe movement's name is unique to this spec, and every assertion is "this exact row
 * is present", except the two that are genuinely global (the header, and the header-only check-ins
 * file, which no spec can write to).
 */

/** Unique to this spec, so the strength row is unambiguously ours under `fullyParallel`. */
const PROBE_MOVEMENT = 'Export Probe Squat';

/**
 * ⚠️ The whole point of the `movement` column, in one constant.
 *
 * `movementSlug('Export Probe Squat')` is `export_probe_squat` — **underscores** — and the legacy
 * corpus the downstream workflow groups by is **kebab**. `csvMovement` normalises, and if it ever
 * stops, every movement forks into two series while both files still look well-formed. That bug is
 * invisible to a fixture test whose fixture is already kebab; it is visible here because the slug is
 * derived by the app from a name a human typed.
 */
const PROBE_CSV_MOVEMENT = 'export-probe-squat';

/**
 * A DECIMAL on purpose — `formatNumeric` must keep `84.5` a string end to end. Distinct from every
 * other spec's weigh-in, though since V1-24 PR 1a it no longer has to be: this spec owns Athlete One's
 * YESTERDAY outright (see the test), so the value in the CSV is the one it typed.
 */
const PROBE_BODYWEIGHT = '84.5';

/** Non-uniform on purpose: `collapse()` must emit a slash-list here, and a scalar for the load. */
const PROBE_SETS = [
  { reps: '10', weight: '95' },
  { reps: '8', weight: '95' },
  { reps: '6', weight: '95' },
];

type Csv = { header: string; lines: string[]; raw: string };

/** Download the export and unzip it with the system tool. Returns path → text. */
async function downloadExport(page: Page): Promise<Map<string, string>> {
  const link = page.getByRole('link', { name: /Export CSV/i });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);

  const dir = mkdtempSync(join(tmpdir(), 'mp-export-'));
  const zipPath = join(dir, 'export.zip');
  await download.saveAs(zipPath);

  // `-o` overwrite, `-q` quiet, `-d` into dir. A non-zero exit throws — which is the point: a
  // malformed archive fails loudly here rather than silently yielding zero files.
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir]);

  // `unzip -Z1` lists entry paths from the CENTRAL DIRECTORY — so this also proves the central
  // directory and the local headers agree, which a "read the files we expect" loop would not.
  const paths = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  return new Map(paths.map((p) => [p, readFileSync(join(dir, p), 'utf8')]));
}

function parse(files: Map<string, string>, path: string): Csv {
  const raw = files.get(path);
  expect(raw, `expected ${path} in the export, got: ${[...files.keys()].join(', ')}`).toBeDefined();
  const lines = raw!.split('\n');
  // Trailing newline → a trailing empty element. The contract requires that newline, so assert it
  // rather than trimming it away.
  expect(lines.at(-1), `${path} must end with a newline`).toBe('');
  return { header: lines[0], lines: lines.slice(1, -1), raw: raw! };
}

test('a full day logged through the UI round-trips through the CSV export', async ({ page }) => {
  // ⚠️ Athlete One's YESTERDAY, not today (V1-24 PR 1a). Once a day has a weight the weigh-in form is
  // replaced by a receipt, so two specs logging the same `(profile, day)` under `fullyParallel` would
  // race: whichever ran second would find the other's value and never exercise its own write. The
  // smoke owns Athlete One's today; this owns their yesterday (inside the ±1 write window).
  await page.goto(`${SEED_PROFILE_ROUTE}?d=${isoDaysAgo(1)}`, { waitUntil: 'networkidle' });

  // The day the WRITE will carry, read from the field the forms actually submit — not recomputed
  // here. A test that derives the date itself is asserting its own arithmetic; this asserts the
  // app's. (V1-6c: the page computes the day at render and carries it in every form.)
  const day = await page.locator('input[name="day"]').first().inputValue();
  expect(day, 'the declared-day field should carry an ISO day').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // The disjointness above only holds if the page really rendered yesterday (not a clamped today).
  expect(day, 'the page should have rendered the ?d= day').toBe(isoDaysAgo(1));
  const month = day.slice(0, 7);

  // ── 1. Bodyweight ─────────────────────────────────────────────────────────────
  // Via the shared helper, not an inline copy: it asserts the receipt, focus, and the entries line.
  await logBodyweight(page, PROBE_BODYWEIGHT, { timeout: 15_000 });
  await expect(page.getByText(bodyweightEntryLine(PROBE_BODYWEIGHT))).toBeVisible();

  // ── 2. Strength ───────────────────────────────────────────────────────────────
  // The blank movement card, NOT the program scaffold: the scaffold's movements come from
  // `resolveDayRole`, which alternates on date parity, so a scaffold-driven assertion would depend
  // on which day CI happened to run. Typing the movement makes the expected bytes deterministic —
  // and exercises `ensureMovement`'s slug derivation, which is the column this test is really about.
  // `exact` matters: `Movement 1 skipped`, `Unit for movement 1` and `What movement 1 measures`
  // are all live substring collisions on this card (docs/lessons.md: substring matching bit us in V0-11).
  await openStrengthForm(page); // collapsed on a retry, once the first attempt's session exists
  await page.getByLabel('Movement', { exact: true }).fill(PROBE_MOVEMENT);

  for (const [i, set] of PROBE_SETS.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'Add set' }).first().click();
    await page.getByLabel(`Movement 1 set ${i + 1} reps`).fill(set.reps);
    await page.getByLabel(new RegExp(`^Movement 1 set ${i + 1} weight`)).fill(set.weight);
  }

  const logStrength = page.getByRole('button', { name: STRENGTH_COPY.submit, exact: true });
  await logStrength.click();
  // V1-24 3a-ii: a save FOLDS the form behind "Log more strength" (the submit is hidden), so the
  // signal the save landed is the folded toggle, then the record below.
  await expect(
    page.getByRole('button', { name: STRENGTH_COPY.logMore, exact: true }),
  ).toHaveAttribute('aria-expanded', 'false', { timeout: 15_000 });
  await expect(
    page.getByRole('region', { name: 'Logged entries' }).getByText(PROBE_MOVEMENT),
  ).toBeVisible({ timeout: 15_000 });

  // ── 3. Export ─────────────────────────────────────────────────────────────────
  const files = await downloadExport(page);

  // Paths are `data/<type>/<public_id>/<YYYY-MM>.csv` — `public_id`, never a name or a slug, so the
  // directory survives a rename (Ray, 2026-09-24).
  const bwPath = bodyweightPath(SEED_PROFILE_PUBLIC_ID, month);
  const strengthPath = strengthLogPath(SEED_PROFILE_PUBLIC_ID, month);
  const checkinPath = checkinsPath(SEED_PROFILE_PUBLIC_ID, month);
  expect([...files.keys()]).toEqual(expect.arrayContaining([bwPath, checkinPath, strengthPath]));
  // Containment plus a SHAPE check, not set equality: `loggedMonths` returns a month per month with
  // data, so a sibling spec writing across a month boundary — or a future seed with historical rows —
  // would legitimately add entries here. What must hold is that every path is one of the three types,
  // scoped to this athlete, and named `<YYYY-MM>.csv`.
  for (const path of files.keys()) {
    expect(path).toMatch(
      new RegExp(
        `^data/(strength-log|bodyweight|checkins)/${SEED_PROFILE_PUBLIC_ID}/\\d{4}-\\d{2}\\.csv$`,
      ),
    );
  }

  // ── 4. Bodyweight bytes ───────────────────────────────────────────────────────
  const bw = parse(files, bwPath);
  expect(bw.header).toBe(BODYWEIGHT_HEADER.join(','));
  // `84.5`, not `84.50` or `84` — `numeric` comes back from pg as a STRING and `formatNumeric`
  // keeps it one. A float round-trip is what would corrupt this, and it would corrupt it silently.
  // The two trailing commas are `context` (which the form cannot write) and `notes`, both empty —
  // trailing empty fields are WRITTEN, per the contract.
  expect(bw.lines).toContain(`${day},${PROBE_BODYWEIGHT},,`);

  // ── 5. Strength bytes ─────────────────────────────────────────────────────────
  const strength = parse(files, strengthPath);
  expect(strength.header).toBe(STRENGTH_LOG_HEADER.join(','));

  const row = strength.lines.find((l) => l.includes(PROBE_CSV_MOVEMENT));
  expect(
    row,
    `no row for '${PROBE_CSV_MOVEMENT}'. If a row exists for 'export_probe_squat', csvMovement ` +
      `stopped normalising and every movement has just forked into two series.`,
  ).toBeDefined();

  const [rDate, rSessionType, rMovement, rSets, rReps, rLoad, rPrescribed, rNotes] =
    row!.split(',');
  expect(rDate).toBe(day);
  expect(rMovement).toBe(PROBE_CSV_MOVEMENT);
  // `sets` is a COUNT of set rows, and it must equal the length of the slash-lists beside it.
  expect(rSets).toBe(String(PROBE_SETS.length));
  // Non-uniform reps collapse to a slash-list; a uniform load collapses to a scalar. Both in one row
  // — that pairing is the aggregator's whole contract and no fixture exercises it from the form.
  expect(rReps).toBe(PROBE_SETS.map((s) => s.reps).join('/'));
  expect(rLoad).toBe(PROBE_SETS[0].weight);
  // `session_type` comes from `day_role` — hyphenated, or empty when the movement was logged outside
  // a session. What it must NEVER be is an underscore form.
  expect(rSessionType).not.toContain('_');
  // A movement the form invented has no prescription to match back to, and the column's purpose is
  // being un-reconciled with actuals — so an invented plan here would be worse than none.
  expect(rPrescribed).toBe('');
  expect(rNotes).toBe('');

  // ── 6. Check-ins is header-only, ALWAYS ───────────────────────────────────────
  // Surprising enough to pin: the real files have never carried a row, and a MISSING file and an
  // EMPTY file are different inputs to the workflow. This one CAN be asserted whole — no spec can
  // add a row to it.
  expect(parse(files, checkinPath).raw).toBe(`${CHECKINS_HEADER.join(',')}\n`);

  // ── 7. Determinism ────────────────────────────────────────────────────────────
  // `buildZip` zeroes the DOS date/time fields specifically so this holds; a re-introduced `mtime`
  // would break the workflow's ability to diff two exports, and would break it invisibly.
  //
  // ⚠️ Scoped to the entries this spec OWNS. Comparing the whole archive would be a race: under
  // `fullyParallel` a sibling spec can append a bodyweight row between the two downloads, and the
  // test would fail for a reason that has nothing to do with determinism. `strength-log` is
  // exclusively ours (no other spec submits the strength form) and `checkins` is header-only by
  // construction, so those two are stable and are what the assertion compares.
  const again = await downloadExport(page);
  for (const path of [strengthPath, checkinPath]) {
    expect(again.get(path), `${path} differed between two exports of the same data`).toBe(
      files.get(path),
    );
  }
});
