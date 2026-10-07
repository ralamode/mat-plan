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
 *   node .github/scripts/check-audit.mjs [--report <file>|-]   # --report is for the self-test only
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

const args = process.argv.slice(2);
const reportIdx = args.indexOf('--report');
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

const blocking = advisories.filter((a) => BLOCKING.has(a.severity));
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

console.log(`Production audit OK — ${line}`);
