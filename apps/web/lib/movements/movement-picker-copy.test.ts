import { describe, expect, it } from 'vitest';

import { MOVEMENT_PICKER_COPY as COPY } from './movement-picker-copy';

// 🔴 Copy is tested for the SHAPES a person actually sees — the singular and the plural of every
// counted sentence, and the permanence warning's substance. A pluralisation that reads "1 matches"
// ships silently: the first draft of `statusSomeWords` did exactly that, with a ternary that looked
// like it handled the singular and collapsed to one string for every n.
describe('MOVEMENT_PICKER_COPY — the counted sentences', () => {
  it.each([
    [1, '1 match'],
    [2, '2 matches'],
    [35, '35 matches'],
  ])('statusCount(%i)', (n, expected) => {
    expect(COPY.statusCount(n)).toBe(expected);
  });

  it('statusSomeWords uses "movement", and conjugates both ways', () => {
    expect(COPY.statusSomeWords(1)).toBe('No matches. 1 movement matches some of your words.');
    expect(COPY.statusSomeWords(3)).toBe('No matches. 3 movements match some of your words.');
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
    const hint = COPY.useAsTypedHint('pullups');
    expect(hint).toContain('"pullups"');
    expect(hint).toContain('everyone in your household');
    expect(hint).toContain("can't be deleted");
  });

  it('🔴 does NOT promise a rename — MOV-1 is what makes that true, and edits this string', () => {
    // Telling someone a recovery exists when it does not is worse than saying nothing. This holds
    // the line until C4r, and is the assertion MOV-1 has to change deliberately.
    for (const text of [COPY.useAsTypedHint('x'), COPY.cardCreatedHint]) {
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

  it('labels a group from the shared map rather than a second copy', () => {
    expect(COPY.groupLabel('legs')).toBe('Legs');
  });
});
