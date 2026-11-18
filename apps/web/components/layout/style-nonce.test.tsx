// @vitest-environment jsdom
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setNonce } = vi.hoisted(() => ({ setNonce: vi.fn() }));
vi.mock('get-nonce', () => ({ setNonce }));

import { resetStyleNonceForTest, StyleNonce } from './style-nonce';

/** A `<script>` carrying a nonce, as the page's own scripts do (`ThemeProvider`'s, Next's). */
function scriptWithNonce(nonce: string): HTMLScriptElement {
  const el = document.createElement('script');
  el.nonce = nonce;
  el.setAttribute('nonce', nonce);
  document.head.append(el);
  return el;
}

describe('StyleNonce', () => {
  beforeEach(() => {
    resetStyleNonceForTest();
    setNonce.mockClear();
  });
  afterEach(() => {
    document.head.querySelectorAll('script[nonce]').forEach((el) => el.remove());
  });

  it("hands the scroll lock the loaded page's nonce", () => {
    scriptWithNonce('first-doc');
    render(<StyleNonce />);
    expect(setNonce).toHaveBeenCalledExactlyOnceWith('first-doc');
  });

  it('does nothing on a page with no nonce', () => {
    render(<StyleNonce />);
    expect(setNonce).not.toHaveBeenCalled();
  });

  // The root layout re-renders with a fresh `x-nonce` on every refresh, but the page's CSP keeps the
  // first document's. A later value must never replace the first.
  it('keeps the first nonce when it mounts again with another one present', () => {
    const first = scriptWithNonce('first-doc');
    const { unmount } = render(<StyleNonce />);
    unmount();
    first.remove();
    scriptWithNonce('from-a-refresh');
    render(<StyleNonce />);
    expect(setNonce).toHaveBeenCalledExactlyOnceWith('first-doc');
  });
});

describe('get-nonce has one copy', () => {
  // If the app's `get-nonce` and the injector's were two files, `setNonce` would set a variable the
  // injector never reads, and nothing would fail until production.
  it('the app and react-style-singleton resolve the same file', () => {
    const web = join(dirname(fileURLToPath(import.meta.url)), '../..');
    // Each package's own directory, from its entry point (not every package exports package.json).
    const step = (from: string, pkg: string) => {
      const entry = realpathSync(createRequire(join(from, 'x.js')).resolve(pkg));
      const marker = `/node_modules/${pkg}/`;
      return entry.slice(0, entry.lastIndexOf(marker) + marker.length - 1);
    };
    const singleton = [
      'radix-ui',
      '@radix-ui/react-dialog',
      'react-remove-scroll',
      'react-style-singleton',
    ].reduce(step, web);
    const fromApp = realpathSync(createRequire(join(web, 'x.js')).resolve('get-nonce'));
    const fromInjector = realpathSync(createRequire(join(singleton, 'x.js')).resolve('get-nonce'));
    expect(fromInjector).toBe(fromApp);
  });
});
