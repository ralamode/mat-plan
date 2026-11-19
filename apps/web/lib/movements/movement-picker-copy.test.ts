import { describe, expect, it } from 'vitest';

import { MOVEMENT_PICKER_COPY as COPY } from './movement-picker-copy';

// 🔴 Copy is tested for the SHAPES a person actually sees — the singular and the plural of every
// counted sentence, and the permanence warning's substance. A pluralisation that reads "1 matches"
// ships silently: the first draft of `statusSomeWords` did exactly that, with a ternary that looked
// like it handled the singular and collapsed to one string for every n.
describe('MOVEMENT_PICKER_COPY — the counted sentences', () => {
  // ⚠️ The terminal period is part of panel 2 · 2's `{count}. {reason}` shape — without it a screen
  // reader runs the count into the reason as one clause. Asserted as literals here, once.
  it.each([
    [1, '1 match.'],
    [2, '2 matches.'],
    [35, '35 matches.'],
  ])('statusCount(%i)', (n, expected) => {
    expect(COPY.statusCount(n)).toBe(expected);
  });

  // The accepted prototype's wording (spec P5 as amended, 2026-11-17): the near misses are
  // "close spellings" in the count, under the heading "Did you mean"; the some-words rows are
  // "N with some of your words". The two lists join with a comma into one sentence.
  it('statusSomeWords counts the rows with some of your words', () => {
    expect(COPY.statusSomeWords(1)).toBe('1 with some of your words');
    expect(COPY.statusSomeWords(3)).toBe('3 with some of your words');
  });

  it('statusNear counts close spellings, both ways', () => {
    expect(COPY.statusNear(1)).toBe('1 close spelling');
    expect(COPY.statusNear(2)).toBe('2 close spellings');
  });

  it('statusNone says "No matches." once, then each list, close spellings first', () => {
    expect(COPY.statusNone(0, 0)).toBe('No matches.');
    expect(COPY.statusNone(1, 0)).toBe('No matches. 1 close spelling.');
    expect(COPY.statusNone(0, 2)).toBe('No matches. 2 with some of your words.');
    expect(COPY.statusNone(1, 2)).toBe('No matches. 1 close spelling, 2 with some of your words.');
  });

  it('asTypedHintNear names the movement and what to do, then keeps the permanence warning', () => {
    expect(COPY.asTypedHintNear('Bulgarian Split Squat', 'bulgarain')).toBe(
      `"Bulgarian Split Squat" is above. Tap it if that's the one. ${COPY.asTypedHint('bulgarain')}`,
    );
  });

  it('saveCreates names every movement, conjugates both ways, and joins the list properly', () => {
    // The names are the point: "1 new movement" without them is not a spelling check (UX3 3).
    expect(COPY.saveCreates(['pullups'])).toBe(
      'Saving adds 1 new movement: "pullups". Check the spelling.',
    );
    // ⚠️ "and", not a bare comma — `.join(', ')` was the first draft and is wrong English for two
    // items as well as being a localization bug. `Intl.ListFormat` gets both right.
    expect(COPY.saveCreates(['pullups', 'dips'])).toBe(
      'Saving adds 2 new movements: "pullups" and "dips". Check the spelling.',
    );
    // …and the serial comma appears from three, which no hand-rolled join would have produced.
    expect(COPY.saveCreates(['pullups', 'dips', 'rows'])).toBe(
      'Saving adds 3 new movements: "pullups", "dips", and "rows". Check the spelling.',
    );
  });
});

describe('the permanence warning', () => {
  it('names the movement, says who sees it, and says it cannot be deleted', () => {
    const hint = COPY.asTypedHint('pullups');
    expect(hint).toContain('"pullups"');
    expect(hint).toContain('everyone in your household');
    expect(hint).toContain("can't be deleted");
  });

  it('🔴 does NOT promise a rename — MOV-1 is what makes that true, and edits this string', () => {
    // Telling someone a recovery exists when it does not is worse than saying nothing. This holds
    // the line until C4r, and is the assertion MOV-1 has to change deliberately.
    for (const text of [COPY.asTypedHint('x'), COPY.cardCreatedHint]) {
      expect(text.toLowerCase()).not.toContain('rename');
      expect(text.toLowerCase()).not.toContain('later');
    }
  });

  it('the card hint also says it cannot be deleted', () => {
    expect(COPY.cardCreatedHint).toContain("can't be deleted");
  });
});

describe('the status region', () => {
  it('🔴 is EMPTY for an empty query — the Announcer must mount silent', () => {
    // Not a preference: `Announcer`'s rule 1 is that a region mounting WITH its text is silent, and
    // the sheet mounts it and resets the query in one commit. A count here would be the first thing
    // to violate U0's own "mounted before any text" test.
    expect(COPY.statusEmpty).toBe('');
  });

  it('names the row that withholds "use as typed"', () => {
    expect(COPY.statusAlreadyListed('Pull-Up')).toBe('Already in the list as Pull-Up.');
  });
});

describe('the row tags', () => {
  it('reads as a person would say it', () => {
    expect(COPY.tagAlreadyIn('Strength A')).toBe('already in Strength A');
    expect(COPY.tagAlsoCalled('RDL')).toBe('also called RDL');
  });
});

describe('the browse tree (CAT-3 B3)', () => {
  it('names its sections, and a heading carries its count with the one separator', () => {
    expect(COPY.allMovements).toBe('All movements');
    expect(COPY.notSorted).toBe('Not sorted yet');
    expect(COPY.separator).toBe(' · ');
    expect(COPY.foldedCount(COPY.allMovements, 35)).toBe('All movements · 35');
    expect(COPY.choiceName(COPY.allMovements, 1)).toBe('All movements, 1 movement');
    expect(COPY.choiceName(COPY.allMovements, 12)).toBe('All movements, 12 movements');
  });
});

describe('the filters (CAT-3 B2-ii) — every counted sentence, both ways', () => {
  it('the control and its name say how many are on', () => {
    expect(COPY.filters(0)).toBe('Filters');
    expect(COPY.filters(3)).toBe('Filters · 3');
    expect(COPY.filtersName(0)).toBe('Filters, none on');
    expect(COPY.filtersName(2)).toBe('Filters, 2 on');
  });

  it('a choice is named "label, count"', () => {
    expect(COPY.choiceName('Lats', 1)).toBe('Lats, 1 movement');
    expect(COPY.choiceName('Lats', 12)).toBe('Lats, 12 movements');
  });

  it('the panel counts movements when browsing and results under a query, in one noun', () => {
    expect(COPY.showResults(1, false)).toBe('Show 1 movement');
    expect(COPY.showResults(12, false)).toBe('Show 12 movements');
    expect(COPY.showResults(1, true)).toBe('Show 1 result');
    expect(COPY.showResults(3, true)).toBe('Show 3 results');
    expect(COPY.panelCount(1, false)).toBe('1 movement.');
    expect(COPY.panelCount(3, true)).toBe('3 results.');
  });

  it('each change is said once, without a doubled stop after an ellipsis', () => {
    expect(COPY.panelStatus('Lats', true, 2, false)).toBe('Lats on. 2 movements.');
    expect(COPY.panelStatus('Lats', false, 1, true)).toBe('Lats off. 1 result.');
    expect(COPY.panelStatusChoice('No equipment', 1, false)).toBe('No equipment. 1 movement.');
    expect(COPY.panelStatusChoice('Uses at least one of…', 120, false)).toBe(
      'Uses at least one of… 120 movements.',
    );
    expect(COPY.panelStatusChoice(COPY.filtersCleared, 5, false)).toBe(
      'Filters cleared. 5 movements.',
    );
  });

  it('the list lines', () => {
    expect(COPY.filtersOnLine(1)).toBe('1 filter on.');
    expect(COPY.filtersOnLine(2)).toBe('2 filters on.');
    expect(COPY.statusFiltersKept(1)).toBe('1 filter still on.');
    expect(COPY.statusFiltersKept(2)).toBe('2 filters still on.');
    expect(COPY.outsideMore(1)).toBe('1 more is not in your filters.');
    expect(COPY.outsideMore(3)).toBe('3 more are not in your filters.');
    expect(COPY.outsideAll(1, 'chin')).toBe('1 movement for "chin" is not in your filters.');
    expect(COPY.outsideAll(4, 'chin')).toBe('4 movements for "chin" are not in your filters.');
    expect(COPY.statusOutsideOnly(4)).toBe('Nothing in your filters. 4 outside them.');
  });

  it("the custom section keeps the maintainer's words and adds to them (P9)", () => {
    expect(COPY.household).toBe('Your custom items');
    expect(COPY.householdNotFiltered).toBe('Your custom items (not filtered)');
    expect(COPY.foldedCount(COPY.householdNotFiltered, 2)).toBe(
      'Your custom items (not filtered) · 2',
    );
  });

  it('a hidden near miss is said to be hidden, with what to do, never "listed"', () => {
    expect(COPY.similarOutside('Goblet squat')).toBe(
      '"Goblet squat" already exists, but your filters hide it. Clear filters to see it.',
    );
    expect(COPY.asTypedHintOutside('Goblet squat', 'gobet')).toBe(
      `${COPY.similarOutside('Goblet squat')} ${COPY.asTypedHint('gobet')}`,
    );
    expect(COPY.statusAlreadyListedOutside('Push-Ups')).toBe(
      'Already in the list as Push-Ups, which is not in your filters.',
    );
  });
});

describe('the line after the results: rows no filter can judge are never "not in your filters" (⏳ until chunk R)', () => {
  it('only judged rows hidden: the B2-ii sentences, unchanged', () => {
    expect(COPY.outsideLine(2, 0, 'squat', true)).toBe(COPY.outsideMore(2));
    expect(COPY.outsideLine(2, 0, 'squat', false)).toBe(COPY.outsideAll(2, 'squat'));
  });

  it('only bare rows hidden, some results shown: says they are hidden and why, one and many', () => {
    expect(COPY.outsideLine(1, 1, 'squat', true)).toBe(
      'Your filters hide 1 more: its equipment and muscles aren’t known yet.',
    );
    expect(COPY.outsideLine(3, 3, 'squat', true)).toBe(
      'Your filters hide 3 more: their equipment and muscles aren’t known yet.',
    );
  });

  it('only bare rows, nothing shown: names the query', () => {
    expect(COPY.outsideLine(1, 1, 'squat', false)).toBe(
      'Your filters hide 1 movement for "squat": its equipment and muscles aren’t known yet.',
    );
    expect(COPY.outsideLine(2, 2, 'squat', false)).toBe(
      'Your filters hide 2 movements for "squat": their equipment and muscles aren’t known yet.',
    );
  });

  it('both: the judged sentence first, then the bare one with "also"', () => {
    expect(COPY.outsideLine(3, 1, 'squat', true)).toBe(
      `${COPY.outsideMore(2)} Your filters also hide 1 more: its equipment and muscles aren’t known yet.`,
    );
    expect(COPY.outsideLine(5, 2, 'squat', false)).toBe(
      `${COPY.outsideAll(3, 'squat')} Your filters also hide 2 more: their equipment and muscles aren’t known yet.`,
    );
  });

  it('never starts with "No equipment" (a library row\'s equipment words)', () => {
    for (const line of [COPY.outsideLine(1, 1, 'q', true), COPY.outsideLine(1, 1, 'q', false)]) {
      expect(line.startsWith(COPY.emptyEquipment)).toBe(false);
    }
  });
});
