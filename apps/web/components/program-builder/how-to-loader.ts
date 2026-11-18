import { catalogHowToSchema, type CatalogHowTo } from '@mat-plan/shared';

import { howToPath } from './routes';

/**
 * The real "How to" loader (FAM-1 7b), for the picker's `howTo` prop. Movement-picker invariant 14:
 * **a failure is a rejection**, so the picker shows "Couldn't load the steps" with Try again.
 *
 * - A 404 is the route's one miss answer: `null` ("No steps for this movement yet"). The picker
 *   offers How to only on a row with steps, so a 404 there is a stale list, **or a signed-out
 *   caller**: the route answers signed out with the same 404 (ADR 0006), so an expired session
 *   reads as "no steps", not "couldn't load". Accepted: the page itself redirects on the next load.
 * - A 200 is parsed with the strict schema; a body that fails it (HTML included) throws.
 * - Anything else (a 500, offline) throws. `fetch` follows redirects, so none arrives here.
 */
export async function howToLoader(optionId: string): Promise<CatalogHowTo | null> {
  const response = await fetch(howToPath(optionId), { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`how-to: ${response.status}`);
  return catalogHowToSchema.parse(await response.json());
}
