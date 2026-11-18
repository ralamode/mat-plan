import { ClerkRoot } from '@/components/layout/clerk-root';

/** Clerk for the design harness (`ClerkRoot` says why it is per segment and never in the root layout). */
export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return <ClerkRoot>{children}</ClerkRoot>;
}
