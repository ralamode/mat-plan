#!/usr/bin/env node
/**
 * Per-route client JavaScript budget (PERF-1 (b)). Plan: docs/plans/perf-1-bundle-size.md.
 * ⚠️ THIS HEADER IS THE ONE HOME for what is measured, the tolerance and the exit codes; AGENTS.md
 * and review-pr point here rather than restating them.
 *
 * WHAT IS MEASURED. Uncompressed bytes of client JavaScript, from a production Turbopack build:
 *   - one row per app route: the JS a first visit loads, summed over the route's chunk list in
 *     `.next/diagnostics/route-bundle-stats.json` (Next 16 dropped "First Load JS" from the printed
 *     build table; that file replaced it, and it is undocumented);
 *   - one `(all client chunks)` row: every `.next/static/chunks/**\/*.js` except the polyfills
 *     (`build-manifest.json` → `polyfillFiles`). It catches code only `dynamic()` loads, which is in no
 *     route's first load.
 * The guard sums the bytes ITSELF with `stat` and ignores Next's `firstLoadUncompressedJsBytes`, whose
 * writer silently skips missing files. From the stats file it takes only the routes and their chunk
 * lists, and it refuses the writer's two quiet omissions with a count check against
 * `server/app-paths-manifest.json` (its `/page` keys, minus `/_global-error/page`, which Next always
 * filters out, must equal the number of rows).
 *
 * WHAT IS NOT MEASURED. Core Web Vitals timings (LCP, INP, CLS: PERF-1 (a) and PERF-2), CSS, server
 * code and route handlers, and Clerk's scripts, which load from Clerk's CDN rather than
 * `.next/static`. Gzip is not measured either: uncompressed bytes track parse and compile cost, and an
 * exact comparison should not depend on a zlib version.
 *
 * THE BUDGET. Each row is compared with `.github/bundle-baseline.json`. A move of more than
 * TOLERANCE_BYTES (8 KiB uncompressed, absolute) EITHER WAY fails: a shrink fails too, because
 * unclaimed headroom would later hide growth of the same size. A row new to the build, or gone from
 * it, fails. The baseline's `next` stamp records which Next produced the numbers; a different
 * framework version is printed, never gated on (the tolerance governs framework growth like any
 * other).
 *
 * THE BASELINE IS PR-CONTROLLED, so on a PR (`BASE_SHA` set) it is also compared with the base's
 * copy: each changed route gets a `::warning::`, and a baseline the PR changed (or introduced) must
 * EQUAL this run's measurement within NOISE_BYTES, or the step fails. That stops padding a baseline
 * to make room (by more than NOISE_BYTES, a thirty-second of the budget). Two CI builds of one app
 * source differ by a few bytes (2–4 B on three rows, PERF-1's U1, 2026-11-19), so "equal" cannot be
 * exact. The
 * only way to update it is to paste the measured JSON from the step summary's <details> block.
 * On a push (`BASE_SHA` empty) the base comparison is skipped.
 *
 * Usage (CI only; there is no local script, and a local build's bytes differ from CI's):
 *   node .github/scripts/check-bundle-size.mjs [--next-dir apps/web/.next] [--summary <path>]
 *   env: BUILD_OUTCOME (steps.build.outcome), BASE_SHA (steps.base.outputs.sha), GITHUB_ACTIONS
 *   `--summary` defaults to $GITHUB_STEP_SUMMARY; the summary is also printed to stdout.
 * Exit: 0 pass, or not measured (`BUILD_OUTCOME=skipped`: a docs/tooling-only change) · 1 a row over
 * budget, new or gone, or a changed baseline that is not this run's measurement · 2 cannot measure
 * (a missing or misshapen input, a chunk outside .next/static, an unreadable base, a failed Build,
 * or any unexpected throw — never a pass).
 *
 * It READS JSON FROM `.next` ONLY and never imports or requires from it. Every value that came from
 * a file is escaped before it reaches an annotation or a table cell.
 */
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOLERANCE_BYTES = 8 * 1024;
/** How far a changed baseline may sit from this run's measurement: CI's build-to-build noise, with room. */
export const NOISE_BYTES = 256;
const ALL_CHUNKS_ROW = '(all client chunks)';
const BASELINE_FILE = '.github/bundle-baseline.json';
const STATS_KEYS = ['firstLoadChunkPaths', 'firstLoadUncompressedJsBytes', 'route'];
const BASELINE_KEYS = ['next', 'routes'];
const GLOBAL_ERROR_PAGE = '/_global-error/page';
const SKIP_NOTICE =
  '::notice::bundle size not measured (docs/tooling-only change (changed-scopes.mjs)); job still reports success.';

class CannotMeasure extends Error {}
const fail = (msg) => {
  throw new CannotMeasure(msg);
};

/** For any value that came from a file: annotations (`%`, CR, LF) and table cells (`|`). */
const esc = (s) =>
  String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/\|/g, '\\|');
/** A signed delta: `0`, bytes under 1 KiB (`+312 B`), else KiB to one place (`+8.0 KiB`). */
const kib = (bytes) => {
  if (bytes === 0) return '0';
  const sign = bytes > 0 ? '+' : '-';
  const abs = Math.abs(bytes);
  return abs < 1024 ? `${sign}${abs} B` : `${sign}${(abs / 1024).toFixed(1)} KiB`;
};
const commas = (n) => n.toLocaleString('en-US');

function readJson(file, label) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    fail(`cannot read ${label} (${file})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

const exactKeys = (obj, want, at) => {
  const keys = Object.keys(obj).sort().join(',');
  if (keys !== [...want].sort().join(',')) {
    fail(`${at} must have exactly [${want.join(', ')}]; has [${esc(keys)}]`);
  }
};

/** Steps 2–3: the routes and their chunk lists, after the shape and count checks. */
function readRoutes(nextDir) {
  const stats = readJson(
    join(nextDir, 'diagnostics/route-bundle-stats.json'),
    'route-bundle-stats.json',
  );
  if (!Array.isArray(stats) || stats.length === 0) {
    fail('route-bundle-stats.json has no routes (expected a non-empty array)');
  }
  const seen = new Set();
  stats.forEach((row, i) => {
    const at = `route-bundle-stats.json[${i}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`${at} is not an object`);
    exactKeys(row, STATS_KEYS, at);
    // A route starts with `/`: that keeps inherited names (`constructor`) out, and keeps a row from
    // overwriting the synthetic `(all client chunks)` one.
    if (typeof row.route !== 'string' || !row.route.startsWith('/')) {
      fail(`${at}.route must be a string that starts with /`);
    }
    const paths = row.firstLoadChunkPaths;
    if (!Array.isArray(paths) || !paths.length || !paths.every((p) => typeof p === 'string')) {
      fail(`${at}.firstLoadChunkPaths must be a non-empty string[]`);
    }
    if (seen.has(row.route)) fail(`${at} repeats the route ${esc(row.route)}`);
    seen.add(row.route);
  });
  const manifest = readJson(
    join(nextDir, 'server/app-paths-manifest.json'),
    'app-paths-manifest.json',
  );
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('app-paths-manifest.json is not an object');
  }
  const pages = Object.keys(manifest).filter((k) => k.endsWith('/page') && k !== GLOBAL_ERROR_PAGE);
  if (pages.length !== stats.length) {
    fail(
      `page count mismatch: app-paths-manifest.json lists ${pages.length} page(s) (not counting ${GLOBAL_ERROR_PAGE}) but route-bundle-stats.json has ${stats.length} row(s); Next skipped a route`,
    );
  }
  return stats;
}

/** Step 4: a file's size, after proving its real path stays under .next/static. */
function sizeOf(file, staticRoot, label) {
  let real;
  try {
    real = realpathSync(file);
  } catch {
    fail(`chunk file missing: ${esc(label)}`);
  }
  if (!real.startsWith(staticRoot + sep)) fail(`chunk path ${esc(label)} is outside .next/static`);
  return statSync(real).size;
}

function measure(nextDir) {
  const projectDir = dirname(nextDir);
  const staticDir = join(nextDir, 'static');
  let staticRoot;
  try {
    staticRoot = realpathSync(staticDir);
  } catch {
    fail(`no ${staticDir}`);
  }
  const routes = readRoutes(nextDir);
  const framework = readJson(join(nextDir, 'diagnostics/framework.json'), 'framework.json');
  if (typeof framework?.version !== 'string') fail('framework.json has no string version');
  const buildManifest = readJson(join(nextDir, 'build-manifest.json'), 'build-manifest.json');
  const polyfills = buildManifest?.polyfillFiles;
  if (!Array.isArray(polyfills) || !polyfills.every((p) => typeof p === 'string')) {
    fail('build-manifest.json has no polyfillFiles string[]');
  }

  const measured = {};
  for (const { route, firstLoadChunkPaths } of routes) {
    measured[route] = [...new Set(firstLoadChunkPaths)].reduce(
      (sum, p) => sum + sizeOf(resolve(projectDir, p), staticRoot, p),
      0,
    );
  }
  const skip = new Set(polyfills.map((p) => resolve(nextDir, p)));
  let all = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && !skip.has(p)) {
        all += sizeOf(p, staticRoot, relative(projectDir, p));
      }
    }
  };
  walk(join(staticDir, 'chunks'));
  measured[ALL_CHUNKS_ROW] = all;
  return { next: framework.version, routes: measured };
}

/** A baseline's `{ next, routes }`, validated. `label` names it in the message. */
function parseBaseline(text, label) {
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail(`${label} is not an object`);
  exactKeys(b, BASELINE_KEYS, label);
  if (typeof b.next !== 'string') fail(`${label}.next is not a string`);
  const r = b.routes;
  if (!r || typeof r !== 'object' || Array.isArray(r) || !Object.keys(r).length) {
    fail(`${label}.routes must be a non-empty object`);
  }
  for (const [k, v] of Object.entries(r)) {
    if (!Number.isSafeInteger(v) || v < 0) fail(`${label}.routes[${esc(k)}] is not a byte count`);
  }
  return b;
}

/** Step 5: the base's baseline, `null` when the base has none, `undefined` on a push. */
function readBaseBaseline(baseSha) {
  if (!baseSha) return undefined;
  const git = (args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let listed;
  try {
    git(['cat-file', '-e', `${baseSha}^{commit}`]);
    listed = git(['ls-tree', baseSha, '--', BASELINE_FILE]);
  } catch {
    fail(`cannot read the base commit ${esc(baseSha)}`);
  }
  if (!listed.trim()) return null;
  let text;
  try {
    text = git(['show', `${baseSha}:${BASELINE_FILE}`]);
  } catch {
    fail(`cannot read the base's ${BASELINE_FILE}`);
  }
  return parseBaseline(text, `the base's ${BASELINE_FILE}`);
}

const sortRoutes = (routes) =>
  Object.fromEntries(Object.entries(routes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function run({ nextDir, buildOutcome, baseSha, onCi }) {
  const errors = [];
  const warnings = [];
  const out = [];
  if (buildOutcome === 'skipped') {
    console.log(SKIP_NOTICE);
    return {
      code: 0,
      status: 'Bundle size: **not measured** (docs/tooling-only change; Build skipped).',
      out,
    };
  }
  if (buildOutcome === 'failure' || buildOutcome === 'cancelled') {
    fail(`the Build step's outcome is ${esc(buildOutcome)}; there is nothing to measure`);
  }
  if (onCi && !buildOutcome)
    fail('BUILD_OUTCOME is empty on CI; the step must pass steps.build.outcome');

  const after = measure(nextDir);
  const prBaseline = parseBaseline(
    (() => {
      try {
        return readFileSync(BASELINE_FILE, 'utf8');
      } catch {
        return fail(`baseline ${BASELINE_FILE} is missing`);
      }
    })(),
    `baseline ${BASELINE_FILE}`,
  );
  const base = readBaseBaseline(baseSha);
  const before = prBaseline.routes;

  // 5a–5b: a baseline the PR changed is reported, and must be this run's measurement.
  const changed = [];
  if (base !== undefined) {
    if (base === null) changed.push(`baseline introduced in this PR (${BASELINE_FILE})`);
    else {
      for (const route of Object.keys({ ...base.routes, ...before }).sort()) {
        const [was, now] = [base.routes[route], before[route]];
        if (was === now) continue;
        const how =
          was === undefined
            ? 'added'
            : now === undefined
              ? 'removed'
              : now > was
                ? `raised by ${kib(now - was)}`
                : `lowered by ${kib(now - was)}`;
        changed.push(`baseline for ${esc(route)} ${how} in this PR`);
      }
      if (base.next !== prBaseline.next) {
        changed.push(`baseline's next stamp changed: ${esc(base.next)} → ${esc(prBaseline.next)}`);
      }
    }
    for (const line of changed) warnings.push(`::warning::bundle: ${line}`);
    if (changed.length) {
      for (const [route, bytes] of Object.entries(before)) {
        if (
          Object.hasOwn(after.routes, route) &&
          Math.abs(after.routes[route] - bytes) > NOISE_BYTES
        ) {
          errors.push(
            `::error::bundle: baseline for ${esc(route)} is ${commas(bytes)} but this run measured ${commas(after.routes[route])}; a baseline changed in this PR must equal this run's measurement within ${NOISE_BYTES} B (paste the <details> block)`,
          );
        }
      }
      if (after.next !== prBaseline.next) {
        errors.push(
          `::error::bundle: baseline's next is ${esc(prBaseline.next)} but this build is ${esc(after.next)}; a baseline changed in this PR must equal this run's measurement`,
        );
      }
    }
  }

  // 6: compare each row with the PR's baseline.
  const rows = [];
  for (const [route, bytes] of Object.entries(after.routes)) {
    if (!Object.hasOwn(before, route)) {
      errors.push(
        `::error::bundle: ${esc(route)} is new (${commas(bytes)} B); add it to ${BASELINE_FILE}`,
      );
      continue;
    }
    const delta = bytes - before[route];
    rows.push({ route, before: before[route], after: bytes, delta });
    if (Math.abs(delta) > TOLERANCE_BYTES) {
      errors.push(
        `::error::bundle: ${esc(route)} ${kib(delta)} (${delta > 0 ? '+' : '-'}${commas(Math.abs(delta))} B; ${commas(before[route])} → ${commas(bytes)}); budget ±${(TOLERANCE_BYTES / 1024).toFixed(1)} KiB${delta < 0 ? '; re-baseline: headroom would hide later growth' : ''}`,
      );
    }
  }
  for (const route of Object.keys(before)) {
    if (!Object.hasOwn(after.routes, route)) {
      errors.push(
        `::error::bundle: ${esc(route)} is in ${BASELINE_FILE} but was not measured; remove it`,
      );
    }
  }

  // 7: the summary.
  if (prBaseline.next !== after.next) {
    out.push(
      `Next ${esc(prBaseline.next)} → ${esc(after.next)} (the baseline was measured on ${esc(prBaseline.next)}; framework growth counts against the same budget).`,
      '',
    );
  }
  const withBase = base !== undefined;
  out.push(
    `| route | before | after | delta |${withBase ? " vs main's baseline |" : ''}`,
    `| --- | --: | --: | --: |${withBase ? ' --: |' : ''}`,
  );
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.route < b.route ? -1 : 1));
  for (const r of rows) {
    const vsMain = !withBase
      ? ''
      : base?.routes[r.route] === undefined
        ? ' — |'
        : ` ${kib(r.after - base.routes[r.route])} |`;
    out.push(`| ${esc(r.route)} | ${r.before} | ${r.after} | ${kib(r.delta)} |${vsMain}`);
  }
  if (changed.length)
    out.push('', '### Baseline changed in this PR', '', ...changed.map((l) => `- ${l}`));
  const measuredJson = JSON.stringify(
    { next: after.next, routes: sortRoutes(after.routes) },
    null,
    2,
  );
  // Longer than any backtick run in the JSON, so a route name cannot close the fence.
  const longestRun = Math.max(0, ...(measuredJson.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  out.push(
    '',
    `<details><summary>Measured baseline: paste into ${BASELINE_FILE} to re-baseline</summary>`,
    '',
    `${fence}json`,
    measuredJson,
    fence,
    '',
    '</details>',
  );
  for (const l of [...warnings, ...errors]) console.log(l);
  const budget = `±${(TOLERANCE_BYTES / 1024).toFixed(1)} KiB`;
  const status = errors.length
    ? `Bundle size: **FAIL**, ${errors.length} problem(s) (budget ${budget}; see the errors; \`next analyze\` shows why a number moved).`
    : `Bundle size: **pass**, ${Object.keys(after.routes).length} row(s) within ${budget} of ${BASELINE_FILE} (Next ${esc(after.next)}).`;
  return { code: errors.length ? 1 : 0, status, out };
}

function main(argv) {
  const flag = (name, dflt) => {
    const i = argv.indexOf(name);
    if (i === -1) return dflt;
    return argv[i + 1] ?? fail(`${name} needs a value`);
  };
  let summaryFile = process.env.GITHUB_STEP_SUMMARY;
  let result;
  try {
    summaryFile = flag('--summary', summaryFile);
    result = run({
      nextDir: resolve(flag('--next-dir', 'apps/web/.next')),
      buildOutcome: process.env.BUILD_OUTCOME ?? '',
      baseSha: process.env.BASE_SHA ?? '',
      onCi: Boolean(process.env.GITHUB_ACTIONS),
    });
  } catch (e) {
    const why = e instanceof CannotMeasure ? e.message : `unexpected error: ${esc(e?.stack ?? e)}`;
    console.log(`::error::bundle: cannot measure: ${why}`);
    result = { code: 2, status: `Bundle size: **could not measure**: ${why}`, out: [] };
  }
  const summary =
    ['## Bundle size (PERF-1)', '', result.status, '', ...result.out].join('\n') + '\n';
  console.log(summary);
  try {
    if (summaryFile) appendFileSync(summaryFile, summary);
  } catch (e) {
    console.log(`::error::bundle: cannot write the step summary: ${esc(e?.message ?? e)}`);
    return 2;
  }
  return result.code;
}

// Run when executed, not when imported (changed-scopes.mjs's realpath comparison).
if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main(process.argv.slice(2)));
}
