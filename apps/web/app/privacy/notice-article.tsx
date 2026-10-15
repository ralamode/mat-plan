import { Fragment, type ReactNode } from 'react';

import { NOTICE_BLOCKS } from '@/lib/privacy/notice-content';
import type { Block, Inline, Row } from '@/lib/privacy/notice-model';

/**
 * PRIV-2 — the notice, rendered from the generated block model as semantic HTML.
 *
 * Hand-written on purpose: the generator emits DATA and this emits presentation, so a styling fix
 * never means editing the generator, and the UX panel reviews THIS rather than generated JSX.
 *
 * 🔴 **The per-block classes are load-bearing, not decoration.** Tailwind's preflight zeroes
 * everything a long-form document needs — `margin: 0` on `*`, `list-style: none` on `ol`/`ul`,
 * `font-size`/`font-weight: inherit` on `h1`–`h6`, `text-decoration: inherit` on `a`. With one
 * shared class string this 200-line notice renders as a single unbroken block with no bullets, no
 * numbers, no visible headings and no visible links. And `notice.md` contains _"That follows from
 * **(1) and (2)**"_ — a cross-reference to the ordered-list markers preflight removes, in the
 * paragraph that tells a parent the worst-case exposure. Without `list-decimal` it points at
 * numbers that are not on the page.
 */
export const BLOCK_CLASS = {
  h1: 'text-2xl font-semibold tracking-tight',
  h2: 'mt-10 text-lg font-semibold tracking-tight',
  h3: 'mt-6 text-base font-semibold',
  p: 'mt-4 leading-relaxed',
  ul: 'mt-4 list-disc space-y-2 ps-6 leading-relaxed',
  ol: 'mt-4 list-decimal space-y-2 ps-6 leading-relaxed',
  dl: 'mt-4 space-y-4',
  quote: 'border-muted-foreground/40 mt-6 border-s-2 ps-4 leading-relaxed',
  hr: 'border-muted-foreground/40 mt-8',
} as const satisfies Record<Block['k'], string>;

/** The table's column headings, as a caption above the list — they are not a term and its value. */
const DL_HEAD_CLASS = 'text-muted-foreground mt-6 text-xs font-semibold tracking-wide uppercase';
const DT_CLASS = 'font-semibold';
const DD_CLASS = 'mt-1 leading-relaxed';

/**
 * Prose links are UNDERLINED: preflight's `text-decoration: inherit` leaves them indistinguishable
 * from the text around them, which is WCAG 1.4.1 (colour alone). They are not grown to 44px — SC
 * 2.5.8's inline-link exception covers them, which is what `INTERACTIVE` in `e2e/a11y.spec.ts`
 * already encodes by excluding `<a>`.
 */
const PROSE_LINK_CLASS =
  'focus-visible:ring-ring rounded-sm underline underline-offset-4 outline-none focus-visible:ring-3';

function assertNever(x: never): never {
  throw new Error(`unrenderable node: ${JSON.stringify(x)}`);
}

/** Keys are positional because the data is a compiled constant: nothing reorders or splices. */
function renderInline(nodes: readonly Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.k) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'strong':
        return <strong key={i}>{renderInline(n.children)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(n.children)}</em>;
      case 'link':
        return (
          <a key={i} href={n.href} className={PROSE_LINK_CLASS}>
            {renderInline(n.children)}
          </a>
        );
      default:
        return assertNever(n);
    }
  });
}

/** Each row is a `<div>` wrapping `<dt>` + `<dd>` (valid in `<dl>`), so `space-y-4` separates
 *  ROWS rather than cells. */
function renderRow(row: Row, key: number): ReactNode {
  return (
    <div key={key}>
      <dt className={DT_CLASS}>{renderInline(row.term)}</dt>
      <dd className={DD_CLASS}>{renderInline(row.desc)}</dd>
    </div>
  );
}

function renderBlock(b: Block, key: number): ReactNode {
  switch (b.k) {
    case 'h1':
      return (
        <h1 key={key} className={BLOCK_CLASS.h1}>
          {renderInline(b.children)}
        </h1>
      );
    case 'h2':
      return (
        <h2 key={key} className={BLOCK_CLASS.h2}>
          {renderInline(b.children)}
        </h2>
      );
    case 'h3':
      return (
        <h3 key={key} className={BLOCK_CLASS.h3}>
          {renderInline(b.children)}
        </h3>
      );
    case 'p':
      return (
        <p key={key} className={BLOCK_CLASS.p}>
          {renderInline(b.children)}
        </p>
      );
    case 'ul':
      return (
        <ul key={key} className={BLOCK_CLASS.ul}>
          {b.items.map((item, i) => (
            <li key={i}>{item.map(renderItemBlock)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} className={BLOCK_CLASS.ol}>
          {b.items.map((item, i) => (
            <li key={i}>{item.map(renderItemBlock)}</li>
          ))}
        </ol>
      );
    case 'dl':
      return (
        <Fragment key={key}>
          {/* A caption, not a `<dt>`/`<dd>` pair: the column headings describe the columns. */}
          <p className={DL_HEAD_CLASS}>
            {renderInline(b.head.term)} · {renderInline(b.head.desc)}
          </p>
          <dl className={BLOCK_CLASS.dl}>{b.rows.map(renderRow)}</dl>
        </Fragment>
      );
    case 'quote':
      return (
        <blockquote key={key} className={BLOCK_CLASS.quote}>
          {b.blocks.map(renderBlock)}
        </blockquote>
      );
    case 'hr':
      return <hr key={key} className={BLOCK_CLASS.hr} />;
    default:
      return assertNever(b);
  }
}

/** A list item's first paragraph carries the marker, so it must not also carry `mt-4`. */
function renderItemBlock(b: Block, key: number): ReactNode {
  if (key === 0 && b.k === 'p') {
    return <Fragment key={key}>{renderInline(b.children)}</Fragment>;
  }
  return renderBlock(b, key);
}

/** The whole notice, in source order. No request input, no `fs`, no cookie, no DAL. */
export function NoticeArticle() {
  return <article>{NOTICE_BLOCKS.map(renderBlock)}</article>;
}
