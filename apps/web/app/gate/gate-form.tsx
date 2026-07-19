'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';

import { submitGate, type GateState } from './actions';

const initialState: GateState = { error: null };

export function GateForm({ from }: { from: string }) {
  const [state, formAction, pending] = useActionState(submitGate, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="from" value={from} />
      <div className="flex flex-col gap-2">
        <label htmlFor="access-code" className="text-sm font-medium">
          Access code
        </label>
        <input
          id="access-code"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? 'gate-error' : undefined}
          className="border-input bg-background focus-visible:ring-ring h-11 rounded-lg border px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      {state.error ? (
        <p id="gate-error" role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="h-11 text-base">
        {pending ? 'Checking…' : 'Enter'}
      </Button>
    </form>
  );
}
