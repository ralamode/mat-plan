'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';

/**
 * Route error boundary (V0-10). Catches anything thrown while rendering the
 * segment — e.g. the DB being unreachable — and shows a recoverable error state
 * instead of a crash. `reset()` re-renders the segment (retry). Logs to the
 * console for now; folds into Sentry once observability lands (V1-14).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-12">
      <ErrorState
        title="Something went wrong"
        description="We couldn’t load this page. This is usually temporary — try again."
      >
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </ErrorState>
    </main>
  );
}
