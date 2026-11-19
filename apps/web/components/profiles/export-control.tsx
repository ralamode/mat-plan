import {
  EXPORT_CSV_LABEL,
  NAV_LINK_CLASS,
  NOTHING_TO_EXPORT,
  athleteExportPath,
} from '@/lib/constants';

/**
 * **An athlete's export control** (V1-13b), one component for its two surfaces: the day page's foot
 * and a settings row. Three states, decided in one place:
 *
 * - **The owner, history logged:** the download link.
 * - **The owner, nothing logged:** the reason, never a link (maintainer decision N3: the route would
 *   build an EOCD-only zip that iOS Files opens as nothing, indistinguishable from a failed download).
 * - **Anyone else:** nothing at all (FAM-1 export follow-up, plan PR B; the maintainer's Q1,
 *   2026-11-19: only the household's owner downloads an export). The whole branch is gated, not
 *   only the link: "nothing to export" shown to a non-owner would tell them an export exists for
 *   them. No replacement copy until a member login exists (Q3); `ID-1` owes it.
 *
 * `canExport` is `householdState().canExportAthletes`, a boolean from the DAL, never the role and
 * never the scope (`write-path.md` invariant 2).
 *
 * A plain `<a>`, not a `<Link>`: a file download, which Next's client router would try to navigate
 * to. `NAV_LINK_CLASS` keeps the 44px bar and lets it wrap at 200% text, where `Button asChild`'s
 * `whitespace-nowrap shrink-0` clipped it in a 296px settings card.
 */
export function ExportControl({
  profileId,
  hasHistory,
  canExport,
  ariaLabel,
  reasonClassName = `${NAV_LINK_CLASS} flex items-center`,
}: {
  profileId: string;
  hasHistory: boolean;
  canExport: boolean;
  /**
   * The link's accessible name where the visible label alone is ambiguous (a list of athletes).
   * SC 2.5.3: it must CONTAIN the visible text, so the caller starts it with `EXPORT_CSV_LABEL`.
   */
  ariaLabel?: string;
  /** How the no-history reason sits on its surface; defaults to the day page's bar. */
  reasonClassName?: string;
}) {
  if (!canExport) return null;
  if (!hasHistory) return <p className={reasonClassName}>{NOTHING_TO_EXPORT}</p>;
  return (
    <a
      href={athleteExportPath(profileId)}
      download
      className={NAV_LINK_CLASS}
      aria-label={ariaLabel}
    >
      {EXPORT_CSV_LABEL}
    </a>
  );
}
