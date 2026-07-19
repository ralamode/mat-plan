import { safeInternalPath } from '@/lib/access-gate';

import { GateForm } from './gate-form';

/** Access-gate stopgap entry page (V0-4). Replaced by Clerk household login at v1.5. */
export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const safeFrom = safeInternalPath(from);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-12">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">mat-plan</h1>
        <p className="text-muted-foreground text-sm">
          Private preview. Enter the household access code to continue.
        </p>
      </header>
      <GateForm from={safeFrom} />
    </main>
  );
}
