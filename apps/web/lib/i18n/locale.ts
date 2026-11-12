/**
 * The locale every piece of locale-dependent rendering reads — **one value, one place.**
 *
 * 🔴 **Its own module, so `<html lang>` and the formatters cannot disagree.** The first draft put
 * this beside `plural()` and left `app/layout.tsx` with a literal `lang="en"`; two sources for one
 * fact is how a page announces itself as English while its numbers are formatted for somewhere
 * else, and a screen reader picks its pronunciation from `lang`. `plural.ts` is about plural
 * categories and should not be the home of the app's locale.
 *
 * ⚠️ **Not a user preference yet.** `I18N-1` replaces this VALUE with a request-scoped read — a
 * one-line change here, and nothing else, precisely because no call site hardcodes the string.
 */
export const APP_LOCALE = 'en';
