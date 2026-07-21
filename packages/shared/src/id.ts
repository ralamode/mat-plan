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
 */
export const uuidSchema = z.uuid();
