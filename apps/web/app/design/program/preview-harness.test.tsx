// @vitest-environment jsdom
import { PROGRAM_REFUSAL } from '@mat-plan/shared';
import {
  DAY_PLAN_FIXTURE_SOURCES,
  DAY_PLAN_FIXTURES,
  PROGRAM_LIST_FIXTURES,
  PROGRAM_VIEW_FIXTURES,
  todayStretchingFirst,
  WORKOUT_DRAFT_FIXTURES,
} from '@mat-plan/shared/program/fixtures';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * What the HARNESS owns, and nothing a screen owns: which screen it mounts, the props it hands
 * over, and that a fake's change comes back as new props.
 *
 * 🔴 **The four screens are mocked with probes on purpose.** They are lane B's and lane C's files,
 * and their output changes with every screen step. A test here that read a screen's text would go
 * red each time a lane filled a stub in, and this file is the contract owner's: the lane would have
 * to edit it, and owe its guide. What a screen renders is tested beside the screen.
 */
type Mounted = { screen: string; props: Record<string, unknown>; prefetch?: boolean };
const { mounted, probe } = vi.hoisted(() => {
  const mounted = { calls: [] as Mounted[] };
  // Hoisted with the mocks below, which run before any other line of this file.
  const probe = (name: string) => (props: Record<string, unknown>) => {
    mounted.calls.push({ screen: name, props });
    return null;
  };
  return { mounted, probe };
});
/**
 * A builder screen's probe also records what `BuilderLinkPrefetch` says where the screen is
 * mounted: that is what each of its links would read.
 */
async function builderProbe(name: string) {
  const { use } = await import('react');
  const { BuilderLinkPrefetch } = await import('@/components/program-builder/route-link');
  return (props: Record<string, unknown>) => {
    mounted.calls.push({ screen: name, props, prefetch: use(BuilderLinkPrefetch) });
    return null;
  };
}
vi.mock('@/components/program-builder/programs-list-screen', async () => ({
  ProgramsListScreen: await builderProbe('programs-list'),
}));
vi.mock('@/components/program-builder/program-screen', async () => ({
  ProgramScreen: await builderProbe('program'),
}));
vi.mock('@/components/program-builder/workout-editor-screen', async () => ({
  WorkoutEditorScreen: await builderProbe('workout-editor'),
}));
vi.mock('@/components/day/day-screen', () => ({ DayScreen: probe('day') }));
// The three parts the day page places itself (plan D34), which the day case mounts around the screen.
vi.mock('@/components/day/athlete-switcher', () => ({
  AthleteSwitcher: probe('athlete-switcher'),
}));
vi.mock('@/components/day/program-line', () => ({ ProgramLine: probe('program-line') }));
vi.mock('@/components/day/not-on-a-program', () => ({ NotOnAProgram: probe('not-on-a-program') }));

import { pickerOptions, previewHowTo } from './picker-options';
import { SETTINGS_COPY } from '@/lib/constants';

import { PreviewHarness, previewHouseholdOf } from './preview-harness';
import {
  parsePreview,
  PREVIEW_SCREEN_NAMES,
  PREVIEW_SCREENS,
  previewEntries,
  previewHref,
  previewLabel,
  type PreviewSelection,
} from './preview-registry';

afterEach(() => {
  cleanup();
  mounted.calls.length = 0;
});

type Action = (input: unknown) => Promise<{ ok: boolean; reason?: string }>;

/** The day page's three page-placed parts, in the order the page has them. */
const DAY_PARTS = ['athlete-switcher', 'program-line', 'not-on-a-program'] as const;
const isPart = (name: string) => (DAY_PARTS as readonly string[]).includes(name);

/** The props of the latest render of one mounted component: the screen, unless a part is named. */
function latest(of?: (typeof DAY_PARTS)[number]): Mounted & { actions: Record<string, Action> } {
  const last = mounted.calls.findLast((call) => (of ? call.screen === of : !isPart(call.screen)));
  if (!last) throw new Error('the harness mounted no screen');
  return { ...last, actions: last.props.actions as Record<string, Action> };
}

/** The data props each screen must be handed for a fixture, read from the contract's own lists. */
function expectedData({ screen: name, fixture }: PreviewSelection): Record<string, unknown> {
  const of = <T,>(fixtures: Record<string, T>) => fixtures[fixture];
  switch (name) {
    case 'programs-list':
      return { programs: of(PROGRAM_LIST_FIXTURES) };
    case 'program':
      return { program: of(PROGRAM_VIEW_FIXTURES) };
    case 'workout-editor':
      return {
        draft: of(WORKOUT_DRAFT_FIXTURES),
        picker: { options: pickerOptions },
        // The preview's "How to" read, so a library row's steps open on the preview (P16).
        howTo: previewHowTo,
        // The Programs list's entry for the draft's own program, never another's.
        program: PROGRAM_LIST_FIXTURES['programs-list'].find(
          (listed) => listed.programPublicId === of(WORKOUT_DRAFT_FIXTURES)?.programPublicId,
        ),
      };
    case 'day':
      return { plan: of(DAY_PLAN_FIXTURES) };
  }
}

/** Every member of each actions object, the optional ones included: the fakes supply them all. */
const MEMBERS = {
  program: [
    'createProgram',
    'renameProgram',
    'saveWorkout',
    'saveWeek',
    'copyWorkout',
    'newItem',
    'putOn',
    'takeOff',
  ],
  day: ['logRow', 'untickRow', 'retickRow', 'amendRow', 'reorderPrograms'],
} as const;

describe('the preview harness', () => {
  it.each(previewEntries().map((entry) => [previewLabel(entry), entry] as const))(
    '%s: mounts its screen with the named fixture and a full actions object',
    async (_label, entry) => {
      render(<PreviewHarness {...entry} />);

      const { screen: name, props, actions } = latest();
      expect(new Set(mounted.calls.map((call) => call.screen))).toEqual(
        new Set(entry.screen === 'day' ? ['day', ...DAY_PARTS] : [entry.screen]),
      );
      expect(name).toBe(entry.screen);
      const data = Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'actions'));
      expect(data).toEqual(expectedData(entry));

      expect(Object.keys(actions).sort()).toEqual(
        [...MEMBERS[entry.screen === 'day' ? 'day' : 'program']].sort(),
      );
      expect(Object.values(actions).every((member) => typeof member === 'function')).toBe(true);

      // `fail=next` reaches the fake: the first call fails only when it was asked to.
      const [first] = Object.values(actions);
      const result = await first!({});
      expect(result.reason === PROGRAM_REFUSAL.retry).toBe(entry.failNext);
    },
  );

  it.each(PREVIEW_SCREEN_NAMES.filter((name) => name !== 'day'))(
    '%s: its links do not prefetch, since a fixture id is no real page',
    (name) => {
      const [fixture] = PREVIEW_SCREENS[name].fixtures;
      render(<PreviewHarness screen={name} fixture={fixture!} failNext={false} />);
      const builder = mounted.calls.filter((call) => call.screen === name);
      expect(builder.length).toBeGreaterThan(0);
      expect(builder.map((call) => call.prefetch)).toEqual(builder.map(() => false));
    },
  );

  it.each(PREVIEW_SCREEN_NAMES)(
    '%s: the switch fails one call, then the fake answers',
    async (name) => {
      const [fixture] = PREVIEW_SCREENS[name].fixtures;
      render(<PreviewHarness screen={name} fixture={fixture!} failNext />);
      const [first] = Object.values(latest().actions);
      expect(await first!({})).toEqual({ ok: false, reason: PROGRAM_REFUSAL.retry });
      expect((await first!({})).reason).not.toBe(PROGRAM_REFUSAL.retry);
    },
  );

  it('a fake’s change comes back to the day screen as new props', async () => {
    render(<PreviewHarness screen="day" fixture="today-two-programs" failNext={false} />);
    const before = latest();
    const plan = before.props.plan as (typeof DAY_PLAN_FIXTURES)['today-two-programs'];
    await act(async () => {
      await before.actions.reorderPrograms!({
        profilePublicId: plan.profilePublicId,
        programPublicIds: plan.currentPrograms.map((p) => p.programPublicId).reverse(),
      });
    });
    expect(latest().props.plan).toEqual(todayStretchingFirst);
    // The same fake, so the screen's next call acts on what it now shows.
    expect(latest().actions.reorderPrograms).toBe(before.actions.reorderPrograms);
  });

  it('a fake’s change comes back to a builder screen as new props', async () => {
    render(<PreviewHarness screen="programs-list" fixture="programs-list" failNext={false} />);
    const before = latest();
    await act(async () => {
      await before.actions.createProgram!({
        clientId: '00000000-0000-7000-8000-00000000abcd',
        name: 'Off season',
      });
    });
    const programs = latest().props.programs as Array<{ name: string }>;
    expect(programs.map((p) => p.name)).toEqual([
      ...PROGRAM_LIST_FIXTURES['programs-list'].map((p) => p.name),
      'Off season',
    ]);
  });

  it.each(Object.keys(DAY_PLAN_FIXTURES))(
    'day · %s: the three page-placed parts get the screen’s plan and actions, in the page’s order',
    (fixture) => {
      render(<PreviewHarness screen="day" fixture={fixture} failNext={false} />);
      const day = latest();

      // The same objects, not equal copies: a reorder made in the line must reach the screen.
      for (const part of DAY_PARTS) expect(latest(part).props.plan).toBe(day.props.plan);
      expect(latest('program-line').props.actions).toBe(day.props.actions);

      // Nothing the page adds for its own layout. The notice gets the page's two props since
      // 15 PR 2: the plan, and the Programs link (its value is the next test's). The line gets the
      // page's third since 15c PR 3: where a program's name goes (its value is two tests down).
      expect(Object.keys(latest('athlete-switcher').props).sort()).toEqual(['hrefFor', 'plan']);
      expect(Object.keys(latest('program-line').props).sort()).toEqual([
        'actions',
        'plan',
        'programHrefFor',
      ]);
      expect(Object.keys(latest('not-on-a-program').props).sort()).toEqual([
        'plan',
        'programsHref',
      ]);

      // Top to bottom: the switcher, the line, the notice, then the screen.
      // First occurrences, so a double render (StrictMode) cannot make a wrong order look right.
      const firstSeen = [...new Set(mounted.calls.map((call) => call.screen))];
      expect(firstSeen).toEqual([...DAY_PARTS, 'day']);
    },
  );

  it.each(Object.keys(DAY_PLAN_FIXTURES))(
    'day · %s: every athlete’s switcher link is a state this route lists',
    (fixture) => {
      const current: PreviewSelection = { screen: 'day', fixture, failNext: false };
      render(<PreviewHarness {...current} />);
      const hrefFor = latest('athlete-switcher').props.hrefFor as (id: string) => string;
      const plan = DAY_PLAN_FIXTURES[fixture as keyof typeof DAY_PLAN_FIXTURES];

      for (const athlete of plan.athletes) {
        const href = hrefFor(athlete.profilePublicId);
        const selection = parsePreview(Object.fromEntries(new URL(href, 'http://x').searchParams));
        // An allowlisted state, or it would have parsed to the index.
        expect(selection?.screen).toBe('day');
        const target = DAY_PLAN_FIXTURES[selection!.fixture as keyof typeof DAY_PLAN_FIXTURES];
        // That athlete's day when the fixtures hold one; otherwise the link stays where it is.
        if (target.profilePublicId !== athlete.profilePublicId) {
          expect(href).toBe(previewHref(current));
          expect(
            Object.values(DAY_PLAN_FIXTURES).some(
              (other) => other.profilePublicId === athlete.profilePublicId,
            ),
          ).toBe(false);
        }
      }
      // An id the route never listed gets no new URL either.
      expect(hrefFor('not-an-athlete')).toBe(previewHref(current));
    },
  );

  it('heads an archived athlete’s day with their name, though the switcher’s list leaves them out', () => {
    // The page has the name from the profile. `plan.athletes` is the switcher's list, and an
    // archived athlete is not in it (C18), so the harness reads the name from the fixture's world.
    const plan = DAY_PLAN_FIXTURES['archived-athlete-today'];
    expect(plan.athletes.some((a) => a.profilePublicId === plan.profilePublicId)).toBe(false);
    render(<PreviewHarness screen="day" fixture="archived-athlete-today" failNext={false} />);
    const own = DAY_PLAN_FIXTURES['today-two-programs'].athletes.find(
      (a) => a.profilePublicId === plan.profilePublicId,
    );
    expect(own?.name).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(own?.name);
  });

  it('shows the page’s archived notice on an archived athlete’s day, and on no other', () => {
    // The real page says it from the profile, so the day screen has no line of its own and the
    // plan no `archived` field. The preview shows the same words from the fixture's world, so the
    // world's flag decides, whichever fixtures have one.
    const archived: string[] = [];
    for (const fixture of Object.keys(DAY_PLAN_FIXTURES) as (keyof typeof DAY_PLAN_FIXTURES)[]) {
      const { world, athlete: id } = DAY_PLAN_FIXTURE_SOURCES[fixture];
      const athlete = world.athletes.find((a) => a.id === id)!;
      render(<PreviewHarness screen="day" fixture={fixture} failNext={false} />);
      if (athlete.archived) {
        archived.push(fixture);
        const notice = `${SETTINGS_COPY.archivedNotice(athlete.name)} ${SETTINGS_COPY.heading}.`;
        expect(notice).toContain('is archived');
        expect(screen.getByText(notice), fixture).toBeTruthy();
      } else {
        expect(screen.queryByText(/is archived/), fixture).toBeNull();
      }
      cleanup();
    }
    expect(archived).toEqual(['archived-athlete-today', 'archived-athlete-nothing-logged']);
  });

  it('🔴 passes the line the preview’s own link for a program’s name, as the page passes its own', async () => {
    const { programPreviewHref } = await import('./preview-registry');
    for (const fixture of Object.keys(DAY_PLAN_FIXTURES)) {
      render(<PreviewHarness screen="day" fixture={fixture} failNext={false} />);
      expect(latest('program-line').props.programHrefFor, fixture).toBe(programPreviewHref);
      cleanup();
    }
  });

  it('🔴 passes the Programs link as the page does: by the page’s own rule, to the preview’s list', async () => {
    const { offersProgramsLink } = await import('@/components/day/day-notices');
    const { previewHref } = await import('./preview-registry');
    const href = previewHref({
      screen: 'programs-list',
      fixture: 'programs-list',
      failNext: false,
    });
    const linked: string[] = [];
    const unlinked: string[] = [];
    for (const fixture of Object.keys(DAY_PLAN_FIXTURES) as (keyof typeof DAY_PLAN_FIXTURES)[]) {
      const { world, athlete: id } = DAY_PLAN_FIXTURE_SOURCES[fixture];
      const athlete = world.athletes.find((a) => a.id === id)!;
      render(<PreviewHarness screen="day" fixture={fixture} failNext={false} />);
      const offered = offersProgramsLink({ archived: athlete.archived === true });
      expect(latest('not-on-a-program').props.programsHref, fixture).toBe(
        offered ? href : undefined,
      );
      (offered ? linked : unlinked).push(fixture);
      cleanup();
    }
    // Both arms are real fixtures: a live athlete gets the link, an archived one never does.
    expect(linked).toContain('no-program');
    expect(unlinked).toEqual(expect.arrayContaining(['archived-athlete-today']));
  });

  it('the day preview supplies the page’s <h1>, which on the real page is not the screen’s', () => {
    render(<PreviewHarness screen="day" fixture="no-program" failNext={false} />);
    const plan = DAY_PLAN_FIXTURES['no-program'];
    const athlete = plan.athletes.find((a) => a.profilePublicId === plan.profilePublicId);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(athlete?.name);
    cleanup();

    // A builder screen is the page: it renders its own <h1>, so the harness adds none.
    render(<PreviewHarness screen="program" fixture="family-program" failNext={false} />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});

describe('the Programs list beside a program page on the preview (C36)', () => {
  it('is the list built from the same world as the page, so the two agree about an archived athlete', () => {
    const page = PROGRAM_VIEW_FIXTURES['family-program-archived-athlete'];
    const list = previewHouseholdOf('family-program-archived-athlete', page);
    expect(list).toEqual(PROGRAM_LIST_FIXTURES['programs-list-archived-athlete']);
    const onThePage = page.athletes.map((a) => a.name);
    const entry = list.find((p) => p.programPublicId === page.programPublicId)!;
    expect(entry.athletes).toEqual(onThePage);
  });

  it('is the seeded household for a page from the seeded world, plus the page’s program when it is new', () => {
    const seeded = PROGRAM_LIST_FIXTURES['programs-list'];
    expect(previewHouseholdOf('family-program', PROGRAM_VIEW_FIXTURES['family-program'])).toEqual(
      seeded,
    );
    const fresh = PROGRAM_VIEW_FIXTURES['new-program-empty'];
    expect(previewHouseholdOf('new-program-empty', fresh)).toEqual([
      ...seeded,
      { programPublicId: fresh.programPublicId, name: fresh.name, athletes: [] },
    ]);
    // A copy of the list each time: a fake may change what it is handed.
    expect(previewHouseholdOf('family-program', PROGRAM_VIEW_FIXTURES['family-program'])).not.toBe(
      seeded,
    );
  });
});
