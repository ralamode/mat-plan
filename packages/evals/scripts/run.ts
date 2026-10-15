#!/usr/bin/env tsx
/**
 * The CI entry point. Everything it does is IO: assemble the registered cases, run them, print, and
 * exit with the code the harness decided. The decision itself lives in `src/harness.ts`, which is
 * pure and asserted directly in vitest — so this file holds no logic worth testing through a
 * subprocess.
 */
import { accuracyCases } from '../src/cases/accuracy';
import { invariantCases } from '../src/cases/invariants';
import { nlInputFixtures } from '../src/fixtures/nl-inputs';
import { runEval } from '../src/harness';

const report = runEval([...invariantCases, ...accuracyCases], nlInputFixtures);

for (const line of report.lines) console.log(line);

process.exit(report.exitCode);
