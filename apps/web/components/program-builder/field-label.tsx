import type { ReactNode } from 'react';

import { BUILDER_COPY } from './builder-text';

/** A field's label, with "(optional)" beside it where a blank is allowed (FAM-1 lane B). */
export function FieldLabel({
  htmlFor,
  optional = false,
  children,
}: {
  htmlFor: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {children}
      {optional ? (
        <span className="text-muted-foreground font-normal"> {BUILDER_COPY.optional}</span>
      ) : null}
    </label>
  );
}
