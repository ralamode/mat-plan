'use client';

import { setNonce } from 'get-nonce';
import { useEffect } from 'react';

/** Set once per page load; see {@link StyleNonce}. Module state, so a re-mount cannot overwrite it. */
let applied = false;

/**
 * Gives Radix's scroll lock the page's CSP nonce, so the `<style>` it injects when a sheet opens is
 * not blocked by `style-src 'self' 'nonce-…'` (`proxy.ts` → `buildCsp`). The lock's injector
 * (`react-style-singleton`) stamps each tag with `getNonce()` from `get-nonce`; nothing set it, so
 * every sheet's `body { overflow: hidden; overscroll-behavior: contain }` was dropped in production.
 *
 * 🔴 **The nonce comes from the loaded DOCUMENT, never from a prop, and is set once.** `x-nonce` is
 * new on every request, and the root layout re-renders on every `router.refresh()` and Server Action
 * response, but the page's CSP is the one its first document response carried. A prop would hand
 * `setNonce` a nonce the page does not allow after the first refresh. The IDL `.nonce` property is
 * read because Chrome clears the `nonce` attribute once a header CSP applies.
 *
 * Browser-only (an effect), so the server never writes `get-nonce`'s module state, which is shared
 * across requests there. Plan: docs/plans/td-sheet-style-nonce.md.
 */
export function StyleNonce(): null {
  useEffect(() => {
    if (applied) return;
    const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
    if (!nonce) return;
    setNonce(nonce);
    applied = true;
  }, []);
  return null;
}

/** Test-only: forget the one-shot, so each case starts from a fresh page load. */
export function resetStyleNonceForTest(): void {
  applied = false;
}
