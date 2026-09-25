import { weightMatchups, type DualsTeam } from '@/lib/duals';

/**
 * Weight-by-weight pairing for one dual (DUALS-1, scope B).
 *
 * Shows the union of both rosters' weight classes, so a weight only one side
 * has entered still appears — an open spot is information, not an omission.
 * Both sides are lists because a team can enter more than one wrestler at a
 * weight, and one wrestler can appear on several teams (D7).
 */
export function MatchupTable({ home, away }: { home: DualsTeam; away: DualsTeam }) {
  const rows = weightMatchups(home, away);

  if (rows.length === 0) {
    return <p className="text-muted-foreground px-1 py-3 text-sm">No rosters posted yet.</p>;
  }

  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">
        Weight-by-weight matchups, {home.name} versus {away.name}
      </caption>
      <thead>
        <tr className="text-muted-foreground text-left text-xs uppercase tracking-wide">
          <th scope="col" className="w-12 py-2 font-medium">
            Wt
          </th>
          <th scope="col" className="py-2 font-medium">
            {home.name}
          </th>
          <th scope="col" className="py-2 font-medium">
            {away.name}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.weight} className="border-border/60 border-t align-top">
            <th scope="row" className="text-muted-foreground py-2 text-left font-mono font-medium">
              {row.weight}
            </th>
            <Side entries={row.home} />
            <Side entries={row.away} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Side({ entries }: { entries: ReturnType<typeof weightMatchups>[number]['home'] }) {
  if (entries.length === 0) {
    return (
      <td className="text-muted-foreground/60 py-2 pr-2 italic">
        <span aria-label="no wrestler entered">&mdash;</span>
      </td>
    );
  }

  return (
    <td className="py-2 pr-2">
      {/* Index key: a team can enter two wrestlers who share a name at a weight,
          and the list is static for a render, so position is the stable identity. */}
      {entries.map((entry, i) => (
        <div key={`${entry.first}-${entry.last}-${i}`} className="break-words">
          {entry.first} {entry.last}
          {entry.actualWeight !== null ? (
            <span className="text-muted-foreground"> · {entry.actualWeight}</span>
          ) : null}
        </div>
      ))}
    </td>
  );
}
