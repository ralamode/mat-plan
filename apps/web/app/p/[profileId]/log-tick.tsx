'use client';

import { Check, LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * The ✓ that logs a single value (V1-24 3b-bw W4; shared with practice at 3b-life-b B2, B3).
 *
 * - **Outline while its field is empty**, so an unlogged ✓ never reads as done: the filled DONE tick is
 *   the logged row's.
 * - **Filled (primary, never the done green) while its field holds a value** _(maintainer,
 *   2026-11-16)_: with a weight field and a minutes field on one page, a kid can fill both and tap one
 *   ✓, and a ready-but-unsent row must not look like an empty one.
 * - **Pending:** a spinner replaces the glyph, with `aria-busy`. `icon-lg` keeps it 44px.
 */
export function LogTick({
  label,
  pending,
  ready,
}: {
  /** The accessible name: the glyph alone says nothing to a screen reader. */
  label: string;
  pending: boolean;
  /** The field holds an unsent value. */
  ready: boolean;
}) {
  return (
    <Button
      type="submit"
      variant={ready ? 'default' : 'outline'}
      size="icon-lg"
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={label}
      data-ready={ready || undefined}
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
      ) : (
        <Check aria-hidden="true" className="size-5" />
      )}
    </Button>
  );
}

/**
 * Copy that names the ✓ (`Enter the minutes, then ✓.`): the glyph is `aria-hidden`, and the button's own
 * name is read in its place, so a screen reader hears "then Log wrestling practice".
 */
export function TickedCopy({ text, buttonLabel }: { text: string; buttonLabel: string }) {
  // Copy that does not name the ✓ is rendered as it is: never a glyph it did not contain.
  if (!text.includes('✓')) return <>{text}</>;
  const [before, after] = text.split('✓');
  return (
    <>
      {before}
      <span aria-hidden="true">✓</span>
      <span className="sr-only">{buttonLabel}</span>
      {after}
    </>
  );
}
