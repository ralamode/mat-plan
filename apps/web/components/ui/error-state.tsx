import { cn } from '@/lib/utils';

/**
 * Shared error-state block (presentational). `role="alert"` so it's announced.
 * Actions (e.g. a retry button) are passed as children by the caller — this
 * component stays handler-free so it works in server or client trees.
 */
export function ErrorState({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'border-destructive/30 bg-destructive/5 flex flex-col items-center gap-3 rounded-lg border p-6 text-center',
        className,
      )}
    >
      <h2 className="text-base font-medium">{title}</h2>
      {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      {children}
    </div>
  );
}
