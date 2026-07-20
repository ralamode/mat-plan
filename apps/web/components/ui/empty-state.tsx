import { cn } from '@/lib/utils';

/** Shared empty-state box — a dashed, muted container for "nothing here yet" copy. */
export function EmptyState({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'text-muted-foreground rounded-lg border border-dashed p-6 text-center',
        className,
      )}
    >
      {children}
    </p>
  );
}
