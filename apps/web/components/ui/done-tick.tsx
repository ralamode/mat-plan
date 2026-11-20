import { cn } from '@/lib/utils';

/**
 * The filled tick of something logged: a logged value row (bodyweight, practice) and a collapsed
 * part's line (FAM-1 12c-iii). Hidden from a screen reader: the text beside it says what is done.
 */
export function DoneTick({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-done text-done-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm',
        className,
      )}
    >
      ✓
    </span>
  );
}
