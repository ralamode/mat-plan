import Link from 'next/link';

import { NoHouseholdState } from '@/components/onboarding/no-household-state';
import { APP_HOME_PATH, HOME_LINK, NAV_LINK_CLASS, NO_HOUSEHOLD_COPY } from '@/lib/constants';

/**
 * The no-household screen for a page that is NOT the picker (`/settings`, `/p/new`): a way back to
 * `/p`, the `<h1>` that `NoHouseholdState` requires its page to supply, then the block itself.
 *
 * The way back matters most here. With no household there is no rail at any width, and the block
 * tells the reader to sign out, which only `/p` offers. `/p` renders its own heading and sign out,
 * so it does not use this.
 */
export function NoHouseholdPage() {
  return (
    <>
      <header className="flex flex-col gap-2">
        <Link href={APP_HOME_PATH} className={NAV_LINK_CLASS}>
          {HOME_LINK}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{NO_HOUSEHOLD_COPY.heading}</h1>
      </header>
      <NoHouseholdState />
    </>
  );
}
