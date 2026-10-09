#!/usr/bin/env node
// OPS-1 runbook step 7 — delete every PREVIEW deployment of the project. Production is never touched.
// Procedure: docs/runbooks.md -> OPS-1. Needs the same env as `pnpm preview:check`:
//
//   pnpm preview:purge          # dry run: lists what it would delete
//   pnpm preview:purge --yes    # deletes
//
// Exit: 0 done (or nothing to do) · 1 some deletions failed · 2 could not check (nothing was done).
//
// WHY A SCRIPT. Vercel's dashboard has no bulk delete, and a purge here was 440 deployments. The API
// rate-limits deletes (about 200, then `429 rate_limited "now-rm" … try again in 10 m`), so this waits
// out a 429 and retries the same request instead of failing it. Re-running picks up whatever is left,
// because it lists before it deletes. Like preview:check it is a local command, never a CI job: the
// token it needs can decrypt every production environment variable.

const OK = 0;
const SOME_FAILED = 1;
const CANNOT_CHECK = 2;
const API_BASE = 'https://api.vercel.com';
const DEFAULT_RATE_LIMIT_WAIT_MS = 10 * 60_000;

const { VERCEL_TOKEN: token, VERCEL_PROJECT_ID: projectId, VERCEL_TEAM_ID: teamId } = process.env;
const apply = process.argv.includes('--yes');

function die(code, message) {
  console.error(`purge-vercel-previews: ${message}`);
  process.exit(code);
}

if (!token || !projectId) {
  die(
    CANNOT_CHECK,
    'set VERCEL_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID for a team project), as for ' +
      '`pnpm preview:check` — see docs/runbooks.md -> OPS-1.',
  );
}

const team = teamId ? { teamId } : {};
const headers = { Authorization: `Bearer ${token}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, path, params) {
  const url = `${API_BASE}${path}?${new URLSearchParams({ ...params, ...team })}`;
  for (;;) {
    const res = await fetch(url, { method, headers });
    if (res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset')); // epoch seconds, when present
      const waitMs = reset
        ? Math.max(reset * 1000 - Date.now(), 0) + 5_000
        : DEFAULT_RATE_LIMIT_WAIT_MS;
      console.log(`  rate limited — waiting ${Math.ceil(waitMs / 60_000)} min, then continuing…`);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      let reason = '';
      try {
        const { error } = await res.json();
        if (error?.code || error?.message)
          reason = ` — ${error.code ?? ''}: ${error.message ?? ''}`;
      } catch {
        // Not JSON.
      }
      throw new Error(`${method} ${path} -> ${res.status}${reason}`);
    }
    return res.status === 204 ? {} : res.json();
  }
}

// Every preview deployment, newest first, following the `until` cursor.
const previews = [];
try {
  let until;
  for (;;) {
    const page = await call('GET', '/v6/deployments', {
      projectId,
      target: 'preview',
      limit: '100',
      ...(until ? { until: String(until) } : {}),
    });
    // Belt and braces: the API filter says preview, and production is never deleted regardless.
    previews.push(...page.deployments.filter((d) => d.target !== 'production'));
    until = page.pagination?.next;
    if (!until) break;
  }
} catch (err) {
  die(CANNOT_CHECK, `could not list deployments: ${err.message}. Nothing was deleted.`);
}

console.log(`${previews.length} preview deployment(s) found.`);
if (previews.length) {
  const when = (d) => new Date(d.created).toISOString().slice(0, 16);
  console.log(`  oldest ${when(previews.at(-1))}  newest ${when(previews[0])}`);
}
if (!apply) {
  console.log('Dry run — nothing deleted. Re-run with --yes to delete them.');
  process.exit(OK);
}

let deleted = 0;
let failed = 0;
for (const d of previews) {
  try {
    await call('DELETE', `/v13/deployments/${d.uid}`, {});
    deleted += 1;
  } catch (err) {
    failed += 1;
    console.error(`  failed ${d.uid}: ${err.message}`);
  }
  if ((deleted + failed) % 25 === 0) console.log(`  ${deleted + failed}/${previews.length}…`);
}
console.log(`Deleted ${deleted}, failed ${failed}.`);
process.exit(failed ? SOME_FAILED : OK);
