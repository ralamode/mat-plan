import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Marked, type Token, type Tokens } from 'marked';

import { GITHUB_REPO_URL } from '../lib/constants';
import type { Block, Inline, Row } from '../lib/privacy/notice-model';

/**
 * PRIV-2 — render `docs/privacy/notice.md` into a committed TypeScript module.
 *
 *     pnpm privacy:generate
 *
 * Why generate instead of transcribing: `notice.md` stays the one reviewed artifact (PRIV-1), every
 * claim in it still traces to `docs/privacy/data-inventory.md`, and the served page cannot drift
 * from it — `generate-privacy-notice.test.ts` fails, byte-exactly, when the two disagree.
 *
 * Why this lives in `scripts/`: `marked` is a devDependency used only here. Nothing it touches
 * enters the production tree `audit:check` gates, and nothing enters the shipped bundle but data and
 * JSX — no parser, no `fs`, no `dangerouslySetInnerHTML`.
 *
 * It is deliberately specific to this ONE document: the walk is exhaustive and **throws** on any
 * construct it has not seen, naming the construct and its raw text, rather than dropping it
 * silently from a privacy notice.
 */

/** Repo-relative, so the emitted module and every error message name the same file a human edits. */
export const SOURCE_PATH = 'docs/privacy/notice.md';

/** The repo root, from this file rather than from `cwd`: the script must work from any directory. */
const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * Relative markdown links, mapped to a path inside the public repo.
 *
 * The notice points at `data-inventory.md` as "the public source", so the served page has to point
 * at the file on GitHub. `GITHUB_REPO_URL` is the existing const — no second URL literal.
 */
const RELATIVE_LINK_REWRITES = {
  './data-inventory.md': 'blob/main/docs/privacy/data-inventory.md',
} as const;

/**
 * 🔴 `marked` does **no** protocol filtering. Its `cleanUrl` only percent-encodes, and the
 * `sanitize` option was removed in v5, so `[x](javascript:alert(1))` yields exactly that `href`.
 * The allowlist is therefore ours: `https://` only, plus the one mapped relative rewrite.
 *
 * Everything else throws, deliberately including:
 *   - `http://`      — a privacy notice must not link over plaintext;
 *   - `mailto:`      — PRIV-1 settled the contact route as PROSE, not a link (see `noticeLexer`);
 *   - `javascript:`, `data:`, `//evil.example`, `#fragment`, and any unmapped relative path.
 */
export function resolveHref(
  raw: string,
  // Injectable ONLY so the on-disk guard below is testable with an entry that points at nothing.
  rewrites: Readonly<Record<string, string>> = RELATIVE_LINK_REWRITES,
): string {
  if (raw.startsWith('https://')) return raw;
  const rewrite = rewrites[raw];
  if (rewrite) {
    // A move or rename must fail the generator, not publish a 404 inside a privacy notice.
    const target = join(REPO_ROOT, 'docs/privacy', raw);
    if (!existsSync(target)) {
      throw new Error(
        `${SOURCE_PATH}: link target ${JSON.stringify(raw)} rewrites to ${JSON.stringify(rewrite)}, ` +
          `but ${JSON.stringify(target)} does not exist — fix the rewrite map, not the notice`,
      );
    }
    return `${GITHUB_REPO_URL}/${rewrite}`;
  }
  throw new Error(`${SOURCE_PATH}: refusing link target ${JSON.stringify(raw)}`);
}

/**
 * The lexer, with GFM autolinking of bare URLs and e-mail addresses **off**.
 *
 * 🔴 Not cosmetic. `notice.md` gives the contact address as prose (`write to matplandev@gmail.com.`)
 * — PRIV-1's deliberate choice, since a `mailto:` is a second contact surface to keep correct. But
 * GFM's `url` tokenizer turns a bare address into `{ href: 'mailto:…' }` anyway, which `resolveHref`
 * would then (correctly) refuse. Disabling that one tokenizer keeps the author's prose as prose and
 * leaves the allowlist's `mailto:` refusal reachable for an EXPLICIT `[x](mailto:…)` link.
 */
function noticeLexer(markdown: string): Token[] {
  return new Marked({ tokenizer: { url: () => undefined } }).lexer(markdown);
}

function unknown(what: string, token: { type?: string; raw?: string }): never {
  throw new Error(
    `${SOURCE_PATH}: unsupported ${what} ${JSON.stringify(token.type)} — ` +
      `either teach the generator and the renderer about it, or rewrite the source. Raw: ` +
      JSON.stringify((token.raw ?? '').slice(0, 120)),
  );
}

function toInline(tokens: readonly Token[] | undefined): Inline[] {
  return (tokens ?? []).flatMap((t): Inline[] => {
    switch (t.type) {
      case 'text': {
        const text = t as Tokens.Text;
        // A `text` token is a CONTAINER when it carries children (a table cell's run, a list item's
        // line) — flatten into them. Wrapping it in a node of its own would add a span the source
        // never asked for; an earlier draft wrapped it in `strong` and silently bolded whole items.
        if (text.tokens && text.tokens.length > 0) return toInline(text.tokens);
        return [{ k: 'text', text: text.text }];
      }
      case 'escape':
        // `\*` and friends: the escaped character, as literal text.
        return [{ k: 'text', text: (t as Tokens.Escape).text }];
      case 'strong':
        return [{ k: 'strong', children: toInline((t as Tokens.Strong).tokens) }];
      case 'em':
        return [{ k: 'em', children: toInline((t as Tokens.Em).tokens) }];
      case 'link': {
        const link = t as Tokens.Link;
        return [{ k: 'link', href: resolveHref(link.href), children: toInline(link.tokens) }];
      }
      default:
        return unknown('inline token', t);
    }
  });
}

/**
 * One list item's content, as blocks.
 *
 * A TIGHT item's line arrives as a block-level `text` token rather than a `paragraph` — the one
 * place that token appears at block level — so it is handled here instead of widening the general
 * block switch, which must keep throwing on a stray `text` anywhere else.
 */
function toItemBlocks(tokens: readonly Token[]): Block[] {
  return tokens.flatMap((t): Block[] => {
    if (t.type === 'text') {
      const text = t as Tokens.Text;
      return [
        {
          k: 'p',
          children:
            text.tokens && text.tokens.length > 0
              ? toInline(text.tokens)
              : [{ k: 'text', text: text.text }],
        },
      ];
    }
    return toBlocks([t]);
  });
}

function toRow(cells: readonly Tokens.TableCell[], label: string): Row {
  if (cells.length !== 2) {
    throw new Error(
      `${SOURCE_PATH}: table ${label} has ${cells.length} columns — the notice's tables render as a ` +
        `two-column <dl> (label → value); a third column has nowhere to go`,
    );
  }
  return { term: toInline(cells[0]!.tokens), desc: toInline(cells[1]!.tokens) };
}

function toBlocks(tokens: readonly Token[]): Block[] {
  const blocks: Block[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
        break;
      case 'heading': {
        const h = t as Tokens.Heading;
        if (h.depth !== 1 && h.depth !== 2 && h.depth !== 3) {
          throw new Error(
            `${SOURCE_PATH}: heading depth ${h.depth} — the notice's outline is h1/h2/h3 ` +
              `(a skipped level is an a11y defect). Raw: ${JSON.stringify(h.raw.trim())}`,
          );
        }
        blocks.push({ k: `h${h.depth}`, children: toInline(h.tokens) });
        break;
      }
      case 'paragraph':
        blocks.push({ k: 'p', children: toInline((t as Tokens.Paragraph).tokens) });
        break;
      case 'hr':
        blocks.push({ k: 'hr' });
        break;
      case 'blockquote':
        blocks.push({ k: 'quote', blocks: toBlocks((t as Tokens.Blockquote).tokens) });
        break;
      case 'list': {
        const list = t as Tokens.List;
        blocks.push({
          k: list.ordered ? 'ol' : 'ul',
          items: list.items.map((item) => toItemBlocks(item.tokens)),
        });
        break;
      }
      case 'table': {
        const table = t as Tokens.Table;
        const label = JSON.stringify(table.header.map((c) => c.text).join(' | '));
        for (const [i, cell] of table.header.entries()) {
          if (cell.text.trim() === '') {
            throw new Error(
              `${SOURCE_PATH}: table ${label} has an empty header cell in column ${i + 1} — the ` +
                `column headings are rendered, so a blank one asks the reader to guess what the ` +
                `column means`,
            );
          }
        }
        blocks.push({
          k: 'dl',
          head: toRow(table.header, label),
          rows: table.rows.map((cells) => toRow(cells, label)),
        });
        break;
      }
      default:
        return unknown('block token', t);
    }
  }
  return blocks;
}

/** The parsed notice: its `<h1>` text, and every block in source order. */
export function parseNotice(markdown: string): { title: string; blocks: Block[] } {
  const blocks = toBlocks(noticeLexer(markdown));
  const first = blocks[0];
  if (!first || first.k !== 'h1') {
    throw new Error(`${SOURCE_PATH}: expected an h1 first, found ${JSON.stringify(first?.k)}`);
  }
  const extraH1 = blocks.slice(1).filter((b) => b.k === 'h1').length;
  if (extraH1 > 0) {
    throw new Error(`${SOURCE_PATH}: ${extraH1 + 1} h1 headings — a page gets exactly one`);
  }
  // The title is the h1's plain text, flattened here rather than in the page (which has no parser).
  const title = first.children.map((n) => (n.k === 'text' ? n.text : '')).join('');
  if (title.trim() === '') {
    throw new Error(`${SOURCE_PATH}: the h1 has no plain text to use as the page title`);
  }
  return { title, blocks };
}

const HEADER_COMMENT = `/**
 * GENERATED — DO NOT EDIT.
 *
 * Source:     ${SOURCE_PATH}  (the reviewed artifact; PRIV-1)
 * Generator:  apps/web/scripts/generate-privacy-notice.ts
 * Regenerate: pnpm privacy:generate
 *
 * The reviewable diff is the SOURCE, not this file: this is the same words, in the same order, as
 * data. \`generate-privacy-notice.test.ts\` fails byte-exactly when the two disagree, so editing
 * this file by hand only reddens \`pnpm test\`.
 *
 * Ignored by Prettier (.prettierignore) and ESLint (eslint.config.mjs) — a formatter rewriting it on
 * commit would fail the drift test on a fix nobody made.
 */`;

/**
 * 🔴 **Every string derived from `notice.md` is emitted through `JSON.stringify`.** Never
 * concatenated into a template literal, never interpolated.
 *
 * The risk is one layer below HTML injection (React escapes text children, and
 * `dangerouslySetInnerHTML` is on AGENTS.md's "don't" list): a backtick or a `${…}` in the notice
 * lands in a `.ts` module that `next build` **compiles**. The worst shape is not hypothetical —
 * `${process.env.ACCESS_GATE_PASSWORD}` inside an emitted template literal would compile to the
 * live access code, in a file served to anyone. A backtick or `${` inside a double-quoted JSON
 * string is inert in TypeScript, which is the whole property, and the hostile round-trip fixture in
 * the test proves it rather than arguing it.
 */
export function renderNoticeModule(markdown: string): string {
  const { title, blocks } = parseNotice(markdown);
  return (
    [
      HEADER_COMMENT,
      ``,
      `import type { Block } from '@/lib/privacy/notice-model';`,
      ``,
      `export const NOTICE_SOURCE_PATH = ${JSON.stringify(SOURCE_PATH)};`,
      ``,
      `export const NOTICE_TITLE = ${escapeSource(JSON.stringify(title))};`,
      ``,
      `export const NOTICE_BLOCKS: readonly Block[] = ${escapeSource(
        JSON.stringify(blocks, null, 2),
      )} as const;`,
    ].join('\n') + '\n'
  );
}

/**
 * The one thing `JSON.stringify` leaves raw that a `.ts` file cares about: U+2028 / U+2029.
 * `JSON.parse` reads `\u2028` back as the same character, so the emitted payload is still valid
 * JSON and the round-trip fixture still deep-equals — this only keeps the SOURCE file parseable by
 * a toolchain that predates the ES2019 "JSON superset" change. Applied to the stringified output,
 * never to the prose, so the rule "every string goes through JSON.stringify" still holds.
 */
function escapeSource(json: string): string {
  return json.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Where the generated module lands, relative to the repo root. */
export const OUTPUT_PATH = 'apps/web/lib/privacy/notice-content.ts';

export function sourceFile(): string {
  return join(REPO_ROOT, SOURCE_PATH);
}

export function outputFile(): string {
  return join(REPO_ROOT, OUTPUT_PATH);
}

function main(): void {
  const markdown = readFileSync(sourceFile(), 'utf8');
  writeFileSync(outputFile(), renderNoticeModule(markdown), 'utf8');
  console.log(`✓ ${OUTPUT_PATH} ← ${SOURCE_PATH}`);
}

// `tsx scripts/generate-privacy-notice.ts` runs it; the test imports the pure half and runs nothing.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
