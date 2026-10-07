import * as Sentry from '@sentry/nextjs';

import { env } from '@/lib/env';
import {
  beforeBreadcrumbScrubbed,
  beforeSendLogScrubbed,
  beforeSendScrubbed,
  beforeSendTransactionScrubbed,
  SENTRY_DATA_COLLECTION,
} from '@/lib/sentry-scrub';

/**
 * Sentry — Edge runtime (V1-14a).
 *
 * The app pins `runtime = 'nodejs'` everywhere (pg needs it), so this currently covers only the
 * proxy/middleware layer. Kept because Next loads it for the edge runtime regardless, and an
 * unconfigured runtime would silently drop errors from `proxy.ts`. Same scrubbing as the server config
 * — the middleware sees the gate cookie on every request, so this is not a formality.
 */
Sentry.init({
  dsn: env.SENTRY_DSN,
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: beforeSendScrubbed,
  beforeSendTransaction: beforeSendTransactionScrubbed,
  beforeBreadcrumb: beforeBreadcrumbScrubbed,
  beforeSendLog: beforeSendLogScrubbed,
  tracesSampleRate: 0,
  debug: false,
});
