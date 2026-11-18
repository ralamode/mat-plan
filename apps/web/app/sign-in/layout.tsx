import { ClerkRoot } from '@/components/layout/clerk-root';

/** Clerk for the sign-in screen (`ClerkRoot` says why it is per segment and never in the root layout). */
export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <ClerkRoot>{children}</ClerkRoot>;
}
