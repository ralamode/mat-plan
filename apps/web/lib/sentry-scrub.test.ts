import type { ErrorEvent, Event } from '@sentry/nextjs';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';

import { GATE_COOKIE_NAME } from './access-gate';
import { beforeSendScrubbed, scrubSentryEvent } from './sentry-scrub';

/**
 * V1-14a — THE security assertion of the Sentry wiring. Each case below corresponds to a real leak path
 * traced through the SDK source, not a hypothetical: the SDK's non-PII cookie default is a deny-OBJECT
 * (so cookies are included and `mp_gate` matches none of its sensitive-name snippets), and the
 * `formData` option writes each field as a `server_action_form_data.*` extra.
 */

describe('scrubSentryEvent — the gate cookie never leaves the server', () => {
  it('drops the parsed cookies object', () => {
    const event = scrubSentryEvent({
      request: { cookies: { [GATE_COOKIE_NAME]: 'a-real-gate-token' } },
    } as Event);
    expect(event.request?.cookies).toBeUndefined();
  });

  it('drops the RAW cookie header too — it is a separate copy from `cookies`', () => {
    const event = scrubSentryEvent({
      request: { headers: { cookie: `${GATE_COOKIE_NAME}=a-real-gate-token`, 'user-agent': 'x' } },
    } as Event);
    expect(event.request?.headers?.cookie).toBeUndefined();
    // Non-sensitive headers survive — this is a scrub, not a wipe.
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
      contexts: { request: { cookies: { mp_gate: 'x' }, headers: { cookie: 'mp_gate=x' } } },
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
      request: { cookies: { mp_gate: 'x' } },
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

  it('leaves an ordinary error untouched', () => {
    const value = 'TypeError: cannot read properties of undefined';
    const event = beforeSendScrubbed({
      exception: { values: [{ value }] },
      message: 'hi',
    } as ErrorEvent);
    expect(event.exception?.values?.[0]?.value).toBe(value);
    expect(event.message).toBe('hi');
  });
});
