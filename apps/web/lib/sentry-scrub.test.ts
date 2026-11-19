import type { ErrorEvent, Event } from '@sentry/nextjs';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { format } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  beforeBreadcrumbScrubbed,
  beforeSendLogScrubbed,
  beforeSendScrubbed,
  beforeSendTransactionScrubbed,
  scrubSentryEvent,
  SENTRY_DATA_COLLECTION,
  maskIds,
} from './sentry-scrub';

/**
 * V1-14a — THE security assertion of the Sentry wiring. Each case below corresponds to a real leak path
 * traced through the SDK source, not a hypothetical: the SDK's non-PII cookie default is a deny-OBJECT
 * (so cookies are included and Clerk's names match none of its sensitive-name snippets), and the
 * `formData` option writes each field as a `server_action_form_data.*` extra.
 */

describe('scrubSentryEvent — the gate cookie never leaves the server', () => {
  it('drops the parsed cookies object', () => {
    const event = scrubSentryEvent({
      request: { cookies: { __session: 'a.real.session.jwt' } },
    } as Event);
    expect(event.request?.cookies).toBeUndefined();
  });

  it('drops the RAW cookie header too — it is a separate copy from `cookies`', () => {
    const event = scrubSentryEvent({
      request: { headers: { cookie: '__session=a.real.session.jwt', 'user-agent': 'x' } },
    } as Event);
    expect(event.request?.headers?.cookie).toBeUndefined();
    // Non-sensitive headers survive — this is a scrub, not a wipe.
    expect(event.request?.headers?.['user-agent']).toBe('x');
  });

  it('drops the Referer header: under same-origin it names the athlete page and day', () => {
    const event = scrubSentryEvent({
      request: {
        headers: {
          referer: 'https://app.example/p/018f3c5e-7b1a-7c3e-9d2f-0123456789ab?d=2026-11-19',
          'user-agent': 'x',
        },
      },
    } as Event);
    expect(event.request?.headers?.referer).toBeUndefined();
    expect(event.request?.headers?.['user-agent']).toBe('x');
  });

  it('is case-insensitive on header names', () => {
    const event = scrubSentryEvent({
      request: { headers: { Cookie: 'x', AUTHORIZATION: 'Bearer y' } },
    } as unknown as Event);
    expect(Object.keys(event.request?.headers ?? {})).toEqual([]);
  });

  it('scrubs the duplicate under contexts.request', () => {
    const event = scrubSentryEvent({
      contexts: { request: { cookies: { __session: 'x' }, headers: { cookie: '__session=x' } } },
    } as unknown as Event);
    const ctx = event.contexts?.request as { cookies?: unknown; headers?: Record<string, unknown> };
    expect(ctx.cookies).toBeUndefined();
    expect(ctx.headers?.cookie).toBeUndefined();
  });
});

describe('scrubSentryEvent — privileged form data never leaves the server', () => {
  it('drops a kid’s bodyweight (SECURITY.md: bodyweight is privileged, never logged)', () => {
    const event = scrubSentryEvent({
      extra: {
        'server_action_form_data.value': '72.5',
        'server_action_form_data.notes': 'felt heavy',
        'server_action_form_data.profileId': '019826b4-0000-7000-8000-000000000001',
      },
    } as Event);
    expect(event.extra).toEqual({});
  });

  it('drops the plaintext access code from the gate action', () => {
    const event = scrubSentryEvent({
      extra: { 'server_action_form_data.password': 'the-real-household-code' },
    } as Event);
    expect(event.extra).toEqual({});
  });

  it('keeps non-form extras — deliberate diagnostic context must survive', () => {
    const event = scrubSentryEvent({
      extra: { actionName: 'logBodyweightAction', 'server_action_form_data.value': '72.5' },
    } as Event);
    expect(event.extra).toEqual({ actionName: 'logBodyweightAction' });
  });
});

describe('scrubSentryEvent — shape safety', () => {
  it('tolerates an event with no request/extra/contexts (most events)', () => {
    expect(() => scrubSentryEvent({} as Event)).not.toThrow();
  });

  it('drops the query string (a `from` redirect today, a token tomorrow)', () => {
    const event = scrubSentryEvent({ request: { query_string: 'from=%2Fp%2Fabc' } } as Event);
    expect(event.request?.query_string).toBeUndefined();
  });

  it('beforeSendScrubbed returns the event so Sentry still sends it (never null)', () => {
    const event = beforeSendScrubbed({
      type: undefined,
      request: { cookies: { __session: 'x' } },
    } as ErrorEvent);
    expect(event).not.toBeNull();
    expect(event.request?.cookies).toBeUndefined();
  });
});

// SEC-3 — a DB failure inside a write must not ship the write's values. drizzle-orm's
// `DrizzleQueryError` message embeds `params: …` after the SQL, and the instrumentation captures it on
// any driver error. Built from the REAL error class so a drizzle message-format change shows up here.
describe('scrubSentryEvent — query params never leave the server (SEC-3)', () => {
  // Neutral numbers; what matters is that they appear in the message and must not survive.
  const PARAMS = [123.45, 'bw-row-id'];
  const err = new DrizzleQueryError(
    'update "entries" set "value_num" = $1 where "public_id" = $2',
    PARAMS,
  );

  it('the real DrizzleQueryError message carries the params (the leak this guards)', () => {
    expect(err.message).toContain('params:');
    expect(err.message).toContain('123.45');
  });

  it('cuts the params off exception values, keeping the SQL', () => {
    const event = scrubSentryEvent({
      exception: { values: [{ type: 'DrizzleQueryError', value: err.message }] },
    } as ErrorEvent);
    const value = event.exception?.values?.[0]?.value ?? '';
    expect(value).not.toContain('123.45');
    expect(value).not.toContain('params:');
    expect(value).toContain('Failed query: update "entries"');
  });

  it('cuts them from every exception in a cause chain, the message, logentry and breadcrumbs', () => {
    const event = scrubSentryEvent({
      exception: { values: [{ value: 'driver: timeout' }, { value: err.message }] },
      message: err.message,
      logentry: { message: err.message, params: [123.45] },
      breadcrumbs: [{ message: err.message, data: { params: PARAMS, ok: 1 } }],
    } as unknown as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain('123.45');
    expect(JSON.stringify(event)).not.toContain('params');
    expect(event.exception?.values?.[0]?.value).toBe('driver: timeout');
    expect(event.breadcrumbs?.[0]?.data).toEqual({ ok: 1 });
  });

  it('drops `params` keys an integration copied into extra or contexts, at any depth', () => {
    const event = scrubSentryEvent({
      extra: { params: PARAMS, note: 'kept' },
      contexts: { DrizzleQueryError: { query: 'select 1', params: PARAMS } },
    } as unknown as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain('123.45');
    expect(event.extra).toEqual({ note: 'kept' });
    expect(event.contexts?.DrizzleQueryError).toEqual({ query: 'select 1' });
  });

  // The review's probe: Sentry's default console integration records a breadcrumb whose
  // `data.arguments` hold the logged error, already NORMALIZED (message/stack as strings, `params`
  // collapsed to "[Array]"), and Next logs a failed action with console.error. Dropping the `params`
  // key alone left the values in `message` and `stack`.
  it('strips params inside normalized console breadcrumb arguments', () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        {
          category: 'console',
          message: String(err.stack),
          data: {
            logger: 'console',
            arguments: [
              {
                name: 'Error',
                message: err.message,
                stack: err.stack,
                query: err.query,
                params: '[Array]',
              },
            ],
          },
        },
      ],
    } as unknown as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain('123.45');
  });

  it('strips a normalized error anywhere in breadcrumb data, not only console arguments', () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        {
          category: 'http',
          data: {
            error: { name: 'Error', message: err.message, stack: err.stack, params: '[Array]' },
          },
        },
      ],
      extra: { lastError: { message: err.message } },
    } as unknown as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain('123.45');
  });

  it('cuts params after an escaped newline (a JSON-serialized message)', () => {
    const serialized = JSON.stringify(err.message).slice(1, -1); // newline becomes a literal backslash-n
    expect(serialized).toContain('\\nparams:');
    const event = scrubSentryEvent({ message: serialized } as ErrorEvent);
    expect(event.message).not.toContain('123.45');
    expect(event.message).toContain('Failed query: update');
  });

  it("beforeBreadcrumb drops a console breadcrumb's logged arguments and strips its message", () => {
    const crumb = beforeBreadcrumbScrubbed({
      category: 'console',
      level: 'error',
      message: String(err.stack),
      data: { logger: 'console', arguments: [err] },
    });
    expect(crumb).not.toBeNull();
    expect(crumb?.data).toEqual({ logger: 'console' });
    expect(crumb?.message).not.toContain('123.45');
  });

  it('beforeSendLog strips the log message and any attribute string', () => {
    const log = beforeSendLogScrubbed({
      level: 'error',
      message: err.message,
      attributes: { error: err.message, params: PARAMS, route: '/p/x' },
    });
    expect(JSON.stringify(log)).not.toContain('123.45');
    expect(log.attributes).toEqual({
      error: expect.stringContaining('Failed query'),
      route: '/p/x',
    });
  });

  it("strips a transaction span's status and description", () => {
    const event = beforeSendTransactionScrubbed({
      type: 'transaction',
      spans: [
        {
          span_id: 'a',
          trace_id: 'b',
          start_timestamp: 0,
          description: err.message,
          status: err.message,
          data: { 'db.statement': 'update x', note: err.message },
        },
      ],
    } as unknown as Event);
    expect(JSON.stringify(event)).not.toContain('123.45');
    expect(event.spans?.[0]?.data?.['db.statement']).toBe('update x');
  });

  it('leaves an ordinary error untouched', () => {
    const value = 'TypeError: cannot read properties of undefined';
    const event = beforeSendScrubbed({
      exception: { values: [{ value }] },
      message: 'hi',
    } as ErrorEvent);
    expect(event.exception?.values?.[0]?.value).toBe(value);
    expect(event.message).toBe('hi');
  });

  it('beforeBreadcrumb fails closed on data it cannot scrub, and leaves clean frozen data alone', () => {
    const dirty = Object.freeze({ note: 'Failed query: x\nparams: 123.45' });
    expect(beforeBreadcrumbScrubbed({ category: 'app', data: { dirty } })).toBeNull();
    const clean = Object.freeze({ note: 'nothing to strip' });
    const kept = beforeBreadcrumbScrubbed({ category: 'app', data: { clean } });
    expect(kept?.data?.clean).toBe(clean);
  });
});

describe('SENTRY_DATA_COLLECTION — what the SDK may collect on its own (Sentry 11)', () => {
  it('turns off every field that defaults to ON — the contract, pinned literally', () => {
    expect(SENTRY_DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      // Added by `@sentry/core@11.10.0` (MCP tool-call arguments and results; defaults to ON).
      // This pin is the SECOND guard that fired on that bump — the `Required<…>` type caught it at
      // compile time, this one catches a field added to the const without a decision.
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });
});

describe('scrubSentryEvent — Sentry 11 collection paths, stripped as a second line', () => {
  it('drops the request body (a Server Action body is its form: a weight, the access code)', () => {
    const event = { request: { data: 'weight=999.9' } } as Event;
    expect(scrubSentryEvent(event).request).not.toHaveProperty('data');
  });

  it('drops local variables from every stack frame', () => {
    const event = {
      exception: {
        values: [
          {
            value: 'boom',
            stacktrace: { frames: [{ function: 'write', vars: { weight: '999.9' } }] },
          },
        ],
      },
    } as Event;
    const frame = scrubSentryEvent(event).exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame).not.toHaveProperty('vars');
    expect(frame).toMatchObject({ function: 'write' });
  });
});

describe('the identified user never reaches Sentry (AUTH-1 1c-1)', () => {
  it('deletes event.user and contexts.user', () => {
    // Clerk's SDK and Sentry's Next integration both populate this once a session exists, and the
    // default payload carries an EMAIL — the one piece of adult personal data this app deliberately
    // does not hold (data-inventory §7: it lives in Clerk, which is the point of using Clerk).
    const event = scrubSentryEvent({
      user: { id: 'user_abc', email: 'parent@example.com', ip_address: '1.2.3.4' },
      contexts: { user: { id: 'user_abc', email: 'parent@example.com' } },
    } as never as Parameters<typeof scrubSentryEvent>[0]);

    expect(event.user).toBeUndefined();
    expect(event.contexts?.user).toBeUndefined();
  });

  it('deleted, not masked — nothing is left for somebody to decide to unmask', () => {
    const event = scrubSentryEvent({
      user: { email: 'parent@example.com' },
    } as never as Parameters<typeof scrubSentryEvent>[0]);
    expect(JSON.stringify(event)).not.toContain('parent@example.com');
    // Deleted, not emptied: `'user' in event` is the form of this claim that can actually fail. (An
    // earlier version asserted the absence of '[Filtered]', a string this codebase never writes.)
    expect('user' in event).toBe(false);
  });

  it('leaves the observability this app DOES want — neither tag names a person', () => {
    // ⚠️ `no_membership`, not the `no_household` this used to carry: that value is RETIRED at
    // `AUTH-1` 1c-4 and nothing can emit it, so a fixture emitting it made this assertion describe a
    // payload the app cannot produce. Deliberately a literal rather than `SCOPE_OUTCOME` — importing
    // `lib/dal/household` would pull `server-only` and the DB client into a suite that tests the
    // scrubber; the value is a sample here, not the contract under test.
    const event = scrubSentryEvent({
      user: { id: 'user_abc' },
      tags: { scope_outcome: 'no_membership' },
      contexts: { scope_miss: { reason: 'cross_household', profilePublicId: 'p_1' } },
    } as never as Parameters<typeof scrubSentryEvent>[0]);

    expect(event.user).toBeUndefined();
    expect(event.tags?.scope_outcome).toBe('no_membership');
    // `contexts.scope_miss` is the shape the app ACTUALLY emits (`lib/dal/household.ts`), so an
    // over-broad future scrub that deleted it would turn this red. The previous version asserted an
    // invented `contexts.household` and so guarded nothing.
    expect(event.contexts?.scope_miss).toEqual({
      reason: 'cross_household',
      profilePublicId: 'p_1',
    });
  });
});

// FAM-1 4a-i review: a CHECK (23514) or UNIQUE (23505) violation's `detail` is the rejected row,
// household text included. node-postgres puts it on the error as an own property, so a normalized
// error carries it as a key, and a printed error carries it as a `DETAIL:` line.
describe('scrubSentryEvent — a rejected row never leaves the server (Postgres `detail`)', () => {
  const ROW = 'Failing row contains (42, 7, Saturday hill sprints with (a) partner, null).';
  const KEY = 'Key (household_id, name)=(7, Saturday hill sprints) already exists.';

  it('drops `detail` keys wherever an error was normalized, and keeps the diagnosable fields', () => {
    const event = scrubSentryEvent({
      contexts: {
        DatabaseError: {
          code: '23514',
          constraint: 'workouts_name_len',
          table: 'workouts',
          detail: ROW,
        },
      },
      breadcrumbs: [
        { category: 'query', data: { error: { message: 'violates check', detail: KEY } } },
      ],
    } as unknown as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain('Saturday hill sprints');
    expect(event.contexts?.DatabaseError).toEqual({
      code: '23514',
      constraint: 'workouts_name_len',
      table: 'workouts',
    });
  });

  it('cuts a printed `DETAIL:` line and everything after it, keeping the message', () => {
    const printed = `new row for relation "workouts" violates check constraint "workouts_name_len"\nDETAIL:  ${ROW}`;
    const event = scrubSentryEvent({
      exception: { values: [{ value: printed }] },
      message: printed.replace('\n', '\\n'),
    } as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain('Saturday hill sprints');
    expect(event.exception?.values?.[0]?.value).toBe(
      'new row for relation "workouts" violates check constraint "workouts_name_len"',
    );
  });

  it('cuts the detail sentence where it sits inside a longer line, even with a ")" in the row', () => {
    const event = scrubSentryEvent({
      exception: {
        values: [{ value: `insert failed: ${ROW} (code 23514)` }, { value: `dup: ${KEY}` }],
      },
    } as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain('Saturday hill sprints');
    expect(JSON.stringify(event)).not.toContain('partner');
    expect(event.exception?.values?.[0]?.value).toBe('insert failed: ');
  });

  // The form a log actually carries: `console.error(err)` / `util.format` prints the error with
  // `util.inspect`, so the detail appears as `detail: '…'`, split into `'…' +` continuation lines when
  // long. Built to node-postgres's DatabaseError shape (own, enumerable fields), since apps/web does
  // not depend on `pg` directly.
  class DatabaseError extends Error {
    constructor(message: string, fields: Record<string, unknown>) {
      super(message);
      this.name = 'DatabaseError';
      Object.assign(this, fields);
    }
  }
  const failing = (detail: string) =>
    new DatabaseError(
      'new row for relation "workouts" violates check constraint "workouts_name_len"',
      {
        severity: 'ERROR',
        code: '23514',
        detail,
        constraint: 'workouts_name_len',
        table: 'workouts',
      },
    );

  it.each([
    ['a short detail', ROW],
    [
      'a long, multi-line detail inspect splits into continuation lines',
      `Failing row contains (42, 7, ${'Saturday hill sprints '.repeat(6)}with (a)\npartner, null).`,
    ],
    [
      'a long, multi-line detail with an apostrophe, which inspect prints in double quotes',
      `Failing row contains (42, 7, ${"Sam's Saturday hill sprints ".repeat(6)}with (a)\npartner, null).`,
    ],
    [
      'a long, multi-line detail with both quote kinds, which inspect prints in backticks',
      `Failing row contains (42, 7, ${'Sam\'s "Saturday hill sprints" '.repeat(6)}with (a)\npartner, null).`,
    ],
  ])('a printed DatabaseError (util.format) loses %s, and keeps its code', (_what, detail) => {
    const log = beforeSendLogScrubbed({
      level: 'error',
      message: format(failing(detail)),
    } as Parameters<typeof beforeSendLogScrubbed>[0]);
    expect(log.message).not.toContain('Saturday hill sprints');
    expect(log.message).not.toContain('partner');
    expect(log.message).toContain("code: '23514'");
  });

  it('beforeSendLog and beforeBreadcrumb drop it too', () => {
    const log = beforeSendLogScrubbed({
      level: 'error',
      message: `write failed\nDETAIL: ${ROW}`,
      attributes: { err: { detail: KEY } },
    } as Parameters<typeof beforeSendLogScrubbed>[0]);
    const crumb = beforeBreadcrumbScrubbed({ message: `x\nDETAIL: ${KEY}`, data: { detail: ROW } });
    expect(JSON.stringify({ log, crumb })).not.toContain('Saturday hill sprints');
  });
});

describe('scrubSentryEvent — no public id leaves except the deliberate one (C11 review, 2026-11-16)', () => {
  const ATHLETE = '0193a4b2-7c1d-7e2f-8a3b-4c5d6e7f8091';
  const PROGRAM = '0193a4b2-7c1d-7e2f-8a3b-4c5d6e7f80ff';
  const page = `https://www.mat-plan.dev/p/${ATHLETE}?d=2026-11-16`; // the query: a precaution, see scrubUrl

  /**
   * Shaped from `@sentry/nextjs@11.10.0`'s `captureRequestError`: Next's `onRequestError` hook puts
   * the request path in `contexts.nextjs.request_path` (query string removed, path intact) and the
   * URL under `request`. The review ran the real SDK through the scrubber; this pins what it found.
   */
  const requestErrorEvent = (): Event =>
    ({
      request: { url: page, method: 'GET', headers: {} },
      contexts: {
        nextjs: {
          request_path: `/p/${ATHLETE}`,
          router_kind: 'App Router',
          router_path: '/p/[profileId]',
          route_type: 'render',
        },
        request: { url: page },
      },
      transaction: 'GET /p/[profileId]',
      exception: { values: [{ type: 'Error', value: `boom for /p/${ATHLETE}` }] },
    }) as unknown as Event;

  it('masks the athlete id in onRequestError’s contexts.nextjs.request_path (the missed key)', () => {
    const event = scrubSentryEvent(requestErrorEvent());
    expect(event.contexts?.nextjs).toMatchObject({
      request_path: '/p/:id',
      router_path: '/p/[profileId]',
    });
  });

  it('masks it in the request URL, contexts.request and the exception message', () => {
    const event = scrubSentryEvent(requestErrorEvent());
    expect(event.request?.url).toBe('https://www.mat-plan.dev/p/:id');
    expect(event.contexts?.request?.url).toBe('https://www.mat-plan.dev/p/:id');
    expect(event.exception?.values?.[0]?.value).toBe('boom for /p/:id');
  });

  it('masks a row client_id an exception message carries (strength-session, checkin)', () => {
    const event = scrubSentryEvent({
      exception: { values: [{ type: 'Error', value: `client_id ${PROGRAM} held by another row` }] },
    } as Event);
    expect(event.exception?.values?.[0]?.value).toBe('client_id :id held by another row');
  });

  it('masks navigation breadcrumbs (from, to, url)', () => {
    const crumb = beforeBreadcrumbScrubbed({
      category: 'navigation',
      data: { from: `/p/${ATHLETE}`, to: `/programs/${PROGRAM}`, url: page },
    });
    expect(crumb?.data).toEqual({
      from: '/p/:id',
      to: '/programs/:id',
      url: 'https://www.mat-plan.dev/p/:id',
    });
  });

  it('KEEPS the deliberate scope-miss id, and masks the same id anywhere else on that event', () => {
    const event = scrubSentryEvent({
      request: { url: `https://www.mat-plan.dev/programs/${PROGRAM}` },
      contexts: { scope_miss: { kind: 'program', resource: PROGRAM, outcome: 'cross_household' } },
    } as unknown as Event);
    expect(event.contexts?.scope_miss).toMatchObject({ resource: PROGRAM });
    expect(event.request?.url).toBe('https://www.mat-plan.dev/programs/:id');
  });

  it('masks the transaction name the HTTP server integration sets (GET /p/<id>)', () => {
    const event = scrubSentryEvent({ transaction: `GET /p/${ATHLETE}` } as Event);
    expect(event.transaction).toBe('GET /p/:id');
  });

  it('puts back only a well-formed UUID as the scope-miss resource', () => {
    const event = scrubSentryEvent({
      contexts: { scope_miss: { resource: `not-an-id /p/${ATHLETE}` } },
    } as unknown as Event);
    expect(event.contexts?.scope_miss).toMatchObject({ resource: 'not-an-id /p/:id' });
  });

  it('leaves strings with no UUID alone', () => {
    expect(maskIds('/p/new')).toBe('/p/new');
    expect(maskIds('/api/export/2026-11')).toBe('/api/export/2026-11');
  });
});
