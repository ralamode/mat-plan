/**
 * The two spellings every written quantity shares: how a number is written, and how seconds are
 * abbreviated.
 *
 * Two readers, one definition each: the CSV export (`csv/value.ts`, which re-exports
 * `formatNumeric` unchanged and reads `SECONDS_SUFFIX` into its suffix map) and the program
 * contract's text (`program/quantity-text.ts`).
 *
 * 🔴 **Client-safe, and it must stay so: this module imports nothing.** `program/quantity-text.ts`
 * is in the root barrel that `'use client'` components import, and `csv/` is kept out of that
 * barrel. It was split out of `csv/value.ts` (FAM-1 contract change C1) for that reason alone.
 * It is not in the root barrel itself: its two readers import it by path.
 *
 * ⚠️ **Both values are CSV contract bytes.** A change here changes every exported month
 * (`docs/csv-export-contract.md`) and the text frozen on every logged row.
 */

/**
 * Render a Postgres `numeric` the way the corpus writes numbers (V1-13).
 *
 * ⚠️ **drizzle returns `numeric` as a STRING**, not a number — deliberately, so precision survives.
 * So a logged `70` reads back `"70.000"` and a logged `67.5` reads back `"67.500"`. Without this,
 * **every load value in the export is wrong**, not just `weight_lb`. (The draft plan scoped the
 * trailing-zero problem to bodyweight alone; the engineering panel caught it.)
 *
 * **Decimal-aware, deliberately.** A naive `replace(/0+$/, '')` turns `90` into `9`. Only zeros
 * *after a decimal point* are insignificant, and the point goes too once nothing follows it.
 *
 * The maintainer's ruling (2026-09-24) on the loss this accepts: _"we can assume .0 if no tenth or decimal is
 * used"_ — so a typed `92.0` exports as `92` and a reader takes a bare integer to mean `.0`. The
 * corpus really does contain `92.0` and `74.0`, and the precision is already gone at the form
 * boundary (`bodyweight.ts` coerces to a number), so nothing downstream could have recovered it.
 */
export function formatNumeric(value: string | number): string {
  const raw = String(value).trim();
  if (!raw.includes('.')) return raw;
  return raw.replace(/\.?0+$/, '') || '0';
}

/**
 * Seconds are written `s`, not by the unit's code (`sec`): `20s` in the CSV's `load`, `30 s` in a
 * prescription's text. The corpus fixes the CSV's spelling (`csv/value.ts` → `CSV_UNIT_SUFFIX`) and
 * the accepted prototype the text's; they are the same letter, so it is named once.
 */
export const SECONDS_SUFFIX = 's';
