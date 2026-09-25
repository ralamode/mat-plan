import { z } from 'zod';

/**
 * The drop-in contract for a tournament day sheet (DUALS-1, decision D6).
 *
 * Adding a tournament is a DATA task, not an engineering one: drop a JSON that
 * satisfies this schema into `events/`, register it in `registry.ts`, and the
 * routes render it. Nothing about any one event — division names, pool names,
 * round counts, weight classes, mat numbers — is hardcoded in a route or a
 * component.
 *
 * Shape notes that are load-bearing:
 *
 *  - **Teams are joined by `id`, never by display name.** Source brackets
 *    truncate names ("All I See Is Gold Academy" is really "…Stripes ES6", and
 *    there is also a "…Stars ES6"), so a name join silently pairs the wrong
 *    team or drops it. `refineEventIntegrity` makes a dangling id a load-time
 *    failure.
 *  - **A bye is `opponentId: null`**, and it keeps its round number. Round
 *    numbers must line up with what the announcer calls.
 *  - **`roster` may be empty.** An event captured without rosters still renders
 *    a day sheet; the matchup view just doesn't appear.
 *  - **Weight classes are strings**, ordered per division by the source. They
 *    are not all numeric ("Hwt"), so they are never parsed into numbers for
 *    identity — only for sorting, with non-numeric values sorted last.
 */

export const rosterEntrySchema = z.object({
  first: z.string(),
  last: z.string(),
  /** Weight class as the source writes it — "68", "Hwt". Not necessarily numeric. */
  weight: z.string(),
  /** Weigh-in weight when recorded. */
  actualWeight: z.number().nullable(),
});

export const dualsTeamSchema = z.object({
  /** Source-stable team id. The only safe join key. */
  id: z.string().min(1),
  /** URL segment. Unique within an event. */
  slug: z.string().min(1),
  name: z.string().min(1),
  roster: z.array(rosterEntrySchema),
});

export const dualRoundSchema = z.object({
  round: z.number().int().positive(),
  /** `null` = bye. */
  opponentId: z.string().min(1).nullable(),
  /** Mat label, or `null` when the source hasn't assigned one. */
  mat: z.string().min(1).nullable(),
});

/** One team's run through its pool. */
export const dualsEntrySchema = z.object({
  teamId: z.string().min(1),
  division: z.string().min(1),
  pool: z.string().min(1),
  rounds: z.array(dualRoundSchema),
});

const dualsEventObjectSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  source: z.object({ name: z.string(), url: z.string().url() }),
  /** When the data was read from the source — shown to the reader. */
  capturedAt: z.string(),
  /** Caveats worth showing, e.g. "dual order only, no start times published". */
  notes: z.array(z.string()).default([]),
  entries: z.array(dualsEntrySchema).min(1),
  teams: z.array(dualsTeamSchema).min(1),
});

export const dualsEventSchema = dualsEventObjectSchema.superRefine(refineEventIntegrity);

/**
 * Every id referenced must resolve, and slugs must be unique. A dangling id is
 * a broken page in a gym; failing at load makes it a failing test instead.
 */
function refineEventIntegrity(
  event: z.output<typeof dualsEventObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const ids = new Set(event.teams.map((t) => t.id));
  const slugs = new Set<string>();

  for (const team of event.teams) {
    if (slugs.has(team.slug)) {
      ctx.addIssue({ code: 'custom', message: `duplicate team slug: ${team.slug}` });
    }
    slugs.add(team.slug);
  }

  for (const entry of event.entries) {
    if (!ids.has(entry.teamId)) {
      ctx.addIssue({ code: 'custom', message: `entry references unknown teamId: ${entry.teamId}` });
    }
    const seen = new Set<number>();
    for (const round of entry.rounds) {
      if (seen.has(round.round)) {
        ctx.addIssue({
          code: 'custom',
          message: `${entry.teamId} has duplicate round ${round.round}`,
        });
      }
      seen.add(round.round);
      if (round.opponentId !== null && !ids.has(round.opponentId)) {
        ctx.addIssue({
          code: 'custom',
          message: `round ${round.round} references unknown opponentId: ${round.opponentId}`,
        });
      }
    }
  }
}

export type RosterEntry = z.infer<typeof rosterEntrySchema>;
export type DualsTeam = z.infer<typeof dualsTeamSchema>;
export type DualRound = z.infer<typeof dualRoundSchema>;
export type DualsEntry = z.infer<typeof dualsEntrySchema>;
export type DualsEvent = z.infer<typeof dualsEventSchema>;
