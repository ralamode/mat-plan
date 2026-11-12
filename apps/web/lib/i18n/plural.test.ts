import { describe, expect, it } from 'vitest';

import { APP_LOCALE, formatList, plural, quote } from './plural';

describe('plural()', () => {
  it('picks English forms', () => {
    const forms = { one: 'one thing', other: 'many things' };
    expect([plural(0, forms), plural(1, forms), plural(2, forms)]).toEqual([
      'many things',
      'one thing',
      'many things',
    ]);
  });

  it('falls back to `other` when the locale has a category the caller did not write', () => {
    // 🔴 This is the property that makes an `en`-only call site safe to ship: Polish selects `few`
    // for 2, and a table with only `one`/`other` still renders something readable rather than
    // `undefined`. Wrong-but-readable is the right failure mode for copy.
    expect(plural(2, { one: 'jeden', other: 'wiele' }, 'pl')).toBe('wiele');
  });

  it('🔴 uses the locale rules, not a comparison — the whole reason this is not a ternary', () => {
    // A `n === 1 ? a : b` is wrong in most languages, and the probe that proves this helper is not
    // one: Polish distinguishes 1 / 2–4 / 5+, so `few` must win for 22 and `many` for 5.
    const forms = { one: 'ONE', few: 'FEW', many: 'MANY', other: 'OTHER' };
    expect([1, 2, 5, 22].map((n) => plural(n, forms, 'pl'))).toEqual(['ONE', 'FEW', 'MANY', 'FEW']);
    // Arabic has six, including zero and two — neither of which any ternary can express.
    expect([0, 1, 2, 3, 11].map((n) => plural(n, forms, 'ar'))).toEqual([
      'OTHER', // `zero` is not in the table, so it falls back — readable, and the point of the rule
      'ONE',
      'OTHER', // `two` likewise
      'FEW',
      'MANY',
    ]);
  });
});

describe('formatList()', () => {
  it('joins the way English does, including the serial comma', () => {
    expect(formatList(['a'])).toBe('a');
    expect(formatList(['a', 'b'])).toBe('a and b');
    expect(formatList(['a', 'b', 'c'])).toBe('a, b, and c');
  });

  it('🔴 is locale-dependent, which is why `.join(", ")` is a bug', () => {
    // Arabic joins with و and no commas. A hand-rolled separator cannot express this, and the
    // failure is invisible until someone reads the app in that locale.
    expect(formatList(['a', 'b', 'c'], 'ar')).not.toContain(',');
  });
});

describe('the locale constant', () => {
  it('is the one source, so I18N-1 changes a value and not every call site', () => {
    // Pinned deliberately: the point of the constant is that nothing hardcodes `'en'`, and `I18N-1`
    // replaces this with a request-scoped read.
    expect(APP_LOCALE).toBe('en');
  });

  it('quote() is a funnel for a job Intl cannot do', () => {
    // Quotation marks are locale-specific (« », „ ", 「 」) and there is no Intl API for them, so
    // this stays a catalog concern. It exists now so the call sites are already funnelled.
    expect(quote('x')).toBe('"x"');
  });
});
