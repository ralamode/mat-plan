import { Check, LoaderCircle } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';

/**
 * An icon-only ✓, 44×44 (`icon-lg` + the base `min-h-11`). The one place a ✓ keeps its name while
 * busy: pending swaps the glyph for a spinner, sets `aria-busy` and disables it, and the
 * accessible name stays, so a screen reader never hears the button change identity mid-save.
 * Shared by the log row's `LogTick` and the inline Change's `InlineEditActions`.
 */
export function TickButton({
  label,
  pending = false,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size' | 'children' | 'aria-label'> & {
  /** The accessible name: the glyph alone says nothing to a screen reader. */
  label: string;
  pending?: boolean;
}) {
  return (
    <Button
      {...props}
      size="icon-lg"
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={label}
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
      ) : (
        <Check aria-hidden="true" className="size-5" />
      )}
    </Button>
  );
}
