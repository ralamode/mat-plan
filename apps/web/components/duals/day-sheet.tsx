import { MatchupTable } from '@/components/duals/matchup-table';
import type { TeamDaySheet } from '@/lib/duals';

/**
 * A team's run through its pool: round, opponent, mat — the thing a parent
 * re-reads between matches (DUALS-1, scope A).
 *
 * Each round expands in place to the weight-by-weight matchup (scope B). The
 * disclosure is a native `<details>`, so the whole page stays a Server
 * Component and works with no JavaScript — which matters on arena wifi.
 */
export function DaySheet({ sheet }: { sheet: TeamDaySheet }) {
  return (
    <ol className="flex flex-col">
      {sheet.rounds.map((round) => {
        const isBye = round.opponent === null;

        return (
          <li key={round.round} className="border-border/60 border-t last:border-b">
            {isBye ? (
              <div className="flex items-center gap-4 py-4">
                <RoundNumber value={round.round} muted />
                <span className="text-muted-foreground/70 flex-1 italic">Bye</span>
              </div>
            ) : (
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-4 py-4">
                  <RoundNumber value={round.round} />
                  <span className="min-w-0 flex-1 text-lg leading-snug font-semibold break-words">
                    {round.opponent!.name}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-sm font-medium tabular-nums">
                    {round.mat ? `Mat ${round.mat}` : '—'}
                  </span>
                  <span
                    aria-hidden
                    className="text-muted-foreground/60 shrink-0 transition-transform group-open:rotate-90"
                  >
                    ›
                  </span>
                </summary>
                <div className="pb-5">
                  <MatchupTable home={sheet.team} away={round.opponent!} />
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function RoundNumber({ value, muted = false }: { value: number; muted?: boolean }) {
  return (
    <span
      className={`w-7 shrink-0 text-xl font-bold tabular-nums ${muted ? 'text-muted-foreground/50' : 'text-primary'}`}
    >
      {value}
    </span>
  );
}
