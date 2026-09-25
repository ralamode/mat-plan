import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getEvent, listDaySheetTeams, listEvents } from '@/lib/duals';

interface Props {
  params: Promise<{ event: string }>;
}

export function generateStaticParams() {
  return listEvents().map((event) => ({ event: event.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = getEvent((await params).event);
  if (!event) return { title: 'Event not found' };

  return {
    title: `${event.name} — day sheets`,
    description: `Round-by-round dual order and mats for ${event.name}.`,
  };
}

/** Team picker for one tournament, grouped by division. */
export default async function DualsEventPage({ params }: Props) {
  const event = getEvent((await params).event);
  if (!event) notFound();

  const rows = listDaySheetTeams(event);
  const byDivision = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byDivision.get(row.entry.division) ?? [];
    list.push(row);
    byDivision.set(row.entry.division, list);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{event.name}</h1>
        <p className="text-muted-foreground">
          {event.startDate} – {event.endDate} · pick a team for its day sheet.
        </p>
      </header>

      {[...byDivision].map(([division, teams]) => (
        <section key={division} className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {division}
          </h2>
          <ul className="flex flex-col gap-2">
            {teams.map(({ team, entry }) => (
              <li key={team.id}>
                <Link
                  href={`/duals/${event.slug}/${team.slug}`}
                  className="border-border hover:bg-muted/50 flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
                >
                  <span className="min-w-0 flex-1 font-medium break-words">{team.name}</span>
                  <span className="text-muted-foreground shrink-0 text-sm">{entry.pool}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <EventFootnotes event={event} />
    </main>
  );
}

export function EventFootnotes({ event }: { event: ReturnType<typeof getEvent> }) {
  if (!event) return null;

  return (
    <footer className="text-muted-foreground border-border/60 flex flex-col gap-1 border-t pt-4 text-xs">
      {event.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      <p>
        Data as of {event.capturedAt} from{' '}
        <a className="underline" href={event.source.url} rel="noreferrer noopener" target="_blank">
          {event.source.name}
        </a>
        . Pools and mats can change on the day.
      </p>
    </footer>
  );
}
