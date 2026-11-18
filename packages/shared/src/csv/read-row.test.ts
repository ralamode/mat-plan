import { describe, expect, it } from 'vitest';

import { readCsvLine } from './read-row';
import { csvRow } from './row';

/** `readCsvLine` reads back exactly what `csvRow` writes (FAM-1 14a), including its quoted cells. */
describe('readCsvLine', () => {
  const roundTrip = (cells: string[]) =>
    readCsvLine(
      csvRow(
        cells,
        cells.map((_, i) => `c${i}`),
      ).replace(/\n$/, ''),
    );

  it.each([
    [['Heavy, "A"', 'plain', '']],
    [['"felt off', 'Heavy A']],
    [['Athlete A at 30" box (Athlete B did 36")']],
    [['a', '', 'b,c', '"']],
  ])('round-trips %j', (cells) => {
    expect(roundTrip(cells)).toEqual(cells);
  });
});
