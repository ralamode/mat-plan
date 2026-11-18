import { catalogHowToSchema, type CatalogHowTo } from '@mat-plan/shared';

import { howToPath } from './routes';

/**
 * The real "How to" loader (FAM-1 7b), for the picker's `howTo` prop. Movement-picker invariant 14:
 * **a failure is a rejection**, so the picker shows "Couldn't load the steps" with Try again.
 *
 * - A 404 is the route's one miss answer: `null` ("No steps for this movement yet"). The picker
 *   offers How to only on a row with steps, so a 404 there is a race or a stale list.
 * - A 200 is parsed with the strict schema; a body that fails it throws.
 * - Anything else (a 500, a redirect to sign-in's HTML, offline) throws.
 */
export async function howToLoader(optionId: string): Promise<CatalogHowTo | null> {
  const response = await fetch(howToPath(optionId), { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`how-to: ${response.status}`);
  return catalogHowToSchema.parse(await response.json());
}
