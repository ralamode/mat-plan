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
} from '@mat-plan/shared/csv';
import { expect, type Page, test } from '@playwright/test';

import { isoDaysAgo, logBodyweight, logPractice, SEED_PROFILE_ROUTE } from './steps';

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
 * read. So: this spec owns Athlete One's yesterday, and every assertion is "this exact row is
 * present", except the two that are genuinely global (the header, and the header-only check-ins
 * file, which no spec can write to).
 */

/**
 * A DECIMAL on purpose — `formatNumeric` must keep `84.5` a string end to end. Distinct from every
 * other spec's weigh-in, though since V1-24 PR 1a it no longer has to be: this spec owns Athlete One's
 * YESTERDAY outright (see the test), so the value in the CSV is the one it typed.
 */
const PROBE_BODYWEIGHT = '84.5';

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
  // ⚠️ RETRY-SAFE: since V1-24 3b-page the only forms are the empty bodyweight field and the
  // practice button, and both are gone once a first attempt has logged. A retry then reads the day
  // the page rendered from its URL instead; the first attempt still reads the field.
  const dayField = page.locator('input[name="day"]').first();
  const day =
    (await dayField.count()) > 0
      ? await dayField.inputValue()
      : (new URL(page.url()).searchParams.get('d') ?? '');
  expect(day, 'the declared-day field should carry an ISO day').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // The disjointness above only holds if the page really rendered yesterday (not a clamped today).
  expect(day, 'the page should have rendered the ?d= day').toBe(isoDaysAgo(1));
  const month = day.slice(0, 7);

  // ── 1. Bodyweight ─────────────────────────────────────────────────────────────
  // Via the shared helper, not an inline copy: it asserts the receipt and focus.
  await logBodyweight(page, PROBE_BODYWEIGHT, { timeout: 15_000 });

  // ── 2. Practice ───────────────────────────────────────────────────────────────
  // V1-24 3b-page: the strength form left the page (its export is proved in Vitest and `db:verify`
  // until FAM-1 13b brings an e2e back). Practice is logged here so the day holds both of the page's
  // write paths; ⚠️ practice minutes are not in the CSV (the check-ins file carries none), so the
  // bytes below prove the bodyweight path only.
  await logPractice(page);

  // ── 3. Export ─────────────────────────────────────────────────────────────────
  const files = await downloadExport(page);

  // Paths are `data/<type>/<public_id>/<YYYY-MM>.csv` — `public_id`, never a name or a slug, so the
  // directory survives a rename (Ray, 2026-09-24).
  const bwPath = bodyweightPath(SEED_PROFILE_PUBLIC_ID, month);
  const checkinPath = checkinsPath(SEED_PROFILE_PUBLIC_ID, month);
  expect([...files.keys()]).toEqual(expect.arrayContaining([bwPath, checkinPath]));
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

  // ── 6. Check-ins is header-only, ALWAYS ───────────────────────────────────────
  // Surprising enough to pin: the real files have never carried a row, and a MISSING file and an
  // EMPTY file are different inputs to the workflow. This one CAN be asserted whole — no spec can
  // add a row to it.
  expect(parse(files, checkinPath).raw).toBe(`${CHECKINS_HEADER.join(',')}\n`);

  // ── 7. Determinism ────────────────────────────────────────────────────────────
  // `buildZip` zeroes the DOS date/time fields specifically so this holds; a re-introduced `mtime`
  // would break the workflow's ability to diff two exports, and would break it invisibly.
  //
  // ⚠️ Scoped to a file no sibling can change. Comparing the whole archive would be a race: under
  // `fullyParallel` a sibling spec can append a bodyweight row between the two downloads, and the
  // test would fail for a reason that has nothing to do with determinism. `checkins` is header-only
  // by construction, and this spec's own bodyweight row (Athlete One's yesterday) has no other
  // writer, so those are what the assertion compares.
  const again = await downloadExport(page);
  expect(again.get(checkinPath), `${checkinPath} differed between two exports`).toBe(
    files.get(checkinPath),
  );
  const ownDay = (csv: string | undefined) =>
    (csv ?? '').split('\n').filter((l) => l.startsWith(`${day},`));
  expect(
    ownDay(again.get(bwPath)),
    'this day’s bodyweight rows differed between two exports',
  ).toEqual(ownDay(files.get(bwPath)));
});
