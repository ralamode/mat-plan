'use client';

import Link from 'next/link';
import { createContext, use, type ComponentProps } from 'react';

/**
 * Whether the program builder's links prefetch their route (FAM-1 7a-ii, for the design preview).
 *
 * A Next `<Link>` prefetches its route as it comes into view. On the preview route
 * (`app/design/program/`) the screens hold fixture ids, so every `/programs/<fixture id>` it
 * prefetches is a page that answers 404, and the browser logs it. The preview's harness provides
 * `false` here (the roadmap thread wires it); a real page provides nothing, and its links prefetch as
 * Next does by default.
 */
export const BuilderLinkPrefetch = createContext<boolean>(true);

/** A link of the program builder's screens: Next's `<Link>`, prefetching unless the preview says not. */
export function BuilderLink(props: ComponentProps<typeof Link>) {
  const prefetch = use(BuilderLinkPrefetch);
  return <Link {...props} prefetch={prefetch ? props.prefetch : false} />;
}
