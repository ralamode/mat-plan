import { APP_LOCALE } from './locale';

/**
 * Counted and listed copy, through the platform's `Intl` — so a sentence with a number in it is
 * right in a locale nobody has configured yet.
 *
 * ## 🔴 Why this is `Intl` and not a dependency
 *
 * The question that produced this file was "which i18n library pluralizes for us". The answer is
 * that **pluralization needs no library**: `Intl.PluralRules` ships with the platform and gets
 * Polish's six forms and Arabic's `zero/one/two/few/many` right, with full ICU in this runtime
 * (checked). What a library buys on top is **message catalogs, ICU MessageFormat and locale
 * routing** — and adopting one moves every string out of this repo's `*_COPY` modules, which is a
 * milestone (`I18N-1`), not a helper. Carrying that cost at one locale would buy nothing.
 *
 * So: the primitive now, the framework when there is a second locale to justify it. This is the call
 * a library would make underneath either way.
 *
 * ## What it replaces, and why a ternary is not good enough
 *
 * `n === 1 ? 'match' : 'matches'` is wrong in most languages and, as shipped in this very PR's first
 * draft, was wrong in English too: `` `${n} match` + 'es' `` collapsed to one string for every `n`
 * and announced *"1 matches some of your words"*. A ternary **looks** like it handles the singular,
 * which is what let it through review. `Intl.PluralRules` makes the categories explicit, so a
 * missing form is a missing object key rather than a silently wrong branch.
 *
 * ⚠️ **English uses two of the six CLDR categories**, so an `en`-only caller writes `one` and
 * `other` and nothing else. That is not a shortcut: `select()` returns only the categories the locale
 * has, and a new locale's extra forms are added to the SAME call sites, which is the point of routing
 * them through here instead of inlining a comparison.
 */

/** The CLDR plural categories. A locale uses a subset; English uses `one` and `other`. */
type PluralCategory = Intl.LDMLPluralRule;

/**
 * Pick the right form for `count`, by the locale's own rules.
 *
 * ```ts
 * plural(3, { one: '1 movement matches', other: `${n} movements match` })
 * ```
 *
 * The `other` form is **required** and every other form optional, because `other` is the only
 * category every locale has — so a caller cannot write a table that leaves a count unrenderable.
 * A locale whose category is absent falls back to `other`, which is wrong-but-readable rather than
 * `undefined`.
 */
export function plural(
  count: number,
  forms: { other: string } & Partial<Record<PluralCategory, string>>,
  locale: string = APP_LOCALE,
): string {
  const category = new Intl.PluralRules(locale).select(count);
  return forms[category] ?? forms.other;
}

/**
 * Join a list the way the locale does — `a, b, and c` in English, `a وb وc` in Arabic.
 *
 * ⚠️ **`.join(', ')` is a localization bug, and a quiet one.** It was in this PR's first draft of the
 * Save line. The separator, the final conjunction and whether there is a serial comma are all
 * locale-specific, and `Intl.ListFormat` is the platform's answer.
 */
export function formatList(
  items: readonly string[],
  locale: string = APP_LOCALE,
  type: Intl.ListFormatType = 'conjunction',
): string {
  return new Intl.ListFormat(locale, { style: 'long', type }).format(items);
}

/**
 * Quote a value for display — `"x"` in English, and the locale's own marks once `I18N-1` lands.
 *
 * ⚠️ **A placeholder with a real job.** Quotation marks are locale-specific (« », „ ", 「 」) and
 * `Intl` has no API for them, so this cannot be solved by the platform — it is a catalog concern and
 * therefore `I18N-1`'s. It exists now so the call sites are already funnelled through one function
 * when that lands, rather than needing a sweep for `"${x}"`.
 *
 * ⚠️ **Takes no locale**, unlike its neighbours: an unused parameter is a lint warning and a promise
 * the body does not keep. `I18N-1` adds the parameter in the same change that gives it something to
 * do, and the call sites are already here.
 */
export function quote(value: string): string {
  return `"${value}"`;
}
