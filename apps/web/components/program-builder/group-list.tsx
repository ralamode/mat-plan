import type { ReactNode } from 'react';

import { NAME_WRAP_CLASS, NAV_ROW_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { BuilderLink } from './route-link';

/**
 * The prototype's grouped list (`.menu`): one bordered box with dividers, a link per row (FAM-1
 * lane B: the Programs list, a program's workouts).
 *
 * A row is `NAV_ROW_CLASS` without its own border and corners, its focus ring inset so the box
 * does not clip it. The link stacks its children, so the title, its lines and the `›` sit in a
 * row of their own inside it.
 */
export function GroupList({ children }: { children: ReactNode }) {
  return <ul className="divide-y overflow-hidden rounded-lg border">{children}</ul>;
}

export function GroupRowLink({
  href,
  title,
  className,
  children,
}: {
  href: string;
  title: string;
  /** Classes for the link, e.g. `min-w-0 flex-1` when a button sits beside it in the row. */
  className?: string;
  /** The lines under the title. */
  children: ReactNode;
}) {
  return (
    <BuilderLink
      href={href}
      className={cn(NAV_ROW_CLASS, 'rounded-none border-0 focus-visible:ring-inset', className)}
    >
      <span className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`font-semibold ${NAME_WRAP_CLASS}`}>{title}</span>
          {children}
        </span>
        <span aria-hidden="true" className="shrink-0">
          ›
        </span>
      </span>
    </BuilderLink>
  );
}
