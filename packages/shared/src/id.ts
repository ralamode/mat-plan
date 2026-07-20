import { v7 as uuidv7 } from 'uuid';

/**
 * A fresh UUIDv7 — time-ordered and non-enumerable. Used for public/URL ids
 * (server-side) and `client_id` (client-stamped, for offline idempotency). One
 * generator so the app, DAL, and seeds don't each pick their own scheme.
 */
export function newId(): string {
  return uuidv7();
}
