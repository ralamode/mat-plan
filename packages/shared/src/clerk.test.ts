import { describe, expect, it } from 'vitest';

import { CLERK_USER_ID_PATTERN } from './clerk';
import { E2E_SESSION_BYPASS_USER } from './seed-ids';

/**
 * `PRIV-3` RC, D2 — the one Clerk-id shape. Every id below is visibly synthetic; none is read off a
 * dashboard.
 */
describe('CLERK_USER_ID_PATTERN', () => {
  it.each([
    ['user_rcfixture000a', 'an invented id of the ordinary shape'],
    [E2E_SESSION_BYPASS_USER, 'the committed e2e fixture principal still fits'],
    [`user_${'a'.repeat(64)}`, '64 characters after the prefix is the bound'],
  ])('accepts %s (%s)', (id) => {
    expect(CLERK_USER_ID_PATTERN.test(id)).toBe(true);
  });

  it.each([
    ['user_rcfixture000a,user_rcfixture000b', 'a comma-pasted pair'],
    ['user_rcfixture000a\tuser_rcfixture000b', 'a tab-joined pair'],
    ['user_rcfixture000a​', 'a trailing zero-width space'],
    [`user_${'a'.repeat(65)}`, '65 characters after the prefix'],
    ['user_', 'the prefix alone'],
    ['user_rc_fixture', 'an underscore after the prefix'],
    ['not-a-clerk-id', 'no prefix at all'],
    ['someone@example.com', 'a pasted email address'],
  ])('rejects %j (%s)', (id) => {
    expect(CLERK_USER_ID_PATTERN.test(id)).toBe(false);
  });
});
