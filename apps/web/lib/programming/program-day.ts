import type { ProgramDayRow } from '@mat-plan/db';

/**
 * The pure row → DTO shaping for the "Today's program" card (V1-10 slice 2), split out of the
 * `server-only` DAL so the two pieces of real logic in this slice — the per-kid reps precedence and the
 * prescription line format — are unit-testable (the `lib/entries/adherence.ts` + `set-display.ts`
 * precedent; AGENTS.md: "push logic into the (sync, testable) DAL"). The `@mat-plan/db` import is
 * TYPE-ONLY, so nothing here pulls in a DB client.
 */

/**
 * One programmed movement on a kid's day — the card's row. Every field is the coach's VERBATIM authored
 * text (`sets` and `idx` are the only numbers): `targetReps` and `load` carry "8-12" / "AMRAP" / "BW +5" /
 * "40 yd, to grip failure" losslessly, because that text IS the coach's safety cue and the numeric log
 * schema cannot hold it. The card DISPLAYS these; the kid types what they actually performed into the
 * (unchanged, still-required) strength form — so a prescribed load can never be logged as a performed one.
 */
export type ProgramDayDTO = {
  /** The prescription's 0-based slot within the day — its stable identity (`(block, day_role, idx)` is a
   *  live-row UNIQUE index) and the coach's authored order. */
  idx: number;
  movementName: string;
  sets: number | null;
  /** The reps to display — this kid's per-kid override, falling back to the shared prescription. */
  targetReps: string | null;
  /** This kid's suggested load; null when they have no target on this prescription. */
  load: string | null;
};

/**
 * Shape the raw rows into card DTOs. The only decision here is the reps precedence: a per-kid
 * `prescription_targets.reps` override WINS over the prescription's shared `target_reps` (null is the
 * common case — the kids mostly share reps and differ only on load). `??` not `||`, so an authored empty
 * string is respected rather than silently falling back.
 */
export function toProgramDay(rows: readonly ProgramDayRow[]): ProgramDayDTO[] {
  return rows.map((r) => ({
    idx: r.idx,
    movementName: r.movementName,
    sets: r.sets,
    targetReps: r.reps ?? r.targetReps,
    load: r.load,
  }));
}

/**
 * The prescription line: "4 sets × 3". Both parts are nullable in the schema (a movement-only
 * prescription is legal), so each may stand alone.
 *
 * The "sets" NOUN is deliberate and load-bearing: the same screen renders a LOGGED set as `reps × weight`
 * (`formatSetLine`) in the same muted style, so a bare "4 × 3" here would collide with an established
 * visual grammar that means something else — on a surface read on a gym floor. Reps stay VERBATIM text
 * ("8-12", "40 yd, to grip failure"), never parsed to a number.
 */
export function formatPrescription({
  sets,
  targetReps,
}: Pick<ProgramDayDTO, 'sets' | 'targetReps'>) {
  const setsLabel = sets === null ? null : `${sets} ${sets === 1 ? 'set' : 'sets'}`;
  if (setsLabel && targetReps) return `${setsLabel} × ${targetReps}`;
  return setsLabel ?? targetReps ?? '';
}
