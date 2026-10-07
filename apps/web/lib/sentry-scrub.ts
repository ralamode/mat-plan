import type { Breadcrumb, ErrorEvent, Event, init, Log } from '@sentry/nextjs';

/**
 * PII scrubbing for Sentry events (V1-14a) — **the security-critical part of the Sentry wiring.**
 *
 * The wiring Sentry's own Next.js docs demonstrate would send three privileged things to a third party,
 * all verified against the SDK source rather than assumed:
 *
 *  1. **The `mp_gate` cookie — the app's entire credential.** `withServerActionInstrumentation(name,
 *     { headers }, cb)` copies EVERY header into the isolation scope. Sentry 10's
 *     `sendDefaultPii: false` still collected cookies (a deny-list `mp_gate` matched nothing in), and
 *     Sentry 11 replaced that switch with `dataCollection`, whose every field defaults to ON. So
 *     `SENTRY_DATA_COLLECTION` below turns each one off, and this scrubber is the second line. (We
 *     also never pass `headers`.)
 *  2. **A kid's bodyweight.** `withServerActionInstrumentation`'s `formData` option does
 *     `setExtra('server_action_form_data.' + key, value)`. `.github/SECURITY.md`: "Kid bodyweight is
 *     privileged … never logged." (We never pass `formData`; again, defence in depth.)
 *  3. **The plaintext access code**, by the same route on the gate action.
 *  4. **Query parameters, bodyweight included (SEC-3).** drizzle-orm's `DrizzleQueryError` message is
 *     `Failed query: <sql>\nparams: <values>`, and the instrumentation captures it on ANY driver
 *     failure (a timeout, a dropped connection) — so a weigh-in write that fails ships the weight.
 *     The SQL half has placeholders, not values, and is kept; everything from the `params:` line on
 *     goes. `extraErrorDataIntegration` (if ever enabled) would also copy the error's own `params`
 *     property into `contexts`/`extra`, so any key named `params` is dropped there too.
 *
 * Sentry 11's defaults also collect REQUEST BODIES (a Server Action's body is its form: a weight, the
 * access code) and STACK-FRAME LOCAL VARIABLES (a writer's locals hold the row it was writing). Both
 * are off in `SENTRY_DATA_COLLECTION`, and both are stripped here too, so a future SDK default or a
 * config edit cannot reopen either on its own.
 *
 * So this runs on every error event and every transaction (spans included), and — through
 * `beforeBreadcrumbScrubbed` and `beforeSendLogScrubbed` — on every breadcrumb and every Sentry log. Its
 * test is the assertion that matters most in V1-14a. Not covered: spans sent standalone (span streaming,
 * `beforeSendSpan`), which this app does not enable (`tracesSampleRate: 0`). It strips rather than redacts: none of this is diagnostically useful, and a redacted marker
 * would only tempt someone to "temporarily" turn it off.
 */

/** The `dataCollection` option's type, read off `Sentry.init` (the SDK does not export it by name). */
type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>['dataCollection']>;

/**
 * What the Sentry SDK may collect on its own, set field by field (Sentry 11). Every field defaults to
 * ON, so an omitted field is a field that collects. The `Required<…>` type makes that a compile
 * error: a Sentry release that adds a field fails the typecheck here until someone decides it.
 * Both `sentry.server.config.ts` and `sentry.edge.config.ts` pass this one object.
 *
 * Left at its default: `frameContextLines` (source-code lines around a frame — code, not user data,
 * and minified anyway while source maps are off).
 */
export const SENTRY_DATA_COLLECTION: Required<Omit<DataCollection, 'frameContextLines'>> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

/** Request headers that must never leave the server, lower-cased for comparison. */
const DENIED_HEADERS = ['cookie', 'set-cookie', 'authorization', 'proxy-authorization'];

/** The `extra` key prefix Sentry uses for Server Action form fields (`formData` option). */
const FORM_DATA_EXTRA_PREFIX = 'server_action_form_data.';

/**
 * A line starting `params:` and everything after it — drizzle's `DrizzleQueryError` tail (SEC-3).
 * Also after a LITERAL backslash-n, which is what the newline becomes once the message has been through
 * `JSON.stringify` (a serialized or re-logged error).
 */
const QUERY_PARAMS_TAIL = /(^|\n|\\n)[ \t]*params:[\s\S]*$/;

/** The object key drizzle's error carries its values under, wherever an integration copies it. */
const PARAMS_KEY = 'params';

/** Cut a query's params off a message, keeping the SQL. Non-strings pass through. */
function stripQueryParams<T>(value: T): T {
  return (typeof value === 'string' ? value.replace(QUERY_PARAMS_TAIL, '') : value) as T;
}

/**
 * Walk a plain object/array tree in place: delete every key named `params`, and cut the query params
 * off EVERY string it holds. Both halves matter — Sentry normalizes a logged error into an object whose
 * `params` key collapses to "[Array]" while its `message` and `stack` STRINGS still carry the values
 * (the console integration's breadcrumb `data.arguments`, for one).
 */
/** Deeper than Sentry's own `normalizeDepth`, so a normalized event is walked in full; the cap only
 *  bounds raw breadcrumb data, which arrives before normalization. */
const MAX_SCRUB_DEPTH = 20;

function scrubTree(node: unknown, seen = new Set<unknown>(), depth = 0): void {
  if (!node || typeof node !== 'object' || seen.has(node) || depth > MAX_SCRUB_DEPTH) return;
  seen.add(node);
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === PARAMS_KEY && !Array.isArray(node)) {
      delete record[key];
      continue;
    }
    const value = record[key];
    if (typeof value === 'string') {
      // Write only when something changed: never touch a caller-owned object needlessly.
      const stripped = stripQueryParams(value);
      if (stripped !== value) record[key] = stripped;
    } else scrubTree(value, seen, depth + 1);
  }
}

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
    // The request body: for a Server Action, its form fields (a weight, the access code).
    delete event.request.data;
  }

  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (key.startsWith(FORM_DATA_EXTRA_PREFIX)) delete event.extra[key];
    }
  }

  // SEC-3: query params, wherever the message or an integration put them.
  for (const exception of event.exception?.values ?? []) {
    exception.value = stripQueryParams(exception.value);
    // Local variables captured per frame: a writer's locals hold the values it was writing.
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  event.message = stripQueryParams(event.message);
  if (event.logentry) {
    event.logentry.message = stripQueryParams(event.logentry.message);
    scrubTree(event.logentry); // its own `params` are the message's format arguments — values too
  }
  for (const crumb of event.breadcrumbs ?? []) scrubBreadcrumb(crumb);
  scrubTree(event.extra);
  scrubTree(event.contexts);
  // A transaction's spans: Next records the error message as a span's status/description.
  scrubTree(event.spans);

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

/**
 * Scrub one breadcrumb in place. A `console` breadcrumb's `data.arguments` is the logged value itself —
 * Next logs a failed action with `console.error(err)` — so it is dropped outright (its `message` is
 * kept, stripped); everything else is walked.
 */
function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  crumb.message = stripQueryParams(crumb.message);
  if (crumb.category === 'console' && crumb.data) delete crumb.data.arguments;
  scrubTree(crumb.data);
  return crumb;
}

/** `beforeBreadcrumb` hook — scrubs at record time, before a breadcrumb can ride along on ANY event. */
export function beforeBreadcrumbScrubbed(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Breadcrumb data is RAW (not yet normalized): a frozen object or a throwing getter would throw here,
  // and `addBreadcrumb` does not catch. Fail closed — drop the breadcrumb rather than keep it unscrubbed.
  // (A live Error's non-enumerable message/stack is missed here but re-walked, normalized, in beforeSend.)
  try {
    return scrubBreadcrumb(breadcrumb);
  } catch {
    return null;
  }
}

/**
 * `beforeSendLog` hook (Sentry logs). Inert until `enableLogs` is turned on (AGENTS.md → Observability
 * plans it), wired now so turning logs on cannot reopen SEC-3.
 */
export function beforeSendLogScrubbed(log: Log): Log {
  log.message = stripQueryParams(log.message);
  scrubTree(log.attributes);
  return log;
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
