/**
 * Reading CSS custom properties out of a stylesheet's source, for the tests that measure tokens
 * (`token-sets.test.ts`, `app/done-tokens.test.ts`). Pure string work; no browser.
 *
 * ⚠️ Part of the temporary `/design/tokens` harness, like `contrast.ts`: the PR that deletes the
 * directory (docs/design.md → Reskinning) moves this file with it.
 */

/**
 * Every `--token: value;` declaration inside the first RULE whose selector is `selector`.
 *
 * "Whose selector is", not "which contains the text": `globals.css:5` is
 * `@custom-variant dark (&:is(.dark *));`, so a naive `indexOf('.dark')` finds that line and then
 * parses the `@theme inline` block that follows it — scoring the dark palette against the wrong
 * values while looking perfectly green. So the match requires the next non-space character to be `{`.
 */
export function blockOf(source: string, selector: string): Record<string, string> | null {
  let start = -1;
  for (let i = source.indexOf(selector); i >= 0; i = source.indexOf(selector, i + 1)) {
    if (/^\s*\{/.test(source.slice(i + selector.length))) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  const body = source.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out[name!] = value!.trim();
  }
  return out;
}
