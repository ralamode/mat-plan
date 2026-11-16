import { formatNumeric, SECONDS_SUFFIX } from '../quantity-spelling';
import type { Unit } from '../units';

/**
 * One quantity as text, the way the program and the day spell it: `25 lb`, `30 s`, `40 yd`,
 * `5 min`, and `7` for the plain `count` unit (a rating or a tally has no unit to read).
 *
 * **The one spelling of a quantity in FAM-1.** `prescribedText` (`./prescribed-text`) builds a
 * prescription's line from it, so a logged value written with it reads exactly as the prescription
 * beside it does: a logged `30 s` next to a prescribed `3 × 30 s`, never `30 sec`.
 *
 * The rule: the number as `formatNumeric` writes it, a space, then the unit's code; except seconds,
 * which is `s`, and the plain `count`, which is the bare number.
 *
 * 🔴 **Client-safe: in the root barrel, and nothing it imports may reach `csv/`**
 * (`quantity-text.test.ts` scans its imports). `prescribedText` stays a server-only subpath because
 * it also builds on the CSV's renderer; this does not.
 *
 * ⚠️ **These are the bytes a logged row is frozen against** (through `prescribedText`). A "tidier"
 * spelling here changes what every later ✓ stores, while earlier rows keep the old bytes.
 */
export function quantityText(value: number, unit: Unit): string {
  const number = formatNumeric(value);
  if (unit === 'count') return number;
  return `${number} ${unit === 'sec' ? SECONDS_SUFFIX : unit}`;
}
