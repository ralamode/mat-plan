import { z } from 'zod';

import { ENTRY_STATUS, movementStatusSchema } from './enums';
import { uuidSchema } from './id';
import { DAY_ROLE_TO_SESSION_TYPE, optionalDayRoleSchema } from './programming';
import { DEFAULT_SESSION_TYPE, sessionTypeSchema } from './sessions';
import { strengthSetSchema } from './strength';
import { freeTextNoteSchema, hasCommaOrLineBreak } from './text';
import {
  LOGGABLE_DIMENSION_LABELS,
  loggableUnitSchema,
  UNIT_DIMENSION,
  UNIT_DIMENSION_BY_CODE,
} from './units';

/** Max movements per session, and max supersets (each needs ≥2 of the movements → floor(N/2)). Named
 *  so the derivation is expressed in code, not two magic numbers that can drift. */
export const MAX_SESSION_MOVEMENTS = 12;
export const MAX_SESSION_SUPERSETS = Math.floor(MAX_SESSION_MOVEMENTS / 2);
/** Max sets on one movement. Was an inline `.max(20)`; V1-19's scaffold has to clamp to the SAME
 *  number when it builds set rows from a prescription (`prescriptions_sets_check` allows any
 *  `sets > 0`), and two copies of that bound would drift into a form that cannot submit. */
export const MAX_SETS_PER_MOVEMENT = 20;

/**
 * One movement within a logged session: a named movement, its unit, its own idempotency
 * `clientId`, and 1..20 sets. Reuses `strengthSetSchema` + `loggableUnitSchema` + `uuidSchema` (the
 * same set bound `logStrengthSchema` used) — no re-declared shapes. `supersetClientId`/`supersetOrder`
 * (V1-8-3c) tag this movement into a superset: `supersetClientId` references a `supersets[]` entry,
 * `supersetOrder` is its 1-based position within (like `entry_sets.idx`). Both optional (a flat
 * movement has neither); paired + validated in the schema's superRefine.
 */
export const sessionMovementSchema = z.object({
  // GAP-1 P2-2 — the name reaches the CSV's `movement` column, which is joined raw, so a comma shifts
  // every downstream field in the row and a newline splits it. REJECTED at the boundary (the same call
  // `parseLoad` makes for the load field), never sanitised: the name is persisted VERBATIM in two
  // columns — `movements.name` and `entries.movement_name` — so laundering the derived `movements.slug`
  // would leave both commas in place and fix nothing. `"` stays legal (`30" Box Jump`), matching
  // `parseLoad`. Nothing is lost by rejecting: `Bench, Close Grip` and `Bench Close Grip` already slug
  // identically, so the comma carries no information the DB keeps.
  movementName: z
    .string()
    .trim()
    .min(1, 'Enter a movement.')
    .max(100)
    .refine(
      (v) => !hasCommaOrLineBreak(v),
      'A movement name can’t contain a comma or a line break.',
    ),
  // V1-30: every unit the form's Measuring picker offers. Was `BODYWEIGHT_UNITS` (lb/kg), which made
  // a timed hold or a distance fail the whole session since #141.
  unit: loggableUnitSchema,
  clientId: uuidSchema,
  // GAP-1 P1-1a. `skipped` means a human SAID the movement was skipped — never inferred from an empty
  // set list (the P0-1 provenance rule). `sub_failure` is deliberately NOT accepted here: it is a
  // per-ATTEMPT observation and belongs on `entry_sets` (P1-1b) — see MOVEMENT_STATUSES for the rule.
  //
  // `.default()` (not `.optional()`) is safe here because `movements` rides as a JSON string the action
  // `JSON.parse`s, so an absent key arrives as `undefined` and the default fires. The `FormData.get →
  // null` trap that made `sessionType` unreachable applies only to discrete form fields, not to keys
  // inside this JSON payload.
  status: movementStatusSchema.default(ENTRY_STATUS.done),
  // `.min(1)` MOVED to the session-level superRefine below (check 6), because the rule is now
  // cross-field: ≥1 set normally, exactly 0 when skipped. It cannot live here — this schema must stay
  // a plain ZodObject, and a `.superRefine` on it would make it ZodEffects, killing `.extend`/`.shape`
  // (the trap `strength.ts`'s header documents at length). The rendered error is unchanged: the action
  // maps any issue with a numeric `path[1]` to `Movement N: <message>`, and `path[1]` is the movement
  // index whether the issue sits at ['movements', i] or ['movements', i, 'sets'].
  sets: z.array(strengthSetSchema).max(MAX_SETS_PER_MOVEMENT),
  supersetClientId: uuidSchema.optional(),
  supersetOrder: z.coerce.number().int().positive().optional(),
});
export type SessionMovementInput = z.infer<typeof sessionMovementSchema>;

/** A superset within a session (V1-8-3c): a grouping row with its own idempotency `clientId` and an
 *  optional free-text `label` (blank → NULL, shared shape). Members reference it by `supersetClientId`. */
export const supersetInputSchema = z.object({
  clientId: uuidSchema,
  label: freeTextNoteSchema, // borrows the blank→undefined+cap normalization AND the single-line guard
});
export type SupersetInput = z.infer<typeof supersetInputSchema>;

/**
 * Input contract for logging a FLAT multi-movement strength session (V1-8-2). Written as one
 * `sessions` row grouping N movement `entry`s (each → its `entry_set`s) in one transaction.
 * `clientId` stamps the parent SESSION; each movement carries its own `clientId`.
 *
 * `sessionType` defaults to `DEFAULT_SESSION_TYPE` (sourced, not a literal). The action OMITS the
 * field so the default fires — `FormData.get` returns `null` for an absent field, and `.default()`
 * fires only on `undefined`, so reading it from the body would send `null` and `z.enum` would
 * reject it, making the happy path unreachable (panel B3). No superset fields — flat only; V1-8-3
 * adds superset grouping.
 */
export const logStrengthSessionSchema = z
  .object({
    profileId: uuidSchema,
    clientId: uuidSchema,
    sessionType: sessionTypeSchema.default(DEFAULT_SESSION_TYPE),
    // Optional "how did it feel?" note for the whole session — the shared free-text shape (blank → NULL,
    // capped at FREE_TEXT_NOTE_MAX), single-sourced with bodyweight `notes`.
    feel: freeTextNoteSchema,
    // GAP-1 P0-1: WHICH programmed day this was, as ASSERTED by the athlete (never derived here — see
    // the schema comment on `sessions.day_role`). Optional: a session on a non-programmed day is normal.
    // `optionalDayRoleSchema` normalises BOTH absent and '' to undefined — the `sessionType` trap above.
    dayRole: optionalDayRoleSchema,
    movements: z
      .array(sessionMovementSchema)
      .min(1, 'Add at least one movement.')
      .max(MAX_SESSION_MOVEMENTS, 'That’s a lot of movements — split into two sessions.'),
    // Session-level supersets (V1-8-3c) — a sibling of `movements`, keyed by client_id. Optional; a
    // session with no supersets omits it. Members reference these via `movement.supersetClientId`.
    supersets: z.array(supersetInputSchema).max(MAX_SESSION_SUPERSETS).optional(),
  })
  // Writer/DB invariants the boundary must enforce (the form emits well-formed groups; these guard a
  // crafted body). The pairing + membership + distinct-clientId + ≥2-members are NOT cheaply DB-expressible
  // (or, for the DB ones, would surface as a raw 500); the cross-row distinct-`superset_order` IS enforced
  // by `uq_entries_superset_order`, so it's deliberately left DB-only.
  .superRefine((val, ctx) => {
    // (0) The day role must agree with the session type it claims. Expressed against the shared
    // DAY_ROLE_TO_SESSION_TYPE map rather than a hardcoded 'strength', so it stays DRY and stays correct
    // if `sessionType` ever becomes settable. Without this a crafted body could file a `conditioning`
    // role on a strength session. (The DB CHECK is the wider net; this is the narrow one — and the pair
    // is deliberately NOT a DB CHECK, which would break db:verify's exact-set CHECK assertion.)
    if (val.dayRole && DAY_ROLE_TO_SESSION_TYPE[val.dayRole] !== val.sessionType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dayRole'],
        message: 'That day doesn’t belong to this kind of session.',
      });
    }

    const supersets = val.supersets ?? [];

    // (1) Movement client_ids distinct — a dup would silently drop the second member (ON CONFLICT).
    const movementIds = val.movements.map((m) => m.clientId);
    if (new Set(movementIds).size !== movementIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['movements'],
        message: 'Each movement needs its own id.',
      });
    }

    // (2) Superset client_ids distinct — `insertSupersetRow`'s ON CONFLICT would silently MERGE two
    // groups (both members map to the first id), collapsing them with no DB error. The Set is reused
    // by the membership check below.
    const supersetIds = supersets.map((s) => s.clientId);
    const supersetIdSet = new Set(supersetIds);
    if (supersetIdSet.size !== supersetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['supersets'],
        message: 'Each superset needs its own id.',
      });
    }

    // (3) Pairing — a movement carries `supersetOrder` iff it carries `supersetClientId`. Kept (not
    // DB-delegated): `supersetOrder` rides in the movements JSON the action forwards, so an
    // order-without-clientId body would otherwise reach `entries_superset_order_check` as a raw 500.
    // Use `!= null` (not truthiness) — `supersetOrder` is 1-based so 0 never occurs, but be explicit.
    for (const [i, m] of val.movements.entries()) {
      const hasClient = m.supersetClientId != null;
      const hasOrder = m.supersetOrder != null;
      if (hasClient !== hasOrder) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['movements', i],
          message: 'A superset member needs both a superset id and an order.',
        });
      }

      // (3b) GAP-1 P1-1a — the set-count rule, now cross-field with `status` (it moved off
      // `sessionMovementSchema.sets`; see the note there). Both directions matter:
      //   · a NON-skipped movement with no sets is the empty-log accident `.min(1)` always guarded;
      //   · a SKIPPED movement WITH sets is only reachable from a crafted body, and would store a
      //     contradiction the export can render as neither the `0,0,SKIPPED` triple nor a real row.
      const isSkipped = m.status === ENTRY_STATUS.skipped;
      if (!isSkipped && m.sets.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['movements', i],
          message: 'Add at least one set.', // verbatim the message `.min(1)` produced
        });
      }
      if (isSkipped && m.sets.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['movements', i],
          message: 'A skipped movement can’t have sets.',
        });
      }
    }

    // (4) Membership — every tagged movement references a real `supersets[]` entry (else it dangles to
    // `undefined` in the writer map). Only check movements that ARE tagged.
    for (const [i, m] of val.movements.entries()) {
      if (m.supersetClientId != null && !supersetIdSet.has(m.supersetClientId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['movements', i],
          message: 'This movement references a superset that wasn’t defined.',
        });
      }
    }

    // (5) Per superset: ≥2 members AND distinct orders. Iterate `supersets` (not movements) so a
    // 0-member orphan is caught. Both are app-reachable → typed envelopes, NOT raw 500s: ≥2 isn't
    // DDL-expressible (ADR-0003 D4); distinct-order IS a DB UNIQUE, but the entry ON CONFLICT arbiter is
    // `client_id` (not the order UNIQUE), so a dup order isn't swallowed — it would surface as a 500.
    for (const [i, s] of supersets.entries()) {
      const orders = val.movements
        .filter((m) => m.supersetClientId === s.clientId)
        .map((m) => m.supersetOrder);
      if (orders.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['supersets', i],
          message: 'A superset needs at least 2 movements.',
        });
      }
      const definedOrders = orders.filter((o) => o != null);
      if (new Set(definedOrders).size !== definedOrders.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['supersets', i],
          message: 'Superset members need distinct orders.',
        });
      }
    }

    // (6) V1-30: BW and band are MODES of a weight. On a time or a distance they mean nothing, and
    // the set refine accepts a mode in place of a number, so `3 × BW` on a timed hold would save with
    // no time at all, and be uneditable (the edit path is mass-only). One issue per set, on the
    // set's `weight` path. A BLANK set with no mode is already rejected by the set refine, so it is
    // not re-checked here: every bad set gets exactly one message.
    for (const [i, m] of val.movements.entries()) {
      const dimension = UNIT_DIMENSION_BY_CODE[m.unit];
      if (dimension === UNIT_DIMENSION.mass) continue;
      const what = (LOGGABLE_DIMENSION_LABELS[dimension] ?? dimension)
        .toLowerCase()
        .replace(' / ', ' or ');
      for (const [j, set] of m.sets.entries()) {
        if (set.isBodyweight || set.isBand) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['movements', i, 'sets', j, 'weight'],
            message: `Turn off BW / band — they don’t apply to a ${what}.`,
          });
        }
      }
    }
  });
export type LogStrengthSessionInput = z.infer<typeof logStrengthSessionSchema>;
