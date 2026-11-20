import 'server-only';

import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';

/**
 * 🔴 **The movement library in effect, named once** (CAT-3 P11-ii-a; spec K23, K29). The picker's read
 * (`program/picker.ts`), its "How to" (`getHowTo`) and `newItem` (`program/writes.ts`) all take this, so
 * the aliases the picker shows, the steps it opens and the aliases `newItem` matches come from one list.
 *
 * ⏳ The real library until the K29 PR, which derives it from the database (a fixtures database is
 * read with `CATALOG_FIXTURE`) and changes this one definition. Lane E's day read (`dal/day/day.ts`)
 * moves to it in its own PR after that.
 */
export const CATALOG_LIBRARY = CATALOG_MOVEMENTS;
