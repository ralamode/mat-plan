- **2026-10-29** — **The security reviewer had XSS as one word on a shared "don't" list, and CSRF
  nowhere at all.** `security-reviewer.md` named `dangerouslySetInnerHTML` beside `sql.raw` and
  `NEXT_PUBLIC_`, which is a grep, not a review — and the word "CSRF" appeared nowhere in
  `SECURITY.md`, `lessons.md` or the `review-pr` rubric. Both now carry an **Injection (XSS) and
  CSRF** section, written as _what makes each sink safe today_ rather than a list of forbidden
  strings, because the forbidden string has a legitimate use here.
  🔴 **The sink grep walks past the real one.** `components/theme/theme-provider.tsx` genuinely uses
  `dangerouslySetInnerHTML` — it is React's only supported way to emit the inline no-flash script —
  so the string tells a reviewer nothing. What matters is that it is a **build-time constant**: the
  finding is anything interpolated reaching it, not the call itself.
  **The CSP facts are now written down, read off `buildCsp()` rather than remembered.**
  `script-src 'self' 'nonce-X' 'strict-dynamic'` with `'unsafe-eval'` dev-only; `style-src` takes
  `'unsafe-inline'` **dev-only** and the nonce in prod; `'unsafe-inline'` never reaches `script-src`.
  With the two traps that make a header dump misread: a nonce makes a sibling `'unsafe-inline'`
  **inert**, and `'strict-dynamic'` makes **host allowlists in `script-src` inert** — so removing
  `'strict-dynamic'` silently activates every host beside it.
  🔴 **CSRF: there are no tokens, deliberately, and the three layers that replace them do not cover
  the same shapes.** Server Actions (every mutation today) are covered by Next's own Origin-vs-Host
  check, with `serverActions.allowedOrigins` unset. Cookies carry `SameSite=Lax` + `httpOnly` +
  `secure` in prod. **Route Handlers are covered by neither** — Next's check does not extend to them.
  The only one today is `GET`, so nothing is exposed; but **`/api/sync` is planned as a `POST` Route
  Handler** and will land outside the protection everything else relies on, on a path that is also
  outside the gate matcher. That is now a named **P0** condition rather than something the next
  author has to re-derive.
  Also recorded as absent-by-design, each a finding the first time it appears: Markdown→HTML
  rendering, rich text, SVG or any file upload, a templating engine, and `eval` / `new Function`.
  Every claim was verified against source in this PR, not from memory.
