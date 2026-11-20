import { describe, expect, it } from 'vitest';

import { parseExpectedRows, seededHouseholdErasureIssue } from './erasure-gates';

const PROD = 'postgres://u:secret@ep-prod-123.us-east-2.aws.neon.tech/mat_plan?sslmode=require';

describe('the one-shot erasure runs against production only (CAT-3 R0, D1)', () => {
  it('a remote, named, non-preview target passes before and after connecting', () => {
    expect(seededHouseholdErasureIssue(PROD, null)).toBeNull();
    expect(seededHouseholdErasureIssue(PROD, 'mat_plan')).toBeNull();
  });

  it.each([
    ['unset', undefined, /not set/],
    ['empty', '', /not set/],
    ['local', 'postgres://u:p@localhost:5432/mat_plan', /local database/],
    ['the preview', 'postgres://u:p@ep-x.aws.neon.tech/mat_plan_preview', /preview database/],
    ['no database name', 'postgres://u:p@ep-x.invalid', /names no database/],
    [
      'a host override',
      'postgres://u:p@ep-x.aws.neon.tech/mat_plan?host=localhost',
      /host override/,
    ],
    [
      'a decoded host override',
      'postgres://u:p@ep-x.aws.neon.tech/mat_plan?%68ost=elsewhere',
      /host override/,
    ],
    ['an empty host', 'postgres:///mat_plan', /no host|names no database/],
    ['a socket host', 'postgres://u:p@%2Ftmp/mat_plan', /unix socket/],
    ['a socket scheme', 'socket:/tmp?db=mat_plan', /not a postgres/],
    ['LOCALHOST', 'postgres://u:p@LOCALHOST/mat_plan', /local database/],
    ['127.1', 'postgres://u:p@127.1/mat_plan', /local database/],
    ['localhost with a trailing dot', 'postgres://u:p@localhost./mat_plan', /local database/],
    ['an encoded localhost', 'postgres://u:p@%6cocalhost/mat_plan', /local database/],
    ['a mapped IPv4 loopback', 'postgres://u:p@[::ffff:127.0.0.1]/mat_plan', /local database/],
  ])('refuses %s before connecting', (_what, url, why) => {
    expect(seededHouseholdErasureIssue(url, null)).toMatch(why);
  });

  it('refuses when the connection that writes is the preview, or not the database the URL names', () => {
    expect(seededHouseholdErasureIssue(PROD, 'mat_plan_preview')).toMatch(
      /connected database is the preview/,
    );
    expect(seededHouseholdErasureIssue(PROD, 'postgres')).toMatch(/not the one the URL names/);
  });

  it('never echoes any part of the URL, which holds a password', () => {
    for (const url of [PROD, 'postgres://u:secret@localhost/x', 'postgres://u:secret@h.invalid']) {
      for (const observed of [null, 'mat_plan_preview', 'other']) {
        expect(seededHouseholdErasureIssue(url, observed) ?? '').not.toMatch(
          /secret|ep-prod|h\.invalid/,
        );
      }
    }
  });
});

describe('EXPECT_ERASED_ROWS', () => {
  it('takes a whole number of rows, 0 included', () => {
    expect(parseExpectedRows('0')).toBe(0);
    expect(parseExpectedRows(' 412 ')).toBe(412);
  });
  it.each([undefined, '', '-1', '1.5', '12abc', 'abc', '1e3', '9999999999'])(
    'refuses %s',
    (raw) => {
      expect(parseExpectedRows(raw)).toBeNull();
    },
  );
});
