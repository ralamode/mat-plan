#!/usr/bin/env node
// OPS-1 — verify, from outside the deployment, that Vercel's Preview scope holds no production
// credential. Plan: docs/plans/ops-1-preview-isolation.md. Procedure: docs/runbooks.md -> OPS-1.
//
//   pnpm preview:check                              # live; needs VERCEL_TOKEN + VERCEL_PROJECT_ID
//   node .github/scripts/check-preview-isolation.mjs --snapshot <file>|-   # offline, self-test only
//
// Exit: 0 isolated · 1 isolation is BROKEN · 2 could not check (nothing was asserted).
//   The 1/2 split is not decoration: `check-audit.mjs` records that collapsing them is how a guard
//   ships a permanently-green bypass. This is the only guard here that makes a NETWORK call, so
//   "the registry was unreachable" and "a production secret is shared with Preview" must never
//   reach a maintainer as the same verdict. Every check also fails on a MISSING field rather than
//   passing — `gitForkProtection` appears in no `required` list in Vercel's schema, so absence means
//   "could not verify", not "fine".
//
// WHY THIS IS NOT A CI JOB. It needs a Vercel API token, and Vercel tokens are account- or
// team-scoped with NO read-only scope: one can decrypt every production environment variable in the
// project and create deployments. Putting a credential with that reach into a PUBLIC repo's Actions
// secrets, in order to verify that credentials are not over-shared, inverts the trade. It is a local
// command the runbook invokes and the runbook revokes. It is therefore NOT in `pnpm verify` either
// (which must stay offline and fast); only its self-test is, via `guards:test`.
//
// IT NEVER READS A SECRET VALUE. `GET /v10/projects/{id}/env` returns each record's `key`, `type`
// and `target` scopes without decryption, which is enough to answer "is this one record spanning
// several scopes, or one record per scope?" — the exact shape of the pre-OPS-1 misconfiguration. So:
// no `decrypt` parameter, and no call to the per-id `/env/{id}` endpoint. The claim rests on the
// endpoint set (asserted by the self-test), not on omitting one deprecated query parameter.
//
// WHAT IT CANNOT CATCH, stated here because a verification whose limits are unwritten is how this
// repo acquired four claimed-but-unwired gates:
//   * two DISTINCT records holding the SAME value — that needs decryption, which this never does;
//   * anything about the Neon project behind a connection string, or whether the preview database
//     really holds only seed data;
//   * a preview database someone NAMED like production (the in-app guard matches on the name);
//   * historical preview deployments, which keep whatever they were built with — the runbook's
//     purge-and-rotate step is the only control there;
//   * a Preview record scoped to a single `gitBranch`, which leaves other branches with no value.
//     That fails closed on the required variables, so it is cosmetic, but it is not detected here.
//   * Vercel changing its API shape. The self-test runs against CRAFTED snapshots, so it proves this
//     script's parser — NOT the live contract. Only a live run proves that.

import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const OK = 0;
const BROKEN = 1;
const CANNOT_CHECK = 2;

const PRODUCTION = 'production';
const PREVIEW = 'preview';

/**
 * Variables that may legitimately carry the SAME value in more than one scope.
 *
 * DELIBERATELY EMPTY, and the direction matters. A list of *secrets to check* fails OPEN: a
 * credential added to `lib/env.ts` and forgotten here would simply never be asserted, and this
 * script would print all-green. An allowlist fails CLOSED: every shared variable reds the check
 * until someone writes down why, including variables nobody thought to enumerate.
 *
 * AUTH-1 is the first expected entry: a Clerk wiring legitimately shares non-secret path constants
 * (`NEXT_PUBLIC_CLERK_SIGN_IN_URL` and friends) across scopes while only `pk_`/`sk_` differ. Add
 * each one here WITH a comment saying why it is not a secret. A `NEXT_PUBLIC_` prefix is a strong
 * hint, never a licence — AGENTS.md forbids that prefix on a secret, so a `NEXT_PUBLIC_` variable
 * that looks like a credential is a bug to fix, not an entry to add.
 */
const SHAREABLE = new Set([]);

/** Variables that must exist, separately, in BOTH the production and preview scopes. */
const REQUIRED_PER_SCOPE = ['DATABASE_URL'];

/** Never legitimate in any Vercel scope: it disables env validation, OPS-1's guard included. */
const FORBIDDEN_ANYWHERE = ['SKIP_ENV_VALIDATION'];

const API_BASE = 'https://api.vercel.com';

function die(code, message) {
  console.error(`check-preview-isolation: ${message}`);
  process.exit(code);
}

// ── Input ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Read a crafted snapshot for the self-test: `{ project: {...}, env: { envs: [...] } }`.
 *
 * REFUSES A PATH INSIDE THE WORKING TREE. A live capture of `GET /env` carries the project id,
 * `createdBy`, the full variable-key inventory and every `plain` value — and gitleaks flags none of
 * it. Committed snapshots are hand-crafted only; a real capture belongs in the gitignored
 * `.local-secrets/`. The one exception is `-` (stdin) and the self-test's own temp directory, which
 * is outside the tree by construction.
 */
function readSnapshot(path) {
  let raw;
  if (path === '-') {
    raw = readFileSync(0, 'utf8');
  } else {
    const abs = resolve(path);
    const tree = realpathSync(resolve(import.meta.dirname, '..', '..'));
    let real;
    try {
      real = realpathSync(abs);
    } catch {
      die(CANNOT_CHECK, `--snapshot ${path}: no such file.`);
    }
    const rel = relative(tree, real);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      die(
        CANNOT_CHECK,
        `--snapshot must not resolve inside the repository (${rel}). A captured Vercel env ` +
          `response holds the project id and every plain value; keep captures in .local-secrets/. ` +
          `Committed fixtures are hand-crafted only.`,
      );
    }
    raw = readFileSync(real, 'utf8');
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    die(CANNOT_CHECK, `--snapshot is not valid JSON: ${err.message}`);
  }
}

async function fetchVercel() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    die(
      CANNOT_CHECK,
      'set VERCEL_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID for a team project). ' +
        'Create the token team-scoped with the shortest expiry Vercel offers, pass it with ' +
        '`read -s VERCEL_TOKEN` so it misses your shell history, and revoke it afterwards — ' +
        'see docs/runbooks.md -> OPS-1.',
    );
  }
  const team = process.env.VERCEL_TEAM_ID
    ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}`
    : '';
  const id = encodeURIComponent(projectId);
  // No `decrypt`, and no `/env/{id}`: this script reads STRUCTURE, never values.
  const urls = {
    project: `${API_BASE}/v9/projects/${id}${team}`,
    env: `${API_BASE}/v10/projects/${id}/env${team}`,
  };
  const out = {};
  for (const [key, url] of Object.entries(urls)) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      die(CANNOT_CHECK, `could not reach the Vercel API (${key}): ${err.message}`);
    }
    if (!res.ok) {
      die(
        CANNOT_CHECK,
        `Vercel API returned ${res.status} for ${key}. Nothing was asserted. ` +
          `(401/403 = the token is expired or lacks access; 404 = wrong VERCEL_PROJECT_ID.)`,
      );
    }
    try {
      out[key] = await res.json();
    } catch (err) {
      die(CANNOT_CHECK, `Vercel API response for ${key} was not JSON: ${err.message}`);
    }
  }
  return out;
}

// ── Checks ──────────────────────────────────────────────────────────────────────────────────────

const results = [];
const record = (status, label, detail) => results.push({ status, label, detail });
const pass = (label, detail) => record('pass', label, detail);
const fail = (label, detail) => record('fail', label, detail);
const unknown = (label, detail) => record('unknown', label, detail);

/** A boolean project setting that must be `true`, where ABSENT means "could not verify". */
function checkProjectFlag(project, field, label, why) {
  const value = project?.[field];
  if (value === true) return pass(label, 'on');
  if (value === false) return fail(label, `off — ${why}`);
  return unknown(
    label,
    `the project response has no \`${field}\` field, so this could not be verified. ` +
      `In the Vercel dashboard, toggle the setting off, save, on, save — that persists the field. ` +
      `If it still does not appear, Vercel renamed it and this guard needs updating.`,
  );
}

function checkEnv(envResponse) {
  const records = envResponse?.envs;
  if (!Array.isArray(records)) {
    unknown(
      'environment variables',
      'the env response has no `envs` array, so no variable was examined.',
    );
    return;
  }

  // 1. Nothing may carry the production scope into another scope. Phrased around `production`
  //    rather than around the production/preview pair because Vercel's DEVELOPMENT scope held the
  //    same production values too, and `vercel env pull` hands those to a laptop.
  const shared = records
    .filter((r) => Array.isArray(r.target) && r.target.includes(PRODUCTION) && r.target.length > 1)
    .filter((r) => !SHAREABLE.has(r.key));
  if (shared.length === 0) {
    pass('no variable shares the production scope', `${records.length} record(s) examined`);
  } else {
    fail(
      'no variable shares the production scope',
      shared.map((r) => `${r.key} targets ${[...r.target].sort().join(' + ')}`).join('; ') +
        ` — give each scope its own record, or add a genuinely non-secret key to SHAREABLE in ` +
        `this script with a comment saying why.`,
    );
  }

  // 2. SKIP_ENV_VALIDATION would disable the in-app guard, silently, from the dashboard.
  for (const key of FORBIDDEN_ANYWHERE) {
    const hits = records.filter((r) => r.key === key);
    if (hits.length === 0) {
      pass(`${key} is not set`, 'absent from every scope');
    } else {
      fail(
        `${key} is not set`,
        `present in ${hits.flatMap((r) => r.target ?? []).join(', ') || 'an unknown scope'} — it ` +
          `turns off env validation INCLUDING OPS-1's database guard. The fix for a failing build ` +
          `is to correct that scope's DATABASE_URL, never to skip validation.`,
      );
    }
  }

  // 3. Each estate must actually have its own value, not merely "not share one".
  for (const key of REQUIRED_PER_SCOPE) {
    const scopes = new Set(
      records
        .filter((r) => r.key === key)
        .flatMap((r) => (Array.isArray(r.target) ? r.target : [])),
    );
    const missing = [PRODUCTION, PREVIEW].filter((scope) => !scopes.has(scope));
    if (missing.length === 0) {
      pass(`${key} exists per scope`, 'production + preview');
    } else {
      fail(`${key} exists per scope`, `missing from: ${missing.join(', ')}`);
    }
  }

  // Informational: KEY NAMES ONLY, never a value. Do not paste this into a public PR — the
  // pass/fail verdict is the shareable part, the key inventory is not (docs/runbooks.md -> OPS-1).
  const inventory = new Map();
  for (const r of records) {
    for (const scope of r.target ?? []) {
      if (!inventory.has(scope)) inventory.set(scope, []);
      inventory.get(scope).push(r.key);
    }
  }
  for (const [scope, keys] of [...inventory].sort()) {
    console.log(`    ${scope}: ${keys.sort().join(', ')}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const snapshotIdx = argv.indexOf('--snapshot');
const data = snapshotIdx >= 0 ? readSnapshot(argv[snapshotIdx + 1] ?? '-') : await fetchVercel();

checkProjectFlag(
  data.project,
  'gitForkProtection',
  'fork-PR protection',
  "a pull request from a FORK can then run its own build with the Preview scope's environment: a " +
    'hostile postinstall or next.config.ts exfiltrates the preview database string and the preview ' +
    'gate code in one request.',
);
checkProjectFlag(
  data.project,
  'autoExposeSystemEnvs',
  'system environment variables exposed',
  "VERCEL_ENV does not exist without it, and that is the input apps/web/lib/env.ts's guard reads. " +
    'The guard still fails closed on a non-local database, so builds break rather than leak — but ' +
    'they break for a reason the error message has to guess at.',
);
checkEnv(data.env);

for (const { status, label, detail } of results) {
  const mark = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '?';
  console.log(`${mark} ${label}: ${detail}`);
}

const failed = results.filter((r) => r.status === 'fail');
const unverified = results.filter((r) => r.status === 'unknown');

if (failed.length > 0) {
  die(
    BROKEN,
    `${failed.length} isolation check(s) FAILED. The Preview scope is not isolated from ` +
      `production — see docs/runbooks.md -> OPS-1.`,
  );
}
if (unverified.length > 0) {
  die(
    CANNOT_CHECK,
    `${unverified.length} check(s) could not be verified, so isolation is NOT confirmed.`,
  );
}
console.log(
  'check-preview-isolation: Preview is isolated from production (structure only — this cannot see ' +
    'values, historical deployments, or which Neon project a string points at).',
);
process.exit(OK);
