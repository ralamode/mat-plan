import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { appSources, code, WEB_DIR } from '../test/source-scan';

import { AA_LARGE, ratioOf } from './design/tokens/contrast';
import { blockOf } from './design/tokens/css-block';

/**
 * The focus ring is at least 3:1 (WCAG 2.2 SC 1.4.11 / 2.4.13) against every surface a focusable
 * control sits on, in both themes, measured from `globals.css` itself.
 *
 * The ratio pinned here is only the ring a browser draws if the ring is drawn OPAQUE: `ring-ring/50`
 * composites the token with the page and lands near 1.5:1, which is how the app shipped under 3:1
 * for months with a token that measured fine. So the second half scans the source for a focus ring
 * or outline drawn with an alpha.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const globals = readFileSync(join(HERE, 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every ground a focused control sits on: the page, a card or sheet, a hover/selected row, a logged row. */
const GROUNDS = ['background', 'card', 'popover', 'accent', 'muted', 'done-surface'] as const;

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
] as const)('the focus ring, %s', (_theme, selector) => {
  const t = blockOf(globals, selector)!;
  const ratio = (fg: string, bg: string): number => ratioOf(t[fg]!, t[bg]!, t['background']!)!;

  it.each(GROUNDS)('ring clears 3:1 on %s', (ground) => {
    expect(ratio('ring', ground)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it.each(['background', 'card'] as const)('the destructive ring clears 3:1 on %s', (ground) => {
    expect(ratio('destructive', ground)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('--sidebar-ring is --ring, so a regenerated sidebar cannot bring the old value back', () => {
    expect(t['sidebar-ring']).toBe('var(--ring)');
  });
});

/**
 * A ring or outline with an alpha under a focus variant. `aria-invalid:` rings are an error STATE
 * shown without focus, not a focus indicator, so they are not this rule's.
 */
const FOCUS_ALPHA =
  /(?:focus-visible|focus-within|focus|has-\[:focus-visible\]|group-focus-visible|peer-focus-visible):(?:ring|outline)-[a-z-]+\/\d+/g;

describe('no focus ring is drawn translucent', () => {
  // The temporary `/design` harness is left out: it demonstrates candidate palettes, not the app.
  const files = appSources().filter((f) => !f.startsWith(join(WEB_DIR, 'app/design/')));

  it('scans a real tree', () => {
    // A glob that matched nothing would make the assertion below pass vacuously.
    expect(files.length).toBeGreaterThan(50);
  });

  it('no focus variant carries a ring or outline alpha', () => {
    const hits = files.flatMap((f) =>
      [...code(f).matchAll(FOCUS_ALPHA)].map((m) => `${f.slice(WEB_DIR.length + 1)}: ${m[0]}`),
    );
    expect(hits).toEqual([]);
  });

  it("…nor the base layer's default outline", () => {
    expect(globals).not.toMatch(/outline-ring\/\d+/);
  });
});
