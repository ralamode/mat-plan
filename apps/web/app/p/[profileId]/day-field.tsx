/**
 * Hidden field carrying the day the page rendered, so a write lands where the user saw it
 * (the server bounds it ±1 via `resolveDeclaredDay`). Shared by all three log forms
 * (check-ins, bodyweight, strength) so the field isn't copy-pasted. Zero-dep markup — no
 * `'use client'` needed; it composes into the client forms.
 */
export function DayField({ day }: { day: string }) {
  return <input type="hidden" name="day" value={day} readOnly />;
}
