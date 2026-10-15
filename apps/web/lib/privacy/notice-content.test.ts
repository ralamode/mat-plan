import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BLOCK_CLASS } from '@/app/privacy/notice-article';
import { GITHUB_REPO_URL } from '@/lib/constants';

import { NOTICE_BLOCKS, NOTICE_SOURCE_PATH, NOTICE_TITLE } from './notice-content';
import { type Block, BLOCK_KINDS, blockText, inlineText } from './notice-model';

/**
 * PRIV-2 — properties of the committed DATA, and of the renderer that turns it into a page.
 *
 * 🔴 **Every expectation here is derived from `docs/privacy/notice.md`, never hand-pinned.** The
 * drift test in `scripts/generate-privacy-notice.test.ts` compares the generator's output to this
 * module and can therefore never notice that the two agree on something the source never said: a
 * `dl` model that dropped both tables' column headings, or a generator that dropped nine of ten
 * retention rows, would leave it perfectly green. So this file asks the SOURCE what should be on
 * the page.
 *
 * It imports no generator and no `marked`, so it needs no devDependency to run.
 */

const WEB_DIR = resolve(import.meta.dirname, '../..');
const REPO_ROOT = resolve(WEB_DIR, '../..');
const SOURCE = readFileSync(join(REPO_ROOT, NOTICE_SOURCE_PATH), 'utf8');

/** `| a | b |` → `['a', 'b']`. */
function cells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
}

/** Every pipe table in the source: its header cells, and how many body rows it has. */
function sourceTables(): { head: string[]; rowCount: number }[] {
  const tables: string[][] = [];
  let current: string[] | null = null;
  for (const line of SOURCE.split('\n')) {
    if (line.startsWith('|')) (current ??= []).push(line);
    else if (current) {
      tables.push(current);
      current = null;
    }
  }
  if (current) tables.push(current);
  // A table is a header line, an alignment line, then one line per row.
  return tables.map((lines) => ({ head: cells(lines[0]!), rowCount: lines.length - 2 }));
}

const headings = (level: 1 | 2 | 3) =>
  [...SOURCE.matchAll(new RegExp(`^#{${level}} (.+)$`, 'gm'))].map((m) => m[1]!.trim());

const rendered = (kind: Block['k']) => NOTICE_BLOCKS.filter((b) => b.k === kind);

/** The plain text of every heading at one level, in page order. */
function headingText(kind: 'h1' | 'h2' | 'h3'): string[] {
  return NOTICE_BLOCKS.flatMap((b) => (b.k === kind ? [inlineText(b.children)] : []));
}

/** Everything the page says, at every nesting depth. The gate below depends on this being total. */
const flattened = NOTICE_BLOCKS.map(blockText).join(' ');

describe('the rendered outline matches the source, in order', () => {
  it('has exactly one h1, first, and it is the source `#` line', () => {
    expect(NOTICE_BLOCKS[0]?.k).toBe('h1');
    expect(headingText('h1')).toEqual(headings(1));
    expect(NOTICE_TITLE).toBe(headings(1)[0]);
  });

  it('renders every `##` section, in source order, with nothing added or dropped', () => {
    // The count is NOT an input: a dropped section, a reordered one or an invented one all fail.
    expect(headings(2).length).toBeGreaterThan(5);
    expect(headingText('h2')).toEqual(headings(2));
  });

  it('renders every `###` subsection, in source order', () => {
    expect(headingText('h3')).toEqual(headings(3));
  });

  it('keeps the blocks in source order (the h1 precedes every h2)', () => {
    const kinds = NOTICE_BLOCKS.map((b) => b.k);
    expect(kinds.indexOf('h1')).toBeLessThan(kinds.indexOf('h2'));
  });
});

describe('both tables survive as `dl` blocks, headers included', () => {
  const tables = sourceTables();

  it('finds the source tables (an empty parse would pass everything below)', () => {
    expect(tables.length).toBeGreaterThan(1);
    expect(tables.every((t) => t.head.length === 2)).toBe(true);
  });

  it('renders one `dl` per table, with every row', () => {
    // 🔴 "At least two dl blocks" would pass a generator that dropped nine of ten RETENTION rows.
    expect(rendered('dl')).toHaveLength(tables.length);
    const rowCounts = NOTICE_BLOCKS.flatMap((b) => (b.k === 'dl' ? [b.rows.length] : []));
    expect(rowCounts).toEqual(tables.map((t) => t.rowCount));
  });

  it('renders both column headings — `marked` carries them separately from the rows', () => {
    for (const table of tables) {
      for (const heading of table.head) {
        expect(heading).not.toBe('');
        expect(flattened).toContain(heading);
      }
    }
  });
});

describe('the block kinds on the page are the kinds the source contains', () => {
  const present = new Set(NOTICE_BLOCKS.map((b) => b.k));

  /** Which kinds the source asks for, by marker. Derived, so a new construct moves this set. */
  const expected = new Set<Block['k']>(['p']);
  if (/^# /m.test(SOURCE)) expected.add('h1');
  if (/^## /m.test(SOURCE)) expected.add('h2');
  if (/^### /m.test(SOURCE)) expected.add('h3');
  if (/^---$/m.test(SOURCE)) expected.add('hr');
  if (/^\|/m.test(SOURCE)) expected.add('dl');
  if (/^- /m.test(SOURCE)) expected.add('ul');
  if (/^\d+\. /m.test(SOURCE)) expected.add('ol');
  if (/^> /m.test(SOURCE)) expected.add('quote');

  it('is not a vacuous floor', () => {
    expect(expected.size).toBeGreaterThan(5);
  });

  it('matches exactly — nothing dropped, nothing invented', () => {
    expect([...present].sort()).toEqual([...expected].sort());
  });

  /**
   * ⚠️ The model, the generator and the renderer all handle `quote`, but the source does not use it
   * today. That is a KNOWN gap, not an accident — and it is the shape the sign-off USED to have.
   * `PRIV-1` published it as an empty `> Role: ___ Date: ___` blockquote; #289 filled it as prose,
   * which is the better page (an empty form announces a review step and shows it not taken) and
   * which removed the document's only blockquote as a side effect.
   *
   * `h3` left this list when `notice.md:21` and `:29` ("About the people in your household", "What
   * gets logged") were promoted from bold-only faux headings — a screen-reader user could not reach
   * them by heading before. The plan assigned that to PR 1; it landed here instead, with the
   * regeneration it requires.
   *
   * This assertion is how the remaining gap stays visible. `quote` is exercised directly in "the
   * flattener reaches every nesting depth" below and by the hostile fixture, so it is not untested.
   */
  it('records which kinds the source does not use yet', () => {
    expect(BLOCK_KINDS.filter((k) => !present.has(k))).toEqual(['quote']);
  });
});

describe('the zero-placeholder gate', () => {
  it('reaches every text node in the document — the gate is not partial', () => {
    // Derived from the data itself: every emitted `text` value must appear in the flattened output.
    // A flattener that forgot `dl.rows[].desc` or `quote.blocks` fails here rather than passing
    // while the text it skipped is visible on the page.
    const texts = [...JSON.stringify(NOTICE_BLOCKS).matchAll(/"text":("(?:[^"\\]|\\.)*")/g)].map(
      (m) => JSON.parse(m[1]!) as string,
    );
    expect(texts.length).toBeGreaterThan(100);
    for (const text of texts) expect(flattened).toContain(text);
  });

  it('carries no ⏳ and no blank-to-fill underscore run', () => {
    // Green on arrival (PRIV-2 PR 1 filled the last five), so this is a REGRESSION gate — and a
    // gate that has been green has been proven to run.
    expect(flattened).not.toContain('⏳');
    expect(flattened).not.toMatch(/_{3,}/);
  });
});

describe('the flattener reaches every nesting depth', () => {
  /** One probe per depth the real document HAS, quoted from `notice.md`. */
  it.each([
    ['a paragraph', 'Children do not have accounts.'],
    ['a `ul` item', 'The tiles are a convenience, not a lock.'],
    ['an `ol` item', 'Guard the code the way you would guard a password.'],
    ['a `dl` head', 'How long'],
    ['a `dl` term', 'Upstash'],
    ['a `dl` desc', 'Your IP address only'],
    ['the signed-off line', 'signed off by the maintainer'],
  ])('surfaces text from %s', (_depth, probe) => {
    expect(flattened).toContain(probe);
  });

  /**
   * …and the two depths the source does not currently reach, probed with a hand-built model. Both
   * are real: three of PRIV-1's five placeholders were `dl` row descriptions and the sign-off's
   * underscore run was inside a blockquote, so a flattener that walks only top-level `children`
   * makes the gate above pass WHILE the placeholders are visible on the page.
   */
  it('surfaces text from an h3, a quote, a nested quote and a second item block', () => {
    const probes = {
      h3: 'PROBE-H3',
      quote: 'PROBE-QUOTE',
      nested: 'PROBE-NESTED-QUOTE',
      itemSecond: 'PROBE-ITEM-SECOND-BLOCK',
      strongInLink: 'PROBE-STRONG-IN-LINK',
    };
    const blocks: Block[] = [
      { k: 'h3', children: [{ k: 'text', text: probes.h3 }] },
      {
        k: 'quote',
        blocks: [
          { k: 'p', children: [{ k: 'text', text: probes.quote }] },
          { k: 'quote', blocks: [{ k: 'p', children: [{ k: 'text', text: probes.nested }] }] },
        ],
      },
      {
        k: 'ul',
        items: [
          [
            { k: 'p', children: [{ k: 'text', text: 'first' }] },
            { k: 'p', children: [{ k: 'text', text: probes.itemSecond }] },
          ],
        ],
      },
      {
        k: 'p',
        children: [
          {
            k: 'link',
            href: 'https://example.com',
            children: [
              {
                k: 'strong',
                children: [{ k: 'em', children: [{ k: 'text', text: probes.strongInLink }] }],
              },
            ],
          },
        ],
      },
      { k: 'hr' },
    ];
    const text = blocks.map(blockText).join(' ');
    for (const probe of Object.values(probes)) expect(text).toContain(probe);
  });
});

describe('links', () => {
  // Read off the serialized data rather than through a hand-written walker: a walker that forgot a
  // depth would silently check fewer hrefs than the page renders. The serialized form cannot.
  const hrefs = [...JSON.stringify(NOTICE_BLOCKS).matchAll(/"href":("(?:[^"\\]|\\.)*")/g)].map(
    (m) => JSON.parse(m[1]!) as string,
  );

  it('finds the links (an empty list would pass everything below)', () => {
    expect(hrefs.length).toBeGreaterThan(0);
  });

  it.each(hrefs)('%s is an absolute https:// URL', (href) => {
    expect(href.startsWith('https://')).toBe(true);
  });

  it('points at the real data-inventory.md in the public repo', () => {
    expect(hrefs).toContain(`${GITHUB_REPO_URL}/blob/main/docs/privacy/data-inventory.md`);
  });

  it('leaves the contact address as prose, not a mailto link', () => {
    expect(flattened).toContain('matplandev@gmail.com');
    expect(hrefs.some((h) => h.startsWith('mailto:'))).toBe(false);
  });
});

describe('the route reads nothing at request time', () => {
  const sources = ['app/privacy', 'lib/privacy'].flatMap((dir) =>
    globSync('**/*.{ts,tsx}', { cwd: join(WEB_DIR, dir) })
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .map((f) => join(WEB_DIR, dir, f)),
  );

  it('finds the sources (an empty glob would pass everything below)', () => {
    expect(sources.length).toBeGreaterThan(2);
  });

  it.each(sources.map((f) => [f.slice(WEB_DIR.length + 1), f]))(
    '%s reads no file',
    (_rel, file) => {
      const src = readFileSync(file, 'utf8');
      // "Static or generated only — never a file read keyed on a request param" (the backlog row).
      // The no-`params` half is carried by `page.tsx`'s own signature and by typecheck — a `params`
      // regex would false-positive on the notice's own prose, which is ~1700 lines of text.
      for (const forbidden of ['node:fs', "from 'fs'", 'readFile', 'process.cwd']) {
        expect(src, `${_rel} must not read from the filesystem`).not.toContain(forbidden);
      }
    },
  );

  it('declares no `dynamic` and no `revalidate` of its own', () => {
    // It inherits the root layout's `force-dynamic`, and the per-request CSP nonce depends on that:
    // a cached or statically rendered page bakes ONE nonce into its HTML while the response header
    // carries a fresh one, so every nonce'd script is blocked silently — the theme script first.
    const page = readFileSync(join(WEB_DIR, 'app/privacy/page.tsx'), 'utf8');
    expect(page).not.toMatch(/^export\s+const\s+(dynamic|revalidate)\b/m);
  });
});

describe('the renderer undoes the preflight rules the notice depends on', () => {
  it('numbers the ordered list — `notice.md` cross-references "(1) and (2)"', () => {
    // Preflight sets `list-style: none` on `ol`. Without `list-decimal` the paragraph that tells a
    // parent the worst-case exposure points at numbers that are not on the page.
    expect(flattened).toContain('That follows from (1) and');
    expect(BLOCK_CLASS.ol).toContain('list-decimal');
    expect(BLOCK_CLASS.ul).toContain('list-disc');
  });

  it('gives every block kind a class — preflight zeroes margins on `*`', () => {
    for (const kind of BLOCK_KINDS) expect(BLOCK_CLASS[kind]).not.toBe('');
  });

  it('draws its rules from `--muted-foreground`, not `--border`', () => {
    // `--border` is oklch(0.922) on oklch(1) ≈ 1.2:1 — effectively invisible in LIGHT mode, which
    // is the riskier palette for a standalone rule on the page background.
    for (const kind of ['hr', 'quote'] as const) {
      expect(BLOCK_CLASS[kind]).toContain('muted-foreground');
      expect(BLOCK_CLASS[kind]).not.toContain('border-border');
    }
  });
});
