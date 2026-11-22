import 'server-only';

import type { CatalogLibraryName, CatalogMovement } from '@mat-plan/shared';
import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';
import { CATALOG_FIXTURE } from '@mat-plan/shared/catalog/fixture';

import { catalogLibraryName } from '@/lib/env';

/** Each library name's list (CAT-3 K29). Exported for its test; the app reads `CATALOG_LIBRARY`. */
export const CATALOG_LIBRARIES: Readonly<Record<CatalogLibraryName, readonly CatalogMovement[]>> = {
  catalog: CATALOG_MOVEMENTS,
  fixture: CATALOG_FIXTURE,
};

/**
 * 🔴 **The movement library in effect, named once** (CAT-3 P11-ii-a; spec K23, K29). The picker's read
 * (`program/picker.ts`), its "How to" (`getHowTo`), `newItem` (`program/writes.ts`) and the day read
 * (`dal/day/day.ts`) all take this, so the aliases the picker shows, the steps it opens, the aliases
 * `newItem` matches and the day's labels come from one list.
 *
 * K29: a database the seed fills with fixtures is read with `CATALOG_FIXTURE`, every other with
 * `CATALOG_MOVEMENTS`, and production always with the real one. `lib/env.ts` decides the name once.
 */
export const CATALOG_LIBRARY: readonly CatalogMovement[] = CATALOG_LIBRARIES[catalogLibraryName()];
