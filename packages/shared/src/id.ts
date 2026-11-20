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
 * the caller's spelling saw two. That mismatch shipped twice (a check-in submit; a strength session
 * that dropped a movement's sets), and the hide and restore schemas held it with no caller yet (a hide
 * would have answered not-found). Each was a different schema, so the fold sits here, where every id
 * is parsed, rather than in each schema that compares.
 * `lowerCaseUuidSchema` (`program/pieces.ts`) is the same schema now; the contract keeps the name.
 * `id.test.ts` pins the fold and scans the source for a second uuid validator: zod's builders, the
 * `uuid` package's `validate` (named, namespace or `require`), and a uuid-shaped regex however it is
 * named (three that parse no input are allowed, with reasons).
 *
 * ⚠️ A reader of the RAW input after the parse still sees the spelling it was sent, so it must fold
 * for itself.
 */
export const uuidSchema = z.uuid().toLowerCase();
