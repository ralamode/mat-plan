- **2026-10-01** — **SEC-4: the gate's redirect helper accepts only same-origin paths.**
  `safeInternalPath` checked only for one leading slash, but the URL parser rewrites `\` to `/` and
  drops tab/CR/LF, so some single-slash paths resolved to another origin. It now rejects backslashes
  and control characters (raw or percent-encoded) and requires the path to resolve to the same origin,
  before AUTH-1 or an invite flow reuses it. Found by #193's security review.
