'use client';

import type { ProgramList, ProgramView } from '@mat-plan/shared';
import {
  DAY_PLAN_FIXTURE_SOURCES,
  DAY_PLAN_FIXTURES,
  PROGRAM_LIST_FIXTURES,
  PROGRAM_VIEW_FIXTURES,
  programsList,
  familyProgram,
  WORKOUT_DRAFT_FIXTURES,
} from '@mat-plan/shared/program/fixtures';
import { useState, type ReactNode } from 'react';

import { AthleteSwitcher } from '@/components/day/athlete-switcher';
import { DayScreen } from '@/components/day/day-screen';
import { NotOnAProgram } from '@/components/day/not-on-a-program';
import { ProgramLine } from '@/components/day/program-line';
import { ProgramScreen } from '@/components/program-builder/program-screen';
import { ProgramsListScreen } from '@/components/program-builder/programs-list-screen';
import { WorkoutEditorScreen } from '@/components/program-builder/workout-editor-screen';
import { NAME_WRAP_CLASS, NOTICE_CLASS, SETTINGS_COPY } from '@/lib/constants';

import {
  createFakeDayActions,
  createFakeProgramActions,
  type FakeProgramState,
  type FakePrograms,
} from './fakes';
import { pickerOptions } from './picker-options';
import { dayPreviewHrefFor, type PreviewSelection } from './preview-registry';

/**
 * Mounts one screen with one named fixture and the fakes, exactly as a real route mounts it with
 * the DAL's data and the real actions (FAM-1 plan §6, "One mount point per page").
 *
 * A client component because the fakes are plain functions, which a Server Component cannot hand
 * to a screen. The fixture is looked up here, by name, for the same reason: only the names cross
 * from the server.
 *
 * **The data is state.** A fake changes its copy of the fixture and hands it back; this passes it
 * to the screen again as props. That is the preview's stand-in for the re-render a real action
 * causes, so a screen needs no code that exists only for the preview.
 */
export function PreviewHarness({ screen, fixture, failNext }: PreviewSelection) {
  switch (screen) {
    case 'programs-list':
      return (
        <ProgramsPreview
          seed={{ ...BUILDER, programs: [...named(PROGRAM_LIST_FIXTURES, fixture)], program: null }}
          failNext={failNext}
        >
          {(state, actions) => <ProgramsListScreen programs={state.programs} actions={actions} />}
        </ProgramsPreview>
      );
    case 'program': {
      const program = named(PROGRAM_VIEW_FIXTURES, fixture);
      return (
        <ProgramsPreview
          seed={{ ...BUILDER, programs: householdOf(program), program }}
          failNext={failNext}
        >
          {(state, actions) =>
            state.program && <ProgramScreen program={state.program} actions={actions} />
          }
        </ProgramsPreview>
      );
    }
    case 'workout-editor':
      // Both draft fixtures are workouts of the Family program, so that is the program on screen,
      // and the one the editor is told it belongs to (`program`).
      return (
        <ProgramsPreview seed={{ ...BUILDER, program: familyProgram }} failNext={failNext}>
          {(state, actions) => {
            const draft = named(WORKOUT_DRAFT_FIXTURES, fixture);
            return (
              <WorkoutEditorScreen
                draft={draft}
                picker={{ options: state.items }}
                actions={actions}
                // The draft's own program, as the real page loads it (7b): the back link names it
                // and the editor says who a change applies to. Read from the fake's list, so a
                // rename made on the preview shows here too.
                program={programOf(state.programs, draft.programPublicId)}
              />
            );
          }}
        </ProgramsPreview>
      );
    case 'day':
      return <DayPreview selection={{ screen, fixture, failNext }} />;
  }
}

/** The entry of the Programs list a draft belongs to. Every draft fixture's program is listed. */
function programOf(programs: ProgramList, programPublicId: string): ProgramList[number] {
  const program = programs.find((listed) => listed.programPublicId === programPublicId);
  if (!program) throw new Error(`program preview: no listed program ${programPublicId}`);
  return program;
}

/** The fixture of that name. The route's parser has already checked the name is one of them. */
function named<T>(fixtures: Record<string, T>, name: string): T {
  const fixture = fixtures[name];
  if (fixture === undefined) throw new Error(`program preview: no fixture named ${name}`);
  return fixture;
}

/** What every builder screen's fake starts from: the prototype's Programs list and its catalog. */
const BUILDER: FakeProgramState = {
  programs: [...programsList],
  program: null,
  items: [...pickerOptions],
};

/** The Programs list a program's page belongs to: the fixture household's, plus a new program. */
function householdOf(program: ProgramView): ProgramList {
  const { programPublicId, name } = program;
  if (programsList.some((listed) => listed.programPublicId === programPublicId)) {
    return [...programsList];
  }
  return [
    ...programsList,
    { programPublicId, name, athletes: program.athletes.map((a) => a.name) },
  ];
}

function ProgramsPreview({
  seed,
  failNext,
  children,
}: {
  seed: FakeProgramState;
  failNext: boolean;
  children: (state: FakeProgramState, actions: FakePrograms['actions']) => ReactNode;
}) {
  const [state, setState] = useState(seed);
  const [fake] = useState(() => {
    const made = createFakeProgramActions(seed, setState);
    if (failNext) made.failNext();
    return made;
  });
  return children(state, fake.actions);
}

/**
 * The day page, as far as the plan's lanes build it: the page's `<h1>`, then the three parts the
 * page places itself (FAM-1 plan D34), then the day screen. The order is the page's
 * (`docs/features/day-page.md` invariant 1); on the real page Bodyweight and Life, which are another
 * lane's, sit between the parts and the screen.
 *
 * All four get the SAME `plan`, and the two that write get the same `actions`, so a reorder made in
 * `ProgramLine` shows in `DayScreen` as it will in production.
 */
function DayPreview({ selection }: { selection: PreviewSelection }) {
  const { fixture, failNext } = selection;
  const [plan, setPlan] = useState(() => named(DAY_PLAN_FIXTURES, fixture));
  const [fake] = useState(() => {
    const made = createFakeDayActions(plan, setPlan);
    if (failNext) made.failNext();
    return made;
  });
  // The page's heading is the profile's name, which the page has from the profile and not from
  // the plan: `plan.athletes` is the switcher's list, and an archived athlete is not in it. So the
  // name comes from the world the fixture was built from.
  const { world, athlete: athleteId } = named(DAY_PLAN_FIXTURE_SOURCES, fixture);
  const athlete = world.athletes.find((a) => a.id === athleteId);
  if (!athlete) throw new Error(`program preview: ${fixture}'s world does not hold its athlete`);
  return (
    <>
      {/* The day page's own heading: on the real page it is the page's, not the screen's. */}
      <h1 className={`text-3xl font-semibold tracking-tight ${NAME_WRAP_CLASS}`}>{athlete.name}</h1>
      {/* No `lg:hidden` here, unlike the page: the preview has no nav rail to list the athletes. */}
      <AthleteSwitcher plan={plan} hrefFor={dayPreviewHrefFor(selection)} />
      {/* The page's archived notice (PROF-1 b), which the real page shows from the profile: it is
          why an archived athlete's day needs no line of its own from the day screen, and no
          `archived` field on the plan (maintainer, 2026-11-17: "One merged notice"). Shown here from
          the fixture's world, in the page's own words, so the state reads as it will. On the real
          page "Household settings" is a link; the preview names it and links nowhere. */}
      {athlete.archived ? (
        <p className={`${NOTICE_CLASS} ${NAME_WRAP_CLASS}`}>
          {SETTINGS_COPY.archivedNotice(athlete.name)} {SETTINGS_COPY.heading}.
        </p>
      ) : null}
      <ProgramLine plan={plan} actions={fake.actions} />
      {/* No `programsHref`: the Programs page does not exist until step 7b. */}
      <NotOnAProgram plan={plan} />
      <DayScreen plan={plan} actions={fake.actions} />
    </>
  );
}
