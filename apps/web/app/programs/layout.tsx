import { ClerkRoot } from '@/components/layout/clerk-root';

/** Clerk for the program pages (`ClerkRoot` says why it is per segment and never in the root layout). */
export default function ProgramsLayout({ children }: { children: React.ReactNode }) {
  return <ClerkRoot>{children}</ClerkRoot>;
}
