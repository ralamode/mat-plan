import { ClerkRoot } from '@/components/layout/clerk-root';

/** Clerk for household settings (`ClerkRoot` says why it is per segment and never in the root layout). */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <ClerkRoot>{children}</ClerkRoot>;
}
