import { cn } from '@/lib/utils';

/** Shared loading placeholder — a pulsing muted block. Decorative (aria-hidden). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('bg-muted animate-pulse rounded-md', className)} />;
}
