// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PROFILE_KIND_LABELS, PROGRAM_NAME_MAX } from '@mat-plan/shared';

import { PROGRAM_COPY } from '@/components/day/day-copy';
import {
  lastDayText,
  NO_PROGRAM_YET_LINE,
  startsText,
} from '@/components/program-builder/builder-text';
import { athletePath, NAME_WRAP_CLASS } from '@/lib/constants';
import type { AthleteProgramDTO } from '@/lib/dal/program/reads';
import type { ProfileDTO } from '@/lib/dal/profiles';

import { ProfileTile, programsLine } from './profile-tile';

// COMPONENT TIER (RTL/jsdom — the first component test in the suite; see
// vitest.config.ts). ProfileTile is a pure sync Server Component (just renders a
// next/link), so RTL renders it directly. Asserts the pivotal contract: the tile
// is a semantic anchor pointing at the profile's scoped Today (`/p/<publicId>`),
// and surfaces the name + kind.
// RTL cleanup UNMOUNTS the React tree (cancels next/link's pending scheduler work);
// merely clearing innerHTML leaves it pending → it flushes after jsdom is torn down
// and throws `window is not defined`. Since vitest globals are off, register it here.
afterEach(cleanup);

const athleteOne: ProfileDTO = {
  id: '019826b4-0000-7000-8000-000000000001',
  name: 'Athlete One',
  kind: 'kid',
  avatar: null,
};

const TODAY = '2026-11-19';
const program = (
  n: number,
  activeFrom = '2026-11-02',
  activeTo: string | null = null,
): AthleteProgramDTO => ({
  programPublicId: `019826b4-0000-7000-8000-0000000000a${n}`,
  name: `Program ${n}`,
  activeFrom,
  activeTo,
});

describe('ProfileTile', () => {
  it('links to the profile-scoped Today at /p/<publicId>', () => {
    render(<ProfileTile profile={athleteOne} today={TODAY} />);
    const link = screen.getByRole('link', { name: /Athlete One/ });
    expect(link).toHaveProperty('tagName', 'A');
    expect(link.getAttribute('href')).toBe(athletePath(athleteOne.id));
  });

  /**
   * 🔴 **The LABEL, not the stored value.** This asserted `getByText('kid')` while the tile rendered
   * `capitalize {profile.kind}` — so the screen read "Kid", the schema's word shown to a parent, and
   * the test agreed with it. Criterion 9: Child / Adult, from the one display map beside
   * `PROFILE_KINDS`, with `kid` / `adult` still stored.
   */
  it('renders the name, and the kind as its display LABEL', () => {
    render(<ProfileTile profile={athleteOne} today={TODAY} />);
    expect(screen.getByText('Athlete One')).toBeTruthy();
    expect(screen.getByText(PROFILE_KIND_LABELS.kid)).toBeTruthy();
    // The stored value must not reach the screen at all.
    expect(screen.queryByText('kid')).toBeNull();
  });

  it('labels an adult as Adult', () => {
    render(<ProfileTile profile={{ ...athleteOne, kind: 'adult' }} today={TODAY} />);
    expect(screen.getByText(PROFILE_KIND_LABELS.adult)).toBeTruthy();
    expect(screen.queryByText('adult')).toBeNull();
  });

  /**
   * D11, the renderer the decision is really about. The name sits in a column that is itself a
   * row-flex item beside a `shrink-0` avatar, so BOTH need `min-w-0` or a 40-character unbroken name
   * pushes the tile past a 360px phone's 328px. Asserted as classes because the wrap is CSS: jsdom
   * computes no layout, and the measured version lives in `e2e/a11y.spec.ts`.
   */
  it('gives the name the shared wrap rule, and its column a min-width floor of 0', () => {
    render(<ProfileTile profile={athleteOne} today={TODAY} />);
    const name = screen.getByText('Athlete One');
    for (const cls of NAME_WRAP_CLASS.split(' ')) expect(name.className).toContain(cls);
    expect(name.parentElement?.className).toContain('min-w-0');
  });

  it('falls back to the name initial when there is no avatar', () => {
    render(<ProfileTile profile={athleteOne} today={TODAY} />);
    // The avatar bubble is aria-hidden; assert the initial is present in the DOM.
    expect(screen.getByText('A')).toBeTruthy(); // 'Athlete One' → 'A'
  });
});

/**
 * FAM-1 15 PR 3: the line under the name and kind names the athlete's programs, in their order, in
 * the day page's words. The expectations are spelled out, so a line that drops a program, reorders
 * them or loses the start day fails here, not only in a helper compared with itself.
 */
describe('ProfileTile: the programs line (FAM-1 15 PR 3)', () => {
  const tile = (programs: readonly AthleteProgramDTO[] | undefined) =>
    render(<ProfileTile profile={athleteOne} programs={programs} today={TODAY} />);

  it('one program: "Program: {name}"', () => {
    tile([program(1)]);
    expect(screen.getByText('Program: Program 1')).toBeTruthy();
    expect(programsLine([program(1)], TODAY)).toBe(PROGRAM_COPY.line(['Program 1']));
  });

  it('several: every program, in the athlete’s own order, none dropped', () => {
    tile([program(2), program(1), program(3)]);
    expect(screen.getByText('Programs: Program 2, Program 1, Program 3')).toBeTruthy();
  });

  it('none: "No program yet", the Put-on dialog’s words capitalised', () => {
    tile([]);
    expect(screen.getByText('No program yet')).toBeTruthy();
    expect(NO_PROGRAM_YET_LINE).toBe('No program yet');
  });

  it('a program that begins after today says when; one that began today does not', () => {
    tile([program(1, TODAY), program(2, '2026-11-20')]);
    // No-break spaces inside the date, so a wrap never splits "Fri, Nov 20".
    expect(programsLine([program(1, TODAY), program(2, '2026-11-20')], TODAY)).toBe(
      'Programs: Program 1, Program 2 (starts Fri,\u00a0Nov\u00a020)',
    );
    expect(screen.getByText('Programs: Program 1, Program 2 (starts Fri, Nov 20)')).toBeTruthy();
    expect(startsText('2026-11-20')).toBe('starts Fri,\u00a0Nov\u00a020');
  });

  it('a program taken off today says "last day today", as the program page does', () => {
    tile([program(1, '2026-11-02', TODAY), program(2)]);
    expect(screen.getByText('Programs: Program 1 (last day today), Program 2')).toBeTruthy();
    expect(lastDayText(TODAY, TODAY)).toBe('last day today');
  });

  it('the line is muted, like the kind label above it', () => {
    tile([program(1)]);
    expect(screen.getByText('Program: Program 1').className).toContain('text-muted-foreground');
  });

  it('no entry (an athlete gone between Home’s reads) shows no line and claims nothing', () => {
    tile(undefined);
    expect(screen.queryByText(/program/i)).toBeNull();
    expect(screen.getByRole('link').getAttribute('aria-describedby')).toBeNull();
  });

  it('the link is named by the name and kind only, and described by the programs line', () => {
    tile([program(1), program(2)]);
    expect(
      screen.getByRole('link', {
        name: 'Athlete One Child',
        description: 'Programs: Program 1, Program 2',
      }),
    ).toBeTruthy();
  });

  /**
   * An unbroken `PROGRAM_NAME_MAX` name must wrap inside the column, never widen the tile at
   * 360px: the line carries the shared wrap rule inside the `min-w-0` column, and is never cut
   * short (no `truncate`, the whole name is in the text). Classes, because jsdom has no layout.
   */
  it('an unbroken 60-character name wraps and is never truncated', () => {
    const long = 'W'.repeat(PROGRAM_NAME_MAX);
    tile([{ ...program(1), name: long }]);
    const line = screen.getByText(`Program: ${long}`);
    for (const cls of NAME_WRAP_CLASS.split(' ')) expect(line.className).toContain(cls);
    expect(line.className).not.toMatch(/truncate|line-clamp|text-ellipsis/);
    expect(line.parentElement?.className).toContain('min-w-0');
  });
});
