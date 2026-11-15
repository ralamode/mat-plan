'use client';

import type { ProgramList, ProgramView } from '@mat-plan/shared';
import {
  DAY_PLAN_FIXTURES,
  PROGRAM_LIST_FIXTURES,
  PROGRAM_VIEW_FIXTURES,
  programsList,
  familyProgram,
  WORKOUT_DRAFT_FIXTURES,
} from '@mat-plan/shared/program/fixtures';
import { useState, type ReactNode } from 'react';

import { DayScreen } from '@/components/day/day-screen';
import { ProgramScreen } from '@/components/program-builder/program-screen';
import { ProgramsListScreen } from '@/components/program-builder/programs-list-screen';
import { WorkoutEditorScreen } from '@/components/program-builder/workout-editor-screen';
import { NAME_WRAP_CLASS } from '@/lib/constants';

import {
  createFakeDayActions,
  createFakeProgramActions,
  type FakeProgramState,
  type FakePrograms,
} from './fakes';
import { pickerOptions } from './picker-options';
import type { PreviewSelection } from './preview-registry';

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
      // Both draft fixtures are workouts of the Family program, so that is the program on screen.
      return (
        <ProgramsPreview seed={{ ...BUILDER, program: familyProgram }} failNext={failNext}>
          {(state, actions) => (
            <WorkoutEditorScreen
              draft={named(WORKOUT_DRAFT_FIXTURES, fixture)}
              picker={{ options: state.items }}
              actions={actions}
            />
          )}
        </ProgramsPreview>
      );
    case 'day':
      return <DayPreview fixture={fixture} failNext={failNext} />;
  }
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

function DayPreview({ fixture, failNext }: { fixture: string; failNext: boolean }) {
  const [plan, setPlan] = useState(() => named(DAY_PLAN_FIXTURES, fixture));
  const [fake] = useState(() => {
    const made = createFakeDayActions(plan, setPlan);
    if (failNext) made.failNext();
    return made;
  });
  const athlete = plan.athletes.find((a) => a.profilePublicId === plan.profilePublicId);
  if (!athlete) throw new Error(`program preview: ${fixture} does not list its own athlete`);
  return (
    <>
      {/* The day page's own heading: on the real page it is the page's, not the screen's. */}
      <h1 className={`text-3xl font-semibold tracking-tight ${NAME_WRAP_CLASS}`}>{athlete.name}</h1>
      <DayScreen plan={plan} actions={fake.actions} />
    </>
  );
}
