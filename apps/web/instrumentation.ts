import * as Sentry from '@sentry/nextjs';

/**
 * Next.js instrumentation hook (V1-14a) — the Next 16 way to initialise Sentry. Must live at the
 * `apps/web` ROOT (Next requires it beside `app/`, not inside it); AGENTS.md's hierarchy rule allows
 * tool-mandated root files.
 *
 * `register()` runs once per server process, BEFORE the app handles a request.
 */
export async function register(): Promise<void> {
  // The ONE sanctioned `process.env` read outside lib/env.ts: Next sets NEXT_RUNTIME to pick which
  // config to load, and this runs before (and in order to set up) the validated-env world.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Captures errors thrown in RSCs, route handlers and other server components — the paths
 * `withServerActionInstrumentation` does NOT cover. ADR-0001 wants back-end error capture, and without
 * this an RSC throw would render `error.tsx` and vanish, which is today's behaviour.
 *
 * KNOWN, ACCEPTED: a Server Action throw is captured twice — once by the action wrapper (which
 * re-throws) and once here. Two issues per incident is cosmetic at this volume, and dropping this hook
 * would lose RSC coverage entirely, which is the larger gap.
 */
export const onRequestError = Sentry.captureRequestError;
