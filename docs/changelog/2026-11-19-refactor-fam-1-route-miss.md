- **2026-11-19** — **Per-user routes answer a miss the same way, and never cache it.** The export
  (`app/p/[profileId]/export/route.ts`) and the how-to (`app/programs/how-to/[optionId]/route.ts`)
  now share one `notFound()` and `NO_STORE` (`apps/web/lib/route-miss.ts`). As a result the export's
  404s carry `no-store, private` too, as its success did. From lane B's #624 review.
