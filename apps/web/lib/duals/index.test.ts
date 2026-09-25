import { describe, expect, it } from 'vitest';

import { getEvent, getTeamDaySheet, listDaySheetTeams, listEvents, weightMatchups } from './index';
import { dualsEventSchema, type DualsTeam } from './schema';

const EVENT_SLUG = 'columbus-day-duals-2026';

function team(over: Partial<DualsTeam> & Pick<DualsTeam, 'id' | 'slug' | 'name'>): DualsTeam {
  return { roster: [], ...over };
}

describe('registry', () => {
  it('loads at least one event and every event passes the schema', () => {
    const events = listEvents();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(dualsEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('resolves a known event and rejects an unknown slug', () => {
    expect(getEvent(EVENT_SLUG)?.slug).toBe(EVENT_SLUG);
    expect(getEvent('no-such-event')).toBeNull();
  });
});

describe('getTeamDaySheet', () => {
  it('returns rounds in order with opponents resolved', () => {
    const sheet = getTeamDaySheet(EVENT_SLUG, 'mat-assassins-red-es6');
    expect(sheet).not.toBeNull();
    expect(sheet!.entry.pool).toBe('National Pool B');
    expect(sheet!.rounds.map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sheet!.rounds[0].opponent?.name).toBe('Kraken ES6');
    expect(sheet!.rounds[0].mat).toBe('19');
  });

  it('keeps byes in sequence so round numbers stay aligned', () => {
    const sheet = getTeamDaySheet(EVENT_SLUG, 'wrestling-chix-gk12');
    const byes = sheet!.rounds.filter((r) => r.opponent === null).map((r) => r.round);
    expect(byes).toEqual([1, 2, 4, 6]);
    expect(sheet!.rounds.map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('resolves the truncated-name opponent by id, not by display name', () => {
    // The source bracket renders this as "All I See Is Gold Academy"; there are
    // two such teams in the division. The id join is what disambiguates.
    const sheet = getTeamDaySheet(EVENT_SLUG, 'mat-assassins-black-es6');
    const round3 = sheet!.rounds.find((r) => r.round === 3);
    expect(round3?.opponent?.name).toBe('All I See Is Gold Academy Stripes ES6');
  });

  it('returns null for unknown event or team', () => {
    expect(getTeamDaySheet('nope', 'mat-assassins-red-es6')).toBeNull();
    expect(getTeamDaySheet(EVENT_SLUG, 'nope')).toBeNull();
  });
});

describe('listDaySheetTeams', () => {
  it('lists every entry with its team, ordered by division then pool', () => {
    const event = getEvent(EVENT_SLUG)!;
    const rows = listDaySheetTeams(event);
    expect(rows).toHaveLength(event.entries.length);
    const divisions = rows.map((r) => r.entry.division);
    expect(divisions).toEqual([...divisions].sort((a, b) => a.localeCompare(b)));
  });
});

describe('weightMatchups', () => {
  it('unions both rosters and sorts numerically, non-numeric last', () => {
    const home = team({
      id: 'h',
      slug: 'h',
      name: 'Home',
      roster: [
        { first: 'A', last: 'One', weight: '100', actualWeight: null },
        { first: 'B', last: 'Two', weight: 'Hwt', actualWeight: null },
        { first: 'C', last: 'Three', weight: '68', actualWeight: 67 },
      ],
    });
    const away = team({
      id: 'a',
      slug: 'a',
      name: 'Away',
      roster: [{ first: 'D', last: 'Four', weight: '72', actualWeight: null }],
    });

    expect(weightMatchups(home, away).map((m) => m.weight)).toEqual(['68', '72', '100', 'Hwt']);
  });

  it('shows a weight only one side has entered, as an open spot', () => {
    const home = team({
      id: 'h',
      slug: 'h',
      name: 'Home',
      roster: [{ first: 'A', last: 'One', weight: '68', actualWeight: null }],
    });
    const away = team({ id: 'a', slug: 'a', name: 'Away' });

    const [only] = weightMatchups(home, away);
    expect(only.weight).toBe('68');
    expect(only.home).toHaveLength(1);
    expect(only.away).toHaveLength(0);
  });

  it('allows more than one wrestler at a weight', () => {
    const home = team({
      id: 'h',
      slug: 'h',
      name: 'Home',
      roster: [
        { first: 'A', last: 'One', weight: '68', actualWeight: null },
        { first: 'B', last: 'Two', weight: '68', actualWeight: null },
      ],
    });
    expect(weightMatchups(home, team({ id: 'a', slug: 'a', name: 'Away' }))[0].home).toHaveLength(
      2,
    );
  });
});
