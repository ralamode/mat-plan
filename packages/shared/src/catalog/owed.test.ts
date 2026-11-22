import { describe, it } from 'vitest';

/**
 * CAT-3: the tests the contract's consumers still owe
 * ([spec](../../../../docs/specs/cat-3-movement-library.md) → Acceptance). Each line is a
 * criterion no test holds yet. The chunk that writes the proof tells the contract owner, who
 * deletes its line: this file is the contract's, and a lane never edits a contract file. A lane's
 * own proofs live in the lane's directory, and this list only says they are owed
 * ([program-contract](../../../../docs/features/program-contract.md) invariant 9's pattern).
 *
 * Not listed, because no test can hold them: D1 beyond the schema's strictness (nothing names a
 * source), D4 (no batch names a household or a person), R1, R2 and R5 (the runbook, the dry runs
 * and the maintainer's go). Those are held by review: a batch PR merges only when every row of its
 * review tab carries the maintainer's `lgtm` (spec K21).
 */

// Chunk A1 (the tables, #577) holds S2 to S5 and the proven part of S1:
// `packages/db/scripts/verify/catalog.ts`, and `verify/erasure.ts` for the delete order. S6 (no
// module in `apps/` reads the tables or `movements.modality`) ended with P11-ii-b (#767), the first
// read of them on a request path: its scan in `apps/web/test/program-tables-stay-dark.test.ts` is
// retired, and that read's `db:verify` proofs hold the tables instead (spec S6). What A1 leaves owed:
describe('owed by lane A: what the tables chunk (A1) left', () => {
  it.todo('S1: equipment and muscles hold a code and no label, and sit among REFERENCE_TABLES');
});

describe('owed by lane A: the seed (chunk A2, then A3)', () => {
  it.todo('E1: one catalog row per entry, with its join rows, in one transaction');
  it.todo("E2: a global row already on an entry's slug is left alone and counted");
  it.todo("E3: the seed never deletes a movement and never writes a household's row");
  it.todo('E4: a fixtures database holds CATALOG_FIXTURE in place of CATALOG_MOVEMENTS');
  it.todo("E5: the seed's report holds counts only for any row a household owns");
  it.todo('E6: after the fresh start, a changed entry changes its stored row and nothing else');
});

describe('owed by lane B and lane P: filters and browse (after chunk C0b-2; B2, B3, 6a-iii)', () => {
  // The contract's half of P1 and P7 to P10 and P12 is held in `filters.test.ts` and
  // `option.test.ts`: the rule, the result's lists and the browse tree. What is owed is the screen.
  it.todo('P7: the panel greys a choice that counts zero, and filters stay on within a workout');
  it.todo('P8: a hit outside the filters is shown first and says "not in your filters"');
  it.todo(
    'P9: "Your custom items (not filtered)" after the filtered matches; folded when browsing',
  );
  it.todo('P10: "N more are not in your filters" with Clear filters; never the whole list');
  it.todo('P11: the option read returns taxonomy from the tables and aliases from the const');
  it.todo('P12: two folding sections; kinds and families closed until opened; the old groups gone');
  // B2-i (`movement-picker.test.tsx`, #569) holds part of P13 (the label as text, the same in both
  // modes, never dropped for a tag) and P16's screen half. What P13 still owes is listed here;
  // P16's read by slug is proved by lane B's route, DAL and loader tests (FAM-1 7b, #624).
  it.todo('P13: a supervision label never hides, blocks or reorders an option or a row');
  it.todo('P13: the label’s wording names no age, level, "ready", "safe" or warning mark');
  it.todo(
    'P13: only the option read, the picker row, the day read and the day row read supervision',
  );
  it.todo('P13: the day page’s workout row shows the supervision label (after C32)');
});

describe('owed by lane B: the picker (chunks B1 to B3)', () => {
  // P14 is held in full by B2-i (`movement-picker.test.tsx`, "the row: … (P14)", #569).
  it.todo("P15: the picker's new states pass the accessibility scan at the narrow width");
});

describe('owed by the fresh start (chunks RC to R2) and the last chunk (F1)', () => {
  it.todo('R3: the delete of global movements refuses while any row still references one');
  it.todo('R4: the count-only report after the fresh start shows no seed-namespace id');
  it.todo('F1: nothing in packages/ or apps/ imports the legacy seed lists (an import scan)');
});
