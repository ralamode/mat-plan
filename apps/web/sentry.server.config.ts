import * as Sentry from '@sentry/nextjs';

import { env } from '@/lib/env';
import { beforeSendScrubbed, beforeSendTransactionScrubbed } from '@/lib/sentry-scrub';

/**
 * Sentry — Node runtime (V1-14a; ADR-0001 schedules error monitoring for V1-14).
 *
 * Loaded by `instrumentation.ts`'s `register()`, i.e. server-side only, so importing `@/lib/env` is
 * safe here: the `server-only` guard trips in a CLIENT bundle, which this never enters. That keeps the
 * "only lib/env.ts reads process.env" rule intact (the one carve-out is `NEXT_RUNTIME` in register()).
 *
 * NO DSN => `Sentry.init` is a no-op and the app behaves exactly as before. That is the normal state
 * locally and in CI, by design.
 */
Sentry.init({
  dsn: env.SENTRY_DSN,

  // PII: the SDK's `sendDefaultPii: false` is NOT sufficient here — its non-PII cookie default is a
  // deny-OBJECT, and `mp_gate` matches none of its sensitive-name snippets. The real guarantee is the
  // scrubber below (unit-tested in lib/sentry-scrub.test.ts) plus never passing `headers`/`formData`
  // to `withServerActionInstrumentation`.
  sendDefaultPii: false,
  beforeSend: beforeSendScrubbed,
  beforeSendTransaction: beforeSendTransactionScrubbed,

  // Errors only for now. Tracing/replay/Web-Vitals are later ADR-0001 phases; sampling them here would
  // add cost and noise before anyone is reading the dashboard.
  tracesSampleRate: 0,

  // Quieter local runs; a DSN is normally absent locally anyway.
  debug: false,
});
