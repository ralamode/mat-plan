import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOGGABLE_DIMENSIONS } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import {
  APP_HOME_PATH,
  blockedSummary,
  missingQuantityMessage,
  PARTIAL_SETS_COPY,
  PICKER_EMPTY_COPY,
  SUMMARY_NAME_MAX,
  QUANTITY_FIELD_WORD,
  quantityInputLabel,
  usuallyLoggedAs,
} from './constants';

describe('blockedSummary — the summary names the first blocker (V1-27)', () => {
  it('a set: "<name> set N needs finishing."', () => {
    expect(blockedSummary({ kind: 'set', index: 0, setIndex: 1, movementName: 'Back squat' })).toBe(
      'Back squat set 2 needs finishing.',
    );
  });
  it('an unnamed card falls back to its on-screen number', () => {
    expect(blockedSummary({ kind: 'set', index: 2, setIndex: 0, movementName: '  ' })).toBe(
      'Movement 3 set 1 needs finishing.',
    );
    expect(blockedSummary({ kind: 'name', index: 0 })).toBe('Movement 1 needs a name.');
  });
  it('a long name is truncated so the line fits one row at 360px', () => {
    const out = blockedSummary({
      kind: 'set',
      index: 0,
      setIndex: 19,
      movementName: 'Single-leg Romanian deadlift with pause',
    });
    expect(out.endsWith('… set 20 needs finishing.')).toBe(true);
    expect(out.indexOf('…')).toBeLessThanOrEqual(SUMMARY_NAME_MAX);
  });
});

describe('missingQuantityMessage', () => {
  it('a mass unit points at BW or band', () => {
    expect(missingQuantityMessage('lb')).toBe(PARTIAL_SETS_COPY.missingWeight);
    expect(missingQuantityMessage('kg')).toBe(PARTIAL_SETS_COPY.missingWeight);
  });
  it('a time or distance asks for the number and never mentions BW (V1-30 refuses it there)', () => {
    for (const unit of ['sec', 'min', 'm', 'yd', 'cm', 'in', 'ft'] as const) {
      const msg = missingQuantityMessage(unit);
      expect(msg).not.toMatch(/BW|band/);
      expect(msg).toMatch(/^Enter the .+\.$/);
    }
  });
});

/**
 * ONB-0 — the first-run control's only destination. `pnpm verify` has NO markdown link check
 * (`format:check · lint · typecheck · test · db:verify · skills:check · actions:check · guards:test ·
 * audit:check`), and `skills:check` only validates paths cited by `.claude/skills/` — so without this,
 * the anchor the picker's empty state links to is completely unguarded.
 */
describe('PICKER_EMPTY_COPY.setupAnchor', () => {
  it('points at a heading that really exists in README.md', () => {
    const readme = readFileSync(join(import.meta.dirname, '../../../README.md'), 'utf8');
    // GitHub slugifies "## Adding an athlete" to "#adding-an-athlete"; derive the heading from the
    // anchor rather than re-typing it, so the two cannot drift apart in a rename.
    const heading = PICKER_EMPTY_COPY.setupAnchor.slice(1).replace(/-/g, ' ');
    expect(readme.toLowerCase()).toContain(`## ${heading}`);
  });
});

describe('APP_HOME_PATH', () => {
  it('is the profile picker — a contract the proxy, the gate action and the specs share', () => {
    expect(APP_HOME_PATH).toBe('/p');
  });
});

/**
 * V1-30b-i — the form must offer only what the server keeps, and the number must read as what it is.
 */
describe('quantityInputLabel / QUANTITY_FIELD_WORD / usuallyLoggedAs (V1-30b)', () => {
  it('mass output is BYTE-IDENTICAL to V1-30, so every existing locator holds', () => {
    expect(quantityInputLabel('Movement 1 set 2', 'lb')).toBe('Movement 1 set 2 weight in lb');
    expect(quantityInputLabel('Movement 1 set 2', 'kg')).toBe('Movement 1 set 2 weight in kg');
    // No unit (the edit form before a primary resolves) keeps the bare noun.
    expect(quantityInputLabel('Movement 1 set 2')).toBe('Movement 1 set 2 weight');
  });

  it('non-mass spells the unit out, because `sec` and `in` read as nothing aloud', () => {
    expect(quantityInputLabel('Movement 1 set 1', 'sec')).toBe('Movement 1 set 1 time in seconds');
    expect(quantityInputLabel('Movement 1 set 1', 'in')).toBe('Movement 1 set 1 length in inches');
    expect(quantityInputLabel('Movement 1 set 1', 'm')).toBe('Movement 1 set 1 length in metres');
  });

  it('every loggable dimension has a field word — a new one without one must fail, not fall back', () => {
    for (const d of LOGGABLE_DIMENSIONS) {
      expect(QUANTITY_FIELD_WORD[d]).toBeTruthy();
    }
  });

  it('the field word fits the w-24 field: never longer than "weight"', () => {
    // The row is ~275 of ~294px at 360px, so a longer word overflows. `length`, not "height or
    // distance" — and not `distance`, which would mislabel a box jump, the main length movement.
    for (const d of LOGGABLE_DIMENSIONS) {
      expect(QUANTITY_FIELD_WORD[d]!.length).toBeLessThanOrEqual('weight'.length);
    }
  });

  it('usuallyLoggedAs keeps V1-26’s sentence verbatim for mass, and reads naturally otherwise', () => {
    expect(usuallyLoggedAs('Trap-Bar Deadlift', 'mass')).toBe(
      'Trap-Bar Deadlift is usually logged with a weight.',
    );
    expect(usuallyLoggedAs('Plank', 'time')).toBe('Plank is usually logged as a time.');
    expect(usuallyLoggedAs('Box Jump', 'length')).toBe(
      'Box Jump is usually logged as a height or distance.',
    );
  });
});
