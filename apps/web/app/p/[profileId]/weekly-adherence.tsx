import type { AdherenceDTO } from '@/lib/dal/adherence';

/**
 * "This week" calisthenics ramp adherence (V1-6b-2): per metric that has a target this week, a
 * native `<progress>` of actual vs the coach's weekly target. Server component (RSC-first, no
 * `'use client'`); the page renders it only when there are rows. Semantics come from the native
 * elements — a real `<label>` names the metric, `<progress value max>` carries the meaning — so no
 * ARIA and no div-soup. The card shell mirrors the "Calisthenics today" totals card (accepted, not
 * extracted — the rows differ; rule of three).
 */
export function WeeklyAdherence({ rows }: { rows: readonly AdherenceDTO[] }) {
  return (
    <section
      aria-labelledby="ramp-week-heading"
      className="flex flex-col gap-3 rounded-lg border px-4 py-3"
    >
      <h2 id="ramp-week-heading" className="text-lg font-medium">
        This week
      </h2>
      <ul className="flex flex-col gap-4">
        {rows.map((r) => {
          const id = `ramp-${r.metricKey}`;
          return (
            <li key={r.metricKey} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={id} className="text-base">
                  {r.label}
                </label>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {r.actual} / {r.target}
                </span>
              </div>
              {/* Native progress: value/max are the semantics; the child text is the a11y fallback. */}
              <progress
                id={id}
                value={r.actual}
                max={r.target}
                className="bg-muted [&::-webkit-progress-bar]:bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-value]:bg-primary h-2.5 w-full appearance-none overflow-hidden rounded-full"
              >
                {r.actual} of {r.target}
              </progress>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
