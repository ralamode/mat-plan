# .local-secrets/ — local, uncommitted credentials

**This README is the only committed file in here.** Everything else is gitignored
(`/.local-secrets/*` with a `!README.md` exception in the root `.gitignore`), so the
folder's _existence and contents are documented_ while the secrets themselves never
get committed. **Never commit a real secret file to this folder.**

These are account/recovery secrets that are **not** app environment variables (env
vars live in `apps/web/.env.local`, which is separately gitignored).

## What lives here (local only)

| File                        | Contents                                   |
| --------------------------- | ------------------------------------------ |
| `vercel-recovery-codes.txt` | Vercel account 2FA recovery / backup codes |

## Related local secrets (elsewhere)

- **`apps/web/.env.local`** — `ACCESS_GATE_PASSWORD`, `DATABASE_URL` (Neon pooled),
  `DATABASE_URL_UNPOOLED` (Neon direct). Loaded by `pnpm dev`.

## Rules

- Treat everything here as sensitive; do not paste into commits, PRs, logs, or issues.
- If a secret is exposed, rotate it at the source (Vercel account settings, Neon console)
  — these local copies are conveniences, not the source of truth.
