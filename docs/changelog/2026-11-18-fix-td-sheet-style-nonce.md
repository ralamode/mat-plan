- **2026-11-18** — **An open sheet locks the page behind it again in production**
  ([plan](../plans/td-sheet-style-nonce.md)). When a picker or dialog opens, the page behind it is
  meant to stop scrolling. The browser's content security policy blocked the style that does this,
  because the style carried no nonce, and the console logged an error on every open. The app now gives that style the page's own nonce;
  the policy is unchanged. A browser test opens a sheet under the real policy, including after a
  page refresh, and checks that the lock applies.
