/**
 * PRIV-2 — the hand-written block model the generated notice must satisfy.
 *
 * `docs/privacy/notice.md` is the reviewed artifact (PRIV-1). `scripts/generate-privacy-notice.ts`
 * renders it into `notice-content.ts`; `app/privacy/notice-article.tsx` renders THAT into semantic
 * HTML. This file is the contract between the two, which is why it is hand-written and lives in
 * `lib/` rather than `app/`: both `scripts/` and `app/` import it, and every existing script imports
 * `../lib/`, never `../app/`.
 *
 * Arrays are `readonly` on purpose: the generated module is emitted `as const`, so a mutable array
 * type here would reject it at `pnpm typecheck` — which is the direction acceptance 6 wants, but for
 * the wrong reason.
 */

/** A span inside a block. No inline code, no images, no raw HTML — the generator throws on those. */
export type Inline =
  | { k: 'text'; text: string }
  | { k: 'strong'; children: readonly Inline[] }
  | { k: 'em'; children: readonly Inline[] }
  | { k: 'link'; href: string; children: readonly Inline[] };

/** One two-column table row: the label and its value. Rendered as `<dt>` + `<dd>`. */
export type Row = { term: readonly Inline[]; desc: readonly Inline[] };

/**
 * One block of the notice, in source order.
 *
 * ⚠️ `dl` carries `head` — the table's column headings — because `marked` carries `header`
 * separately from `rows`. A model without it drops `| Who it reaches | What they get |` and
 * `| What | How long |` from a privacy notice, and the byte-exact drift test CANNOT catch that: it
 * compares the generator's output to the committed module, never the module to the source's meaning.
 */
export type Block =
  | { k: 'h1' | 'h2' | 'h3'; children: readonly Inline[] }
  | { k: 'p'; children: readonly Inline[] }
  // An item is a LIST of blocks: a markdown list item can hold a continuation paragraph.
  | { k: 'ul' | 'ol'; items: readonly (readonly Block[])[] }
  | { k: 'dl'; head: Row; rows: readonly Row[] }
  | { k: 'quote'; blocks: readonly Block[] }
  | { k: 'hr' };

/**
 * Every member of `Block['k']`. `satisfies` makes this exhaustive at compile time, so the
 * non-vacuity floor in `notice-content.test.ts` is derived from the union rather than hand-listed.
 */
export const BLOCK_KINDS = [
  'h1',
  'h2',
  'h3',
  'p',
  'ul',
  'ol',
  'dl',
  'quote',
  'hr',
] as const satisfies readonly Block['k'][];

/** A compile error at every unhandled case, and a loud throw if one ever reaches runtime. */
function assertNever(x: never): never {
  throw new Error(`unhandled block/inline: ${JSON.stringify(x)}`);
}

/** The plain text of a run of inline nodes, including the text inside `strong`, `em` and `link`. */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.k) {
        case 'text':
          return n.text;
        case 'strong':
        case 'em':
        case 'link':
          return inlineText(n.children);
        default:
          return assertNever(n);
      }
    })
    .join('');
}

/**
 * The plain text of one block, **at every nesting depth**.
 *
 * ⚠️ This is the load-bearing half of the zero-placeholder gate. Placeholder text in this document
 * does not live only in top-level paragraphs: the three vendor retention windows were `dl` row
 * descriptions, and the sign-off's blank underscore run was inside a blockquote. A flattener that
 * walks only `children` makes the gate pass **while the placeholders are visible on the page**. The
 * `assertNever` default is what makes forgetting a case a compile error rather than a silent gap,
 * and living in the same file as the union is what makes that check bind.
 */
export function blockText(b: Block): string {
  switch (b.k) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'p':
      return inlineText(b.children);
    case 'ul':
    case 'ol':
      return b.items.flat().map(blockText).join(' ');
    case 'dl':
      return [b.head, ...b.rows].flatMap((r) => [inlineText(r.term), inlineText(r.desc)]).join(' ');
    case 'quote':
      return b.blocks.map(blockText).join(' ');
    case 'hr':
      return '';
    default:
      return assertNever(b);
  }
}
