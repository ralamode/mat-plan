import type { ErrorEvent, Event } from '@sentry/nextjs';

/**
 * PII scrubbing for Sentry events (V1-14a) — **the security-critical part of the Sentry wiring.**
 *
 * The wiring Sentry's own Next.js docs demonstrate would send three privileged things to a third party,
 * all verified against the SDK source rather than assumed:
 *
 *  1. **The `mp_gate` cookie — the app's entire credential.** `withServerActionInstrumentation(name,
 *     { headers }, cb)` copies EVERY header into the isolation scope. With `sendDefaultPii: false`,
 *     `requestDataIntegration`'s non-PII default is `cookies: { deny: PII_HEADER_SNIPPETS }` — a deny
 *     *object*, NOT `false` — so cookies are still included, and `mp_gate` matches none of the SDK's
 *     sensitive-name snippets. (We also never pass `headers`; this is the second line of defence.)
 *  2. **A kid's bodyweight.** `withServerActionInstrumentation`'s `formData` option does
 *     `setExtra('server_action_form_data.' + key, value)`. `.github/SECURITY.md`: "Kid bodyweight is
 *     privileged … never logged." (We never pass `formData`; again, defence in depth.)
 *  3. **The plaintext access code**, by the same route on the gate action.
 *
 * So this runs on every event and every transaction, and its test is the assertion that matters most in
 * V1-14a. It strips rather than redacts: none of this is diagnostically useful, and a redacted marker
 * would only tempt someone to "temporarily" turn it off.
 */

/** Request headers that must never leave the server, lower-cased for comparison. */
const DENIED_HEADERS = ['cookie', 'set-cookie', 'authorization', 'proxy-authorization'];

/** The `extra` key prefix Sentry uses for Server Action form fields (`formData` option). */
const FORM_DATA_EXTRA_PREFIX = 'server_action_form_data.';

/**
 * Strip credentials and PII from a Sentry event, in place-ish (returns the same object).
 * Exported separately from the config so it is unit-testable without booting the SDK.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
  if (event.request) {
    // `cookies` is the SDK's parsed form; the raw `cookie` header is a SEPARATE copy — both go.
    delete event.request.cookies;
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (DENIED_HEADERS.includes(name.toLowerCase())) delete event.request.headers[name];
      }
    }
    // A query string could carry a `from` redirect or future token; not worth the risk.
    delete event.request.query_string;
  }

  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (key.startsWith(FORM_DATA_EXTRA_PREFIX)) delete event.extra[key];
    }
  }

  // Contexts can carry a duplicate of the request under `contexts.request` on some paths.
  const requestContext = event.contexts?.request;
  if (requestContext) {
    delete requestContext.cookies;
    const headers = requestContext.headers;
    if (headers && typeof headers === 'object') {
      for (const name of Object.keys(headers as Record<string, unknown>)) {
        if (DENIED_HEADERS.includes(name.toLowerCase())) {
          delete (headers as Record<string, unknown>)[name];
        }
      }
    }
  }

  return event;
}

/** `beforeSend` hook (errors). Kept as a named export so the config reads declaratively. The SDK passes
 *  an `EventHint` second argument; it is deliberately not in the signature — a function of lower arity is
 *  assignable, and naming an unused parameter only invites a lint suppression. */
export function beforeSendScrubbed(event: ErrorEvent): ErrorEvent {
  return scrubSentryEvent(event);
}

/**
 * `beforeSendTransaction` hook (performance). Same scrubbing — a transaction carries request data too.
 *
 * GENERIC on purpose: the SDK types this hook as `(event: TransactionEvent, …) => TransactionEvent`,
 * which is narrower than `Event`. `TransactionEvent` is exported from `@sentry/core` — a TRANSITIVE
 * dependency — and reaching across that boundary to import a type would couple us to the SDK's internal
 * package layout. Inferring `T` at the call site satisfies the signature with no such import.
 */
export function beforeSendTransactionScrubbed<T extends Event>(event: T): T {
  return scrubSentryEvent(event);
}
