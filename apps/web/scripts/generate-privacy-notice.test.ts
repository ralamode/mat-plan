import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { GITHUB_REPO_URL } from '../lib/constants';
import type { Block } from '../lib/privacy/notice-model';

import {
  OUTPUT_PATH,
  outputFile,
  parseNotice,
  renderNoticeModule,
  resolveHref,
  SOURCE_PATH,
  sourceFile,
} from './generate-privacy-notice';

/**
 * PRIV-2 — properties of the GENERATOR.
 *
 * The companion file, `lib/privacy/notice-content.test.ts`, asserts properties of the committed
 * DATA. The split matters: a drift test compares the generator's output to the committed module and
 * can never notice that both agree on something the source never said.
 */

const markdown = () => readFileSync(sourceFile(), 'utf8');

describe('drift between docs/privacy/notice.md and the committed module', () => {
  it('is byte-exact — no normalisation on either side', () => {
    expect(renderNoticeModule(markdown())).toBe(readFileSync(outputFile(), 'utf8'));
  });

  it('names its own source and output, so the error above is actionable', () => {
    expect(SOURCE_PATH).toBe('docs/privacy/notice.md');
    expect(OUTPUT_PATH).toBe('apps/web/lib/privacy/notice-content.ts');
  });
});

describe('the walk throws rather than dropping anything from a privacy notice', () => {
  // An image, raw HTML, a code span and a hard break: constructs the renderer has no branch for.
  // Each error names the token type AND its raw text, so the fix is obvious from the failure.
  it.each([
    ['an image', '# T\n\n![alt](y.png)\n'],
    ['raw inline HTML', '# T\n\nraw </script> here\n'],
    ['a code span', '# T\n\na `codespan` here\n'],
    ['a fenced block', '# T\n\n```\nx\n```\n'],
  ])('throws on %s', (_what, md) => {
    expect(() => renderNoticeModule(md)).toThrow(/unsupported (block|inline) token/);
  });

  it('throws on an h4 — the outline is h1/h2/h3, and a skipped level is an a11y defect', () => {
    expect(() => renderNoticeModule('# T\n\n#### too deep\n')).toThrow(/heading depth 4/);
  });

  it('throws on a third table column, naming the table', () => {
    const md = '# T\n\n| A | B | C |\n| - | - | - |\n| 1 | 2 | 3 |\n';
    expect(() => renderNoticeModule(md)).toThrow(/table "A \| B \| C" has 3 columns/);
  });

  it('throws on an empty header cell — the finding the `head` field exists for', () => {
    const md = '# T\n\n|  | How long |\n| - | - |\n| a | b |\n';
    expect(() => renderNoticeModule(md)).toThrow(/empty header cell in column 1/);
  });

  it.each([
    ['no h1 at all', 'a paragraph\n'],
    ['a second h1', '# One\n\n# Two\n'],
  ])('throws when the outline is wrong: %s', (_what, md) => {
    expect(() => renderNoticeModule(md)).toThrow(/h1/);
  });
});

describe('the link allowlist (marked does no protocol filtering of its own)', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>x</script>',
    'http://example.com',
    '//evil.example',
    '#fragment',
    'mailto:someone@example.com',
    './not-in-the-map.md',
    '/p',
  ])('refuses %j', (href) => {
    expect(() => resolveHref(href)).toThrow(/refusing link target/);
    // …and refuses it through the real parse path too, not only the helper.
    expect(() => renderNoticeModule(`# T\n\n[x](${href})\n`)).toThrow(/refusing link target/);
  });

  it('passes an https:// target through unchanged', () => {
    expect(resolveHref('https://example.com/a?b=c#d')).toBe('https://example.com/a?b=c#d');
  });

  it('rewrites ./data-inventory.md to the real file in the public repo', () => {
    expect(resolveHref('./data-inventory.md')).toBe(
      `${GITHUB_REPO_URL}/blob/main/docs/privacy/data-inventory.md`,
    );
  });

  it('throws when a rewrite points at a file that no longer exists', () => {
    expect(() =>
      resolveHref('./moved.md', { './moved.md': 'blob/main/docs/privacy/moved.md' }),
    ).toThrow(/does not exist/);
  });

  it('leaves a bare e-mail address as PROSE — PRIV-1 chose prose over a mailto link', () => {
    // GFM would autolink it to `mailto:…`, which the allowlist then refuses. The generator disables
    // that one tokenizer so the author's prose stays prose; this pins the decision.
    const { blocks } = parseNotice('# T\n\nwrite to matplandev@gmail.com.\n');
    expect(JSON.stringify(blocks)).not.toContain('mailto:');
    expect(JSON.stringify(blocks)).toContain('matplandev@gmail.com');
  });
});

/**
 * 🔴 Prose becomes source code. A backtick or a `${…}` in `notice.md` lands in a `.ts` module that
 * `next build` COMPILES, and the worst shape is not hypothetical: `${process.env.…}` inside an
 * emitted template literal would compile to the live access code in a file served to anyone.
 *
 * The rule is that every value derived from the notice is emitted via `JSON.stringify`. These three
 * assertions prove it instead of arguing it.
 */
describe('hostile round trip', () => {
  // `\</script>` rather than `</script>`: raw HTML throws (asserted above), so the only way the
  // literal characters can reach the module is as escaped text — which is what we want to prove
  // survives. U+2028 is in here because JSON.stringify does NOT escape it.
  const HOSTILE = [
    '# Hostile ` fixture',
    '',
    'A lone backtick ` and a template hole ${process.env.ACCESS_GATE_PASSWORD} and',
    'a wrapped line, "double" and \'single\' quotes, a backslash \\\\, a comment close */,',
    'an escaped tag \\</script>, and a line separator \u2028 here.',
    '',
    '| What ` | How ${x} |',
    '| ------ | -------- |',
    '| a `    | b ${y}   |',
    '',
    '> a quoted ` line',
    '',
    '- an item with ` and ${z}',
    '',
    '1. first ` item',
    '2. second ${w} item',
    '',
    '### a heading with ` and ${v}',
    '',
    '---',
  ].join('\n');

  it('does not throw', () => {
    expect(() => renderNoticeModule(HOSTILE)).not.toThrow();
  });

  it('puts every notice-derived string in a double-quoted literal — never a template literal', () => {
    // The fixture's own backticks and `${…}` are DATA, so they legitimately appear INSIDE
    // double-quoted strings. What must never appear is one in a CODE position, which is exactly
    // what a template-literal emitter would produce. So: drop the header comment (which documents
    // the rule in backticks), blank out every string literal, and look at what is left.
    const emitted = renderNoticeModule(HOSTILE);
    const body = emitted.slice(emitted.indexOf(' */\n') + ' */\n'.length);
    const codePositions = body.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    expect(codePositions).not.toContain('`');
    expect(codePositions).not.toContain('${');
  });

  it('round-trips: the emitted payload JSON.parses back to the in-memory model', () => {
    const emitted = renderNoticeModule(HOSTILE);
    const marker = 'export const NOTICE_BLOCKS: readonly Block[] = ';
    const start = emitted.indexOf(marker) + marker.length;
    const payload = emitted.slice(start).replace(/ as const;\n$/, '');
    expect(JSON.parse(payload) as Block[]).toEqual(parseNotice(HOSTILE).blocks);
  });

  it('keeps the live access code out of the output, by name and by value', () => {
    const emitted = renderNoticeModule(HOSTILE);
    // The interpolation is DATA, not an expression: it survives verbatim inside a JSON string…
    expect(emitted).toContain('${process.env.ACCESS_GATE_PASSWORD}');
    // …and the secret it would have resolved to is nowhere in the file.
    expect(emitted).not.toContain(process.env.ACCESS_GATE_PASSWORD!);
  });
});
