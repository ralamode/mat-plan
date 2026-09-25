import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EventFootnotes } from '@/app/duals/[event]/page';
import { DaySheet } from '@/components/duals/day-sheet';
import { getTeamDaySheet, listEvents, listDaySheetTeams } from '@/lib/duals';

interface Props {
  params: Promise<{ event: string; team: string }>;
}

export function generateStaticParams() {
  return listEvents().flatMap((event) =>
    listDaySheetTeams(event).map(({ team }) => ({ event: event.slug, team: team.slug })),
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { event: eventSlug, team: teamSlug } = await params;
  const sheet = getTeamDaySheet(eventSlug, teamSlug);
  if (!sheet) return { title: 'Team not found' };

  const duals = sheet.rounds.filter((r) => r.opponent !== null).length;

  // The link preview is the forward loop — a bare URL in a team chat reads as
  // broken, so title and description are deliberate.
  return {
    title: `${sheet.team.name} — ${sheet.event.name}`,
    description: `${sheet.entry.pool} · ${duals} duals · round-by-round order and mats.`,
    openGraph: {
      title: `${sheet.team.name} — ${sheet.entry.pool}`,
      description: `${duals} duals at ${sheet.event.name}. Round order and mats.`,
    },
  };
}

/** One team's day sheet: round, opponent, mat — each expanding to the matchups. */
export default async function TeamDaySheetPage({ params }: Props) {
  const { event: eventSlug, team: teamSlug } = await params;
  const sheet = getTeamDaySheet(eventSlug, teamSlug);
  if (!sheet) notFound();

  const duals = sheet.rounds.filter((r) => r.opponent !== null).length;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <Link
          href={`/duals/${sheet.event.slug}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {sheet.event.name}
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <h1 className="text-3xl leading-tight font-semibold tracking-tight">{sheet.team.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge>{sheet.entry.pool}</Badge>
          <Badge muted>{sheet.entry.division}</Badge>
          <Badge muted>
            {duals} {duals === 1 ? 'dual' : 'duals'}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Tap a round for the weight-by-weight matchup.
        </p>
      </header>

      <DaySheet sheet={sheet} />

      <EventFootnotes event={sheet.event} />
    </main>
  );
}

function Badge({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        muted ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'
      }`}
    >
      {children}
    </span>
  );
}
