import { EVENTS } from './registry';
import type { DualsEntry, DualsEvent, DualsTeam, RosterEntry } from './schema';

export type { DualsEntry, DualsEvent, DualsTeam, RosterEntry } from './schema';

/** A team's schedule plus the resolved event/team it belongs to. */
export interface TeamDaySheet {
  event: DualsEvent;
  team: DualsTeam;
  entry: DualsEntry;
  /** Rounds with the opponent resolved; `opponent: null` is a bye. */
  rounds: Array<{ round: number; mat: string | null; opponent: DualsTeam | null }>;
}

/** One weight class, with whoever each side has entered there. */
export interface WeightMatchup {
  weight: string;
  home: RosterEntry[];
  away: RosterEntry[];
}

export function listEvents(): readonly DualsEvent[] {
  return EVENTS;
}

export function getEvent(slug: string): DualsEvent | null {
  return EVENTS.find((e) => e.slug === slug) ?? null;
}

/**
 * Sort key for a weight class. Weights are strings because not all are numeric
 * ("Hwt"), so numeric ones sort by value and the rest sort last, alphabetically.
 */
function weightKey(weight: string): [number, number, string] {
  const numeric = /^\s*(\d+(?:\.\d+)?)/.exec(weight);
  return numeric ? [0, Number(numeric[1]), ''] : [1, 0, weight.toLowerCase()];
}

function compareWeights(a: string, b: string): number {
  const [ka, va, sa] = weightKey(a);
  const [kb, vb, sb] = weightKey(b);
  return ka - kb || va - vb || sa.localeCompare(sb);
}

/**
 * Resolve one team's day sheet. Returns `null` for an unknown event or team, so
 * the route can `notFound()` rather than throw.
 */
export function getTeamDaySheet(eventSlug: string, teamSlug: string): TeamDaySheet | null {
  const event = getEvent(eventSlug);
  if (!event) return null;

  const team = event.teams.find((t) => t.slug === teamSlug);
  if (!team) return null;

  const entry = event.entries.find((e) => e.teamId === team.id);
  if (!entry) return null;

  const byId = new Map(event.teams.map((t) => [t.id, t]));
  const rounds = [...entry.rounds]
    .sort((a, b) => a.round - b.round)
    .map((r) => ({
      round: r.round,
      mat: r.mat,
      opponent: r.opponentId ? (byId.get(r.opponentId) ?? null) : null,
    }));

  return { event, team, entry, rounds };
}

/** Every team in an event that has a day sheet, in division → pool → name order. */
export function listDaySheetTeams(
  event: DualsEvent,
): Array<{ team: DualsTeam; entry: DualsEntry }> {
  const byId = new Map(event.teams.map((t) => [t.id, t]));
  return event.entries
    .flatMap((entry) => {
      const team = byId.get(entry.teamId);
      return team ? [{ team, entry }] : [];
    })
    .sort(
      (a, b) =>
        a.entry.division.localeCompare(b.entry.division) ||
        a.entry.pool.localeCompare(b.entry.pool) ||
        a.team.name.localeCompare(b.team.name),
    );
}

/**
 * Pair two rosters weight-by-weight.
 *
 * The union of both sides' weight classes, so a weight only one team has still
 * shows — that is an open spot, which is exactly what a parent wants to see.
 * Both sides are arrays because a team can enter more than one wrestler at a
 * weight (and one wrestler can appear on several teams — see D7).
 */
export function weightMatchups(home: DualsTeam, away: DualsTeam): WeightMatchup[] {
  const weights = new Set<string>([
    ...home.roster.map((r) => r.weight),
    ...away.roster.map((r) => r.weight),
  ]);

  return [...weights].sort(compareWeights).map((weight) => ({
    weight,
    home: home.roster.filter((r) => r.weight === weight),
    away: away.roster.filter((r) => r.weight === weight),
  }));
}
