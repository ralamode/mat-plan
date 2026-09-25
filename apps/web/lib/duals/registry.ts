import columbusDayDuals2026 from './events/columbus-day-duals-2026.json';
import { dualsEventSchema, type DualsEvent } from './schema';

/**
 * The registered tournaments (DUALS-1, decision D6).
 *
 * Adding an event is two lines: drop the JSON in `events/`, add it here. It is
 * deliberately an explicit list rather than a directory glob — Next's bundler
 * cannot follow a runtime `fs.readdir` reliably on Vercel, and an unregistered
 * file failing loudly in a test beats a page 404-ing in a gym. `registry.test.ts`
 * fails if a JSON in `events/` is missing from this list, so the "drop it in"
 * workflow still catches the forgotten line.
 */
const RAW_EVENTS: readonly unknown[] = [columbusDayDuals2026];

/**
 * Parsed and integrity-checked at module load. A malformed event throws here —
 * which surfaces in `pnpm test` and at build, never as a half-rendered page.
 */
export const EVENTS: readonly DualsEvent[] = RAW_EVENTS.map((raw, i) => {
  const parsed = dualsEventSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `duals: event at index ${i} failed validation — ${JSON.stringify(parsed.error.issues, null, 2)}`,
    );
  }
  return parsed.data;
});
