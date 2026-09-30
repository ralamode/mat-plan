import { describe, expect, it } from 'vitest';

import { withVerifiedTls } from './client';

/**
 * `sslmode=require` encrypts but does NOT verify the server certificate — protection against passive
 * eavesdropping, none against an active machine-in-the-middle. These pin the upgrade, and just as
 * importantly pin the cases that must NOT be touched.
 */
describe('withVerifiedTls', () => {
  it('upgrades the weak modes that pg will re-alias anyway', () => {
    for (const weak of ['require', 'prefer', 'verify-ca']) {
      expect(withVerifiedTls(`postgres://u:p@h/db?sslmode=${weak}`)).toBe(
        'postgres://u:p@h/db?sslmode=verify-full',
      );
    }
  });

  it('upgrades it mid-string, not just as the first parameter', () => {
    expect(withVerifiedTls('postgres://u:p@h/db?application_name=x&sslmode=require')).toBe(
      'postgres://u:p@h/db?application_name=x&sslmode=verify-full',
    );
  });

  // THE regression this guards: `pnpm dev`, the e2e harness and db:verify all run against a local
  // Postgres with no TLS. Forcing verify-full there would break every local run to fix a
  // hosted-only concern.
  it('leaves a string with NO sslmode alone — it does not invent one', () => {
    const local = 'postgres://mat:mat@localhost:5432/mat_plan_test';
    expect(withVerifiedTls(local)).toBe(local);
  });

  it('leaves an explicit choice alone, including a deliberate `disable`', () => {
    for (const explicit of ['disable', 'verify-full', 'no-verify']) {
      const url = `postgres://u:p@h/db?sslmode=${explicit}`;
      expect(withVerifiedTls(url)).toBe(url);
    }
  });
});
