import { ClerkRoot } from '@/components/layout/clerk-root';

/**
 * Clerk for the athlete pages (`ClerkRoot` says why it is per segment and never in the root layout).
 *
 * ⚠️ Renders nothing a ✓ changes. The day page's row actions use `refresh()`, which keeps the
 * router's prefetches of this layout; a count rendered here would go stale for up to 5 minutes
 * (PERF-3, `docs/features/write-path.md` → "revalidatePath is not optional").
 */
export default function AthletesLayout({ children }: { children: React.ReactNode }) {
  return <ClerkRoot>{children}</ClerkRoot>;
}
