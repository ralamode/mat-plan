import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/**
 * A fresh UUIDv7 — time-ordered and non-enumerable. Used for public/URL ids
 * (server-side) and `client_id` (client-stamped, for offline idempotency). One
 * generator so the app, DAL, and seeds don't each pick their own scheme.
 */
export function newId(): string {
  return uuidv7();
}

/**
 * The one UUID validator shared by the input schemas (`profileId`, `clientId`)
 * and the DAL id guard — so "is this a public/URL id?" is defined once. Accepts
 * any UUID version (ids are UUIDv7, but the shape check is version-agnostic).
 *
 * 🔴 **It hands the id back in lower case.** Postgres compares a `uuid` without regard to case, so
 * `X` and `X` in upper case are one id to every `ON CONFLICT`, `IN` and `=`; a JS `Set` or `===` over
 * the caller's spelling saw two. That mismatch shipped three times (a check-in submit, a strength
 * session that dropped a movement's sets, a hide that answered not-found), each in a different
 * schema, so the fold sits here, where every id is parsed, rather than in each schema that compares.
 * `lowerCaseUuidSchema` (`program/pieces.ts`) is the same schema now; the contract keeps the name.
 * `id.test.ts` pins the fold and scans for a second uuid validator anywhere in the source.
 *
 * ⚠️ A reader of the RAW input after the parse still sees the spelling it was sent
 * (`deriveSupersets` in the strength action is the one that does, and folds for itself).
 */
export const uuidSchema = z.uuid().toLowerCase();
