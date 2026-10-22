- **2026-10-22** — **Clerk's bot protection breaks sign-up under our CSP, and the `style-src` box we
  were watching turned out to be unanswerable from `pnpm dev`.** The first lit Clerk instance produced
  **20 CSP violations on one page load**, none of them `style-src`. All were `connect-src`:
  `cdn.protect.clerk.com/.../bootstrap.js` probing `*.client.protect.clerk.com` across **five ports**
  (443, 8443, 18443, 2082, 992), every one blocked by `connect-src 'self' ws: <frontend-api>`. Clerk's
  [CSP guide](https://clerk.com/docs/guides/secure/best-practices/csp-headers) documents exactly this:
  _"the challenge uses ephemeral ports. Without proper CSP configuration, the challenge iframe is
  blocked silently and sign-in/sign-up fails."_
  **The symptom is asymmetric and that is what made it hard to read.** Bot protection _"applies to
  sign-ups only. It never challenges a sign-in"_ — so the sign-in card rendered and worked, while the
  sign-up consent step rendered unstyled with a checkbox that could not be ticked. It looks exactly
  like the `style-src` failure the checklist had been predicting for weeks, and is not one.
  ⚠️ **`1a`'s `frame-src https://challenges.cloudflare.com` is the wrong mechanism.** It was read off
  the pinned version's own `DEFAULT_DIRECTIVES`, but at runtime `clerk-js` 6.40.0 ships bot protection
  from `protect.clerk.com` instead, so that allowance protects nothing. The fix taken is to **turn the
  protection off** (**Protect → Protections** → _"Challenge suspicious sign-ups"_, on by default),
  because sign-up is **Invite-only** — a strictly stronger gate — so this removes a redundant
  dependency rather than weakening anything, and needs no CSP change. Widening to
  `connect-src https://*.protect.clerk.com:*` was rejected: `proxy.test.ts` pins every added source
  **by exact origin, never a wildcard**, and a wildcard subdomain on any port would be the widest
  source in the policy.
  🔴 **The `style-src` box's procedure was wrong and has been corrected.** `proxy.ts:71` emits
  `'unsafe-inline'` when `NODE_ENV === 'development'`, so **a `pnpm dev` run allows every JS-injected
  style and proves nothing about production**, where only the nonce is allowed. The box now says to use
  `pnpm e2e:local` (a production build) with dev keys injected. What the dev run _did_ establish is
  worth keeping: at `@clerk/ui@1.41.1` **no stylesheet is fetched at all** — every CDN asset is `.js`
  and styles are injected from JavaScript — so there is no host to allowlist, and the open question
  narrows to whether `clerk-js` propagates the nonce we already pass via `<ClerkProvider nonce dynamic>`
  onto the `<style>` elements it creates.
