#!/usr/bin/env node
/**
 * Production-audit guard (SEC-5). The rule and why: .github/SECURITY.md → "Supply chain". Plan:
 * docs/plans/sec-5-verify-in-ci.md.
 *
 * Runs `pnpm audit --prod --json --audit-level info` and fails on any high or critical advisory in
 * the PRODUCTION tree. The dev tree cannot pass at `high` today (braces@3.0.3's patched version was
 * never published), so gating it would wedge main with no edit that unwedges it.
 *
 * `--audit-level info` is passed DELIBERATELY and is load-bearing twice. (1) `auditLevel` is also a
 * project setting, and `addSettingsFromWorkspaceManifestToConfig` copies every camelCase key out of
 * pnpm-workspace.yaml with no whitelist, so without the flag one committed line (`auditLevel:
 * critical`) empties the advisory list while leaving metadata's counts intact — measured: three live
 * advisories reported as none, exit 0. A CLI flag beats the config file. (2) pnpm's level filter
 * applies to the advisory LIST and not to `metadata`, so at any higher level the coherence check
 * below would fail on every run.
 *
 * Could-not-check is split into TWO codes on purpose, because ci.yml treats them opposite ways and
 * only one of them may ever be advisory:
 *   2 = RETRYABLE. The registry was unreachable. A registry outage must not be a merge outage.
 *   3 = NOT RETRYABLE. Unparseable or incoherent report, no lockfile, unrecognised failure. Never
 *       downgraded, because "the gate looks wired but checks nothing" is the bug SEC-5 exists to end.
 * Collapsing these is how the first draft of this guard shipped a permanent-green bypass; mapping a
 * real outage onto 3 is how its first fix made the lenient branch dead code. Both are in the plan's
 * review-response log.
 *
 * Parse failure lands on 3, which is also what catches `ignore:`, `ignoreUnfixable:` and `fix:` —
 * each makes pnpm print prose instead of JSON. Enumerating hostile config keys is unwinnable; these
 * rules catch the class by shape.
 *
 * Usage:
 *   node .github/scripts/check-audit.mjs [--report <file>|- [--exceptions <file>] [--today YYYY-MM-DD]]
 *   (all three flags are for the self-test only; SEC-5c's exception list is .github/audit-exceptions.json)
 * Exit: 0 clean · 1 a high/critical advisory · 2 could not check, retryable · 3 could not check, not
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** pnpm's isKnownSeverity vocabulary. Defined once; every rule below reads it. */
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const BLOCKING = new Set(['high', 'critical']);
/** Longer than pnpm's own retry budget (fetchRetries x fetchRetryMaxtimeout), or the likeliest
 *  outage shape is a signal kill with empty stdout rather than an error envelope. */
const TIMEOUT_MS = 180_000;
const RETRYABLE_MESSAGE = /fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket hang up/i;
const RETRYABLE_CODES = new Set(['ERR_PNPM_AUDIT_BAD_RESPONSE']);

const die = (code, msg) => {
  console.error(`check-audit: ${msg}`);
  process.exit(code);
};

/** SEC-5c. The committed exception list; a missing file means none. */
const EXCEPTIONS_FILE = '.github/audit-exceptions.json';
const EXCEPTION_KEYS = ['ghsa', 'module', 'severity', 'paths', 'reason', 'added', 'expires'];
const MAX_EXCEPTION_DAYS = 30;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
/** pnpm's finding path: package names joined by `>` (workspaces as `apps__web`), no whitespace. */
const AUDIT_PATH = /^[^\s>]+(>[^\s>]+)*$/;
const EXPIRY_WARN_DAYS = 7;
/** A real calendar date: `2026-02-30` round-trips to `2026-03-02`, so it is refused. */
const isIsoDate = (d) =>
  typeof d === 'string' &&
  ISO_DATE.test(d) &&
  new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
const dayDiff = (from, to) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5;

/** Parse and validate the list. Anything malformed is "could not check" (3), never a pass. */
function loadExceptions(file, today) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    die(3, `cannot read ${file}: ${e.message}`);
  }
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    die(3, `${file} is not valid JSON`);
  }
  if (!Array.isArray(list)) die(3, `${file} must be a JSON array`);
  const seen = new Set();
  for (const [i, e] of list.entries()) {
    const at = `${file}[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) die(3, `${at} is not an object`);
    const keys = Object.keys(e).sort().join(',');
    if (keys !== [...EXCEPTION_KEYS].sort().join(',')) {
      die(3, `${at} must have exactly [${EXCEPTION_KEYS.join(', ')}]; has [${keys}]`);
    }
    if (!/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/.test(e.ghsa))
      die(3, `${at}.ghsa is not a GHSA id`);
    // Both reach `::error::` lines, so they are held to their real shapes: no newline can smuggle a
    // workflow command (`::stop-commands::`) out of a PR-controlled file.
    if (typeof e.module !== 'string' || !NPM_NAME.test(e.module)) {
      die(3, `${at}.module is not a package name`);
    }
    if (e.severity !== 'high')
      die(3, `${at}.severity must be "high"; critical is never exceptable`);
    if (
      !Array.isArray(e.paths) ||
      !e.paths.length ||
      !e.paths.every((p) => typeof p === 'string' && AUDIT_PATH.test(p))
    ) {
      die(3, `${at}.paths must list every reported path`);
    }
    if (typeof e.reason !== 'string' || e.reason.trim().length < 40) {
      die(3, `${at}.reason must explain the exposure (40+ characters)`);
    }
    for (const k of ['added', 'expires']) {
      if (!isIsoDate(e[k])) die(3, `${at}.${k} is not a real ISO date`);
    }
    // `added` may not be in the future: with the window below, an entry can never outlive today + 30.
    if (e.added > today) die(3, `${at}.added (${e.added}) is after today (${today})`);
    const days = dayDiff(e.added, e.expires);
    if (days < 0 || days > MAX_EXCEPTION_DAYS) {
      die(3, `${at} runs ${days} days; an exception lasts 0–${MAX_EXCEPTION_DAYS} days`);
    }
    if (seen.has(e.ghsa)) die(3, `${at} repeats ${e.ghsa}`);
    seen.add(e.ghsa);
  }
  return list;
}

const args = process.argv.slice(2);
const reportIdx = args.indexOf('--report');
// `--exceptions` and `--today` are honoured ONLY beside `--report` (the offline self-test): a real
// run always reads the committed file and the real UTC date, so neither can be turned off from env.
// Parsed and validated BEFORE pnpm is spawned, so a malformed list exits 3 even in a registry outage
// (where exit 2 would otherwise be made lenient by ci.yml).
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  if (reportIdx === -1) die(3, `${name} is a self-test flag and needs --report`);
  return args[i + 1] ?? die(3, `${name} needs a value`);
};
const today = flag('--today') ?? new Date().toISOString().slice(0, 10);
if (!isIsoDate(today)) die(3, `--today ${today} is not a real ISO date`);
const exceptions = loadExceptions(flag('--exceptions') ?? EXCEPTIONS_FILE, today);
let raw;

if (reportIdx !== -1) {
  const src = args[reportIdx + 1];
  if (!src) die(3, 'usage: check-audit.mjs [--report <file>|-]');
  try {
    raw = readFileSync(src === '-' ? 0 : src, 'utf8');
  } catch (e) {
    die(3, `cannot read ${src}: ${e.message}`);
  }
} else {
  // Do NOT read the exit code: `pnpm audit` exits non-zero whenever it finds anything, so non-zero
  // is the normal case. The verdict is stdout.
  try {
    raw = execFileSync('pnpm', ['audit', '--prod', '--json', '--audit-level', 'info'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: TIMEOUT_MS,
    });
  } catch (e) {
    raw = e.stdout ?? '';
  }
}

if (raw.trim() === '') {
  die(2, 'pnpm audit produced no output (killed or timed out) — retryable, not a verdict');
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  // `ignore:`, `ignoreUnfixable:` and `fix:` all land here: pnpm prints prose, not JSON.
  die(3, `pnpm audit did not return JSON. First 200 bytes:\n  ${raw.trim().slice(0, 200)}`);
}

// Classify pnpm's error envelope BEFORE the coherence rules: a real registry outage is valid JSON
// with no `metadata`, so a coherence-first guard reports it as not-retryable and reds every PR.
if (report?.error) {
  const { code = '(none)', message = '' } = report.error;
  const retryable = RETRYABLE_CODES.has(code) || RETRYABLE_MESSAGE.test(message);
  die(
    retryable ? 2 : 3,
    `pnpm audit failed (${code}): ${message}` +
      (retryable ? ' — retryable' : ' — not retryable, so this is not advisory'),
  );
}

const counts = report?.metadata?.vulnerabilities;
if (!counts || typeof counts !== 'object') {
  die(3, 'the report carries no severity counts, so it is not a verdict');
}

const keys = Object.keys(counts).sort().join(',');
if (keys !== [...SEVERITIES].sort().join(',')) {
  die(3, `unknown severity vocabulary [${keys}]; this guard knows [${SEVERITIES.join(',')}]`);
}
if (!SEVERITIES.every((s) => Number.isFinite(counts[s]))) {
  die(3, `severity counts are not all finite numbers: ${JSON.stringify(counts)}`);
}

const advisories = Object.values(report.advisories ?? {});
const bad = advisories.find((a) => !SEVERITIES.includes(a?.severity));
if (bad) die(3, `an advisory has severity "${bad.severity}", outside the known vocabulary`);

// EXACT equality, per severity. pnpm increments vulnerabilities[severity] once per ADVISORY, inside
// the per-advisory loop — paths never enter it (measured: 3 advisories / 5 paths, byte-identical).
// Zero-ness would pass a renamed bucket, since undefined + undefined > 0 is false on both sides.
const derived = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
for (const a of advisories) derived[a.severity] += 1;
const mismatch = SEVERITIES.filter((s) => counts[s] !== derived[s]);
if (mismatch.length) {
  die(
    3,
    `the report's own counts disagree with its advisory list on ${mismatch.join(', ')} — ` +
      `metadata ${JSON.stringify(counts)} vs list ${JSON.stringify(derived)}. ` +
      `An ignore/suppression setting produces exactly this shape; ` +
      `use neither — fix the advisory, reclassify the dependency, or merge red.`,
  );
}

const deps = report.metadata.dependencies;
if (!Number.isFinite(deps) || deps <= 0) {
  die(
    3,
    `the audit walked ${deps} production dependencies; a guard that checked nothing must not pass`,
  );
}

const line =
  `${deps} prod dep(s) (${report.metadata.devDependencies ?? '?'} dev, ` +
  `${report.metadata.totalDependencies ?? '?'} total) · ` +
  SEVERITIES.map((s) => `${s} ${counts[s]}`).join(' · ');

// ── SEC-5c: reasoned, expiring exceptions (docs/plans/sec-5c-advisory-exceptions.md) ──────────────
// The list was validated before pnpm ran; it is APPLIED only after every coherence rule above, so an
// exception can never make an incoherent report pass. An entry excepts ONE advisory, by id + module +
// severity, and only while the reported paths are exactly the ones it names. Expired, stale and
// out-of-date entries fail (1), printed beside any advisory that still blocks.

const idOf = (a) => a.github_advisory_id || String(a.id ?? '');
const pathsOf = (a) => {
  if (!Array.isArray(a.findings) || !a.findings.every((f) => Array.isArray(f?.paths))) {
    die(3, `${a.module_name} (${idOf(a)}) has findings in an unknown shape`);
  }
  return a.findings.flatMap((f) => f.paths);
};
const excepted = [];
const used = new Set();
const blockingAll = advisories.filter((a) => BLOCKING.has(a.severity));
const blocking = blockingAll.filter((a) => {
  const e = exceptions.find((x) => x.ghsa === idOf(a));
  if (!e || today > e.expires) return true;
  if (a.module_name !== e.module || a.severity !== e.severity) return true;
  const paths = pathsOf(a);
  // Every reported path must be named (an advisory with no findings is never excepted).
  if (paths.length === 0 || !paths.every((p) => e.paths.includes(p))) return true;
  excepted.push({ a, e, paths });
  used.add(e);
  return false;
});
const problems = [];
for (const e of exceptions) {
  if (today > e.expires)
    problems.push(`exception for ${e.ghsa} (${e.module}) expired on ${e.expires}`);
  else if (!used.has(e)) {
    problems.push(
      `exception for ${e.ghsa} (${e.module}) is stale: it excepted nothing in this report`,
    );
  }
}
for (const { a, e, paths } of excepted) {
  const gone = e.paths.filter((p) => !paths.includes(p));
  if (gone.length) {
    problems.push(`exception for ${e.ghsa} lists path(s) no longer reported: ${gone.join(', ')}`);
  }
  const left = dayDiff(today, e.expires);
  console.error(
    `::warning::check-audit: ${a.severity} ${a.module_name} (${idOf(a)}) is EXCEPTED through ${e.expires} UTC — ${EXCEPTIONS_FILE}` +
      (left <= EXPIRY_WARN_DAYS
        ? ` · EXPIRES IN ${left} DAY(S): fix, or renew in a reviewed PR`
        : ''),
  );
}
if (problems.length) {
  console.error(`check-audit: ${line}`);
  for (const p of problems) console.error(`✗ ${p}`);
  console.error(`::error::check-audit: ${problems.join('; ')} — edit ${EXCEPTIONS_FILE}`);
}

if (blocking.length) {
  const rows = blocking.map((a) => {
    // Identity by EMPTINESS, not nullishness: deriveGithubAdvisoryId returns "" when the url
    // carries no GHSA, so `??` would never fall through.
    const id = a.github_advisory_id || String(a.id ?? '(no id)');
    // `patched_versions` is INFERRED by pnpm from the vulnerable range and is undefined for ranges
    // it cannot parse, so it is context and never evidence that a fix exists.
    const patched = a.patched_versions ? `patched: ${a.patched_versions}` : 'patched: (not stated)';
    const via = a.findings?.[0]?.paths?.[0];
    return `${a.severity}  ${a.module_name}  ${id}  ${patched}${via ? `  via ${via}` : ''}`;
  });
  console.error(`check-audit: ${line}`);
  console.error(`✗ ${blocking.length} high/critical advisory(ies) in the production tree:`);
  for (const r of rows) console.error(`  ${r}`);
  console.error(
    `::error::check-audit: ${blocking.length} high/critical production advisory(ies): ${blocking.map((a) => `${a.module_name} (${a.github_advisory_id || a.id})`).join(', ')}`,
  );
  process.exit(1);
}
if (problems.length) process.exit(1);

console.log(`Production audit OK — ${line}`);
