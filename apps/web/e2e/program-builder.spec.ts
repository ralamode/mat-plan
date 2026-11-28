import { randomUUID } from 'node:crypto';

import { PROFILE_KIND, PROFILE_KIND_LABELS, TRACKING_TYPE } from '@mat-plan/shared';
import { familyProgram, todayTwoPrograms } from '@mat-plan/shared/program/fixtures';
import { expect, test, type Page } from '@playwright/test';

import {
  addedText,
  addItemsText,
  BUILDER_COPY,
  COPY_COPY,
  copiedText,
  copyTitle,
  copyToLabel,
  EDITOR_COPY,
  ITEM_PICKER_COPY,
  keepLabel,
  lastDayText,
  NO_PROGRAM_YET_LINE,
  PUT_ON_COPY,
  renameLabel,
  takenOffText,
  takeOffLabel,
} from '../components/program-builder/builder-text';
import {
  newWorkoutPath,
  programPath,
  PROGRAMS_PATH,
  workoutPath,
} from '../components/program-builder/routes';
import { PROGRAM_COPY } from '../components/day/day-copy';
import { SHEET_COPY } from '../components/ui/sheet';
import { APP_HOME_PATH, MIN_TAP_TARGET_PX, NOT_FOUND_COPY, SETTINGS_COPY } from '../lib/constants';
import { expectNoOverflowWithin } from './a11y-checks';
import { NARROW_VIEWPORT } from './contexts';
import {
  addAthlete,
  archiveAdded,
  copyOntoEveryWeekday,
  createProgram,
  isoDaysAgo,
  openPrograms,
  programRowTick,
  putOnFromToday,
  settled,
} from './steps';

/**
 * FAM-1 7b-i and 7b-ii — the program builder's pages, end to end against the fixture world
 * (`SEED_FIXTURES=1`: "Family program" with "Heavy A", "Stretching", "Adult One’s program").
 *
 * - **It starts at `/p` and taps Programs**, as a parent does, so the Home row is proved too.
 * - 🔴 **Names are unique per run** (`Date.now()` in base 36, plus the worker): nothing can be
 *   deleted and CI retries once, so a fixed name would answer `name_taken` on the retry. What it
 *   creates stays in the e2e database, and no other spec reads these programs.
 * - **It never edits a fixture program**: it copies OUT of "Family program" into its own, so the
 *   preview walk and the day page specs see the fixture world unchanged.
 * - **Put on (FAM-1 15) uses only this run's program and this run's athlete**, never a fixture
 *   program or a seeded athlete (`seed-ids.ts`), so a retry and the day page specs see the world as
 *   seeded. The athlete is archived in `afterEach`; archiving does not free a slot, so each run
 *   spends one of `MAX_HOUSEHOLD_ATHLETES`' 25 on the throwaway database.
 * - At 360px, the width the app commits to, because the builder is used on a phone.
 */
test.use({ viewport: NARROW_VIEWPORT });

const FIXTURE_WORKOUT = 'Heavy A';

test('a parent creates and renames a program, then copies a workout into it', async ({
  page,
}, info) => {
  const stamp = `${Date.now().toString(36)}${info.workerIndex}`;
  const name = `E2E ${stamp}`;
  const renamed = `E2E renamed ${stamp}`;

  await openPrograms(page);
  await createProgram(page, name);
  await expect(page).toHaveTitle(new RegExp(`^${BUILDER_COPY.programTitle}\\b`));
  // Put on is wired (step 15): a new program offers it.
  await expect(page.getByRole('button', { name: PUT_ON_COPY.open })).toBeVisible();

  await page.getByRole('button', { name: renameLabel(name) }).click();
  await page.getByLabel(BUILDER_COPY.programName, { exact: true }).fill(renamed);
  await page.getByRole('button', { name: BUILDER_COPY.save, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(renamed);
  const mine = page.url();

  // Copy a seeded workout out of the fixture program into this one.
  await page.getByRole('link', { name: BUILDER_COPY.backToPrograms }).click();
  await expect(page).toHaveURL(PROGRAMS_PATH);
  await expect(page.getByRole('link', { name: renamed })).toBeVisible();
  await page.getByRole('link', { name: familyProgram.name }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(familyProgram.name);
  await page.getByRole('button', { name: copyToLabel(FIXTURE_WORKOUT) }).click();
  const dialog = page.getByRole('dialog', { name: copyTitle(FIXTURE_WORKOUT) });
  await expect(dialog).toBeVisible();
  // The open dialog's a11y bar is `program-builder.a11y.spec.ts`'s (axe needs that project's CSP
  // bypass). The sheet is fixed, so the document-level check cannot see inside it.
  await expectNoOverflowWithin(dialog, 'Copy dialog');
  await dialog.getByLabel(COPY_COPY.to, { exact: true }).selectOption({ label: renamed });
  await dialog.getByRole('button', { name: COPY_COPY.copy, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(copiedText(FIXTURE_WORKOUT, renamed, [], false)).first(),
  ).toBeAttached();

  await page.goto(mine);
  await expect(
    page
      .getByRole('region', { name: BUILDER_COPY.workouts })
      .getByRole('link', { name: new RegExp(`^${FIXTURE_WORKOUT}`) }),
  ).toBeVisible();
});

/** The id at the end of a builder URL. */
const lastId = (url: string) => new URL(url).pathname.split('/').at(-1)!;

test('a parent writes a new workout with two items, saves, and Back never reopens the editor', async ({
  page,
}, info) => {
  const stamp = `${Date.now().toString(36)}${info.workerIndex}`;
  const program = `E2E workouts ${stamp}`;
  const workout = `E2E workout ${stamp}`;

  await openPrograms(page);
  await createProgram(page, program);
  const mine = page.url();
  const workouts = page.getByRole('region', { name: BUILDER_COPY.workouts });
  await workouts.getByRole('link', { name: BUILDER_COPY.newWorkout }).click();
  await expect(page).toHaveURL(newWorkoutPath(lastId(mine)));
  await expect(page).toHaveTitle(new RegExp(`^${EDITOR_COPY.newWorkout}\\b`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.newWorkout);
  // The back link names the program (the page passes `program`).
  await expect(page.getByRole('link', { name: new RegExp(program) })).toBeVisible();

  await page.getByLabel(EDITOR_COPY.workoutName, { exact: true }).fill(workout);
  await page.getByRole('button', { name: ITEM_PICKER_COPY.open }).click();
  const picker = page.getByRole('dialog', { name: ITEM_PICKER_COPY.title });
  await expect(picker).toBeVisible();
  for (const item of ['Chin-up', 'Squat jump']) {
    await picker.getByRole('searchbox').fill(item);
    // The row's name is "<item>, <its lines>" (movement-picker.tsx), so the item ends at the comma:
    // searching "Chin-up" also lists "Weighted chin-up", which this never matches. Chrome puts a space
    // between the row's stacked spans when it builds the name ("Squat jump , Reps"), hence `\s*`.
    // Test-library names since CAT-3 F1-i: a fixtures database holds no old built-in.
    await picker.getByRole('checkbox', { name: new RegExp(`^${item}\\s*,`) }).click();
    if (item === 'Chin-up') {
      // The narrowing is real: the longer name is listed too, and only the intended row is ticked.
      const longer = picker.getByRole('checkbox', { name: /^Weighted chin-up\s*,/ });
      await expect(longer).toBeVisible();
      await expect(longer).not.toBeChecked();
    }
  }
  // "2 items added." is said only once the picker is gone: jsdom closes the sheet before a frame,
  // so only a browser can show the order (guide invariant 16).
  await page.evaluate((said) => {
    const seen = window as unknown as { heardWithPickerOpen?: boolean };
    new MutationObserver(() => {
      if (seen.heardWithPickerOpen !== undefined) return;
      const live = document.querySelectorAll('[role="status"], [role="alert"], [aria-live]');
      if ([...live].some((node) => node.textContent?.includes(said))) {
        seen.heardWithPickerOpen = !!document.querySelector('[role="dialog"]');
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, addedText(2));
  await picker.getByRole('button', { name: addItemsText(2) }).click();
  await expect(picker).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { heardWithPickerOpen?: boolean }).heardWithPickerOpen,
      ),
    )
    .toBe(false);

  for (const item of ['Chin-up', 'Squat jump']) {
    await page
      .getByRole('group', { name: item, exact: true })
      .getByLabel(EDITOR_COPY.sets, { exact: true })
      .fill('3');
  }
  await page.getByRole('button', { name: EDITOR_COPY.save, exact: true }).click();
  await expect(page).toHaveURL(mine);
  await expect(workouts.getByRole('link', { name: new RegExp(`^${workout}`) })).toBeVisible();

  // 🔴 U1-1: Save REPLACED the editor's entry with the program page, so the first Back shows the
  // program page again (accepted: guide invariant 15), never `/workouts/new` or an editor holding
  // the draft from before the save, whose Save could overwrite it.
  await page.goBack();
  await expect(page).toHaveURL(mine);
  await page.reload();
  await expect(workouts.getByRole('link', { name: new RegExp(`^${workout}`) })).toHaveCount(1);

  // The saved workout opens in its editor, with its two items in order.
  await workouts.getByRole('link', { name: new RegExp(`^${workout}`) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.editWorkout);
  await expect(page).toHaveTitle(new RegExp(`^${EDITOR_COPY.editWorkout}\\b`));
  await expect(
    page.getByRole('region', { name: EDITOR_COPY.items }).getByRole('heading', { level: 3 }),
  ).toHaveText(['Chin-up', 'Squat jump']);
});

test('a workout opened under another of the household’s programs is the builder’s 404', async ({
  page,
}) => {
  await openPrograms(page);
  await page.getByRole('link', { name: familyProgram.name }).click();
  await page
    .getByRole('region', { name: BUILDER_COPY.workouts })
    .getByRole('link', { name: new RegExp(`^${FIXTURE_WORKOUT}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITOR_COPY.editWorkout);
  const heavyA = lastId(page.url());
  // Any other program of the household's: Adult One's, found by tapping, never by a typed id.
  await page.goto(PROGRAMS_PATH);
  await page.getByRole('link', { name: /^Adult One’s program/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Adult One’s program');
  const adult = lastId(page.url());
  await page.goto(workoutPath(adult, heavyA));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOT_FOUND_COPY.heading);
  // And a random id under a real program is the same 404.
  await page.goto(workoutPath(adult, randomUUID()));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOT_FOUND_COPY.heading);
});

test('a program id the household does not have is the builder’s 404, with the way back', async ({
  page,
}) => {
  // The content, not the status: the app is force-dynamic, so Next has sent a 200 header before
  // `notFound()` throws (docs/lessons.md → "`notFound()` route returns HTTP 200").
  await page.goto(programPath(randomUUID()));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOT_FOUND_COPY.heading);
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.getByRole('link', { name: BUILDER_COPY.backToPrograms }).click();
  await expect(page).toHaveURL(PROGRAMS_PATH);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FAM-1 15 — a parent puts a new athlete on a program, and the athlete logs it.

/**
 * The fixture program's workout with a Check item, found from the contract's fixtures (as
 * `day-page.spec.ts` finds its rows), never by position: a ✓ on a Check logs in one tap.
 */
const familyProgramId = todayTwoPrograms.currentPrograms.find(
  (p) => p.name === familyProgram.name,
)!.programPublicId;
const CHECK_WORKOUT = todayTwoPrograms.workouts.find(
  (w) =>
    w.programPublicId === familyProgramId &&
    w.items.some((i) => i.trackingType === TRACKING_TYPE.check),
)!;
const CHECK_ITEM = CHECK_WORKOUT.items.find((i) => i.trackingType === TRACKING_TYPE.check)!.name;

/**
 * The day page's Programs link, inside "Not on a program." and after its "Put {name} on a
 * program" sentence: the app shell's own Programs link is elsewhere on the page.
 */
const programsLink = (page: Page, athlete: string) =>
  page
    .locator('p', { hasText: PROGRAM_COPY.notYetPutOn(athlete) })
    .getByRole('link', { name: PROGRAM_COPY.programs, exact: true });

/**
 * A kid's Home tile, by its accessible name: the name and kind only (`aria-labelledby`, 15 PR 3),
 * so the programs line, its description, never changes what the link is called.
 */
const homeTile = (page: Page, athlete: string) =>
  page
    .getByRole('list', { name: SETTINGS_COPY.athletes })
    .getByRole('link', { name: `${athlete} ${PROFILE_KIND_LABELS.kid}`, exact: true });

/** This run's athletes, archived after each test so the picker does not fill with them. */
const added: string[] = [];

test.afterEach(async ({ page }) => {
  test.setTimeout(60_000);
  await archiveAdded(page, added.splice(0));
});

/**
 * 🔴 **A server action while a sheet stays open must not strand its history entry** (2026-11-19).
 * "+ New item" saves through a Server Action that revalidates, and Next's router then rewrites the
 * current history entry without the sheet's key; the picker used to skip its pop on Close, so the
 * next Back press did nothing. One Back after Close must leave the editor.
 */
test('one Back after making an item in the open picker and closing it leaves the editor', async ({
  page,
}, info) => {
  const stamp = `${Date.now().toString(36)}${info.workerIndex}`;
  await openPrograms(page);
  await createProgram(page, `E2E back ${stamp}`);
  const programPage = page.url();
  await page
    .getByRole('region', { name: BUILDER_COPY.workouts })
    .getByRole('link', { name: BUILDER_COPY.newWorkout })
    .click();
  await page.waitForURL(/\/workouts\/new$/);
  const editor = page.url();
  await page.getByRole('button', { name: ITEM_PICKER_COPY.open }).click();
  const picker = page.getByRole('dialog', { name: ITEM_PICKER_COPY.title });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: ITEM_PICKER_COPY.newItem }).click();
  await picker.getByLabel(ITEM_PICKER_COPY.name, { exact: true }).fill(`E2E item ${stamp}`);
  await picker.getByLabel(ITEM_PICKER_COPY.tracks).selectOption(TRACKING_TYPE.reps);
  await picker.getByRole('button', { name: ITEM_PICKER_COPY.create, exact: true }).click();
  // Created and selected: the picker is still open, and the save has revalidated the page.
  await expect(
    picker.getByRole('checkbox', { name: new RegExp(`^E2E item ${stamp}\\s*,`) }),
  ).toBeChecked();
  // The footer's Close. The header has one too, and the footer always comes after it in the DOM
  // (`sheet.tsx`), so the last match is the footer's.
  await picker.getByRole('button', { name: SHEET_COPY.close, exact: true }).last().click();
  await expect(picker).toBeHidden();
  // Exactly one entry back: the program page, not the editor (a stranded entry) and not further
  // (a second pop).
  await page.goBack();
  await expect(page).toHaveURL(programPage);
  expect(editor).not.toBe(programPage);
});

test('a parent puts a new athlete on a program, the athlete logs it, then off and back on', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const stamp = `${Date.now().toString(36)}${info.workerIndex}`;
  const program = `E2E put on ${stamp}`;
  const athlete = `E2E athlete ${stamp}`;

  // 1. This run's program, with the fixture's Check workout on every day of the week, so the run
  //    passes whatever day it is.
  await openPrograms(page);
  await createProgram(page, program);
  const mine = page.url();
  await copyOntoEveryWeekday(page, {
    from: familyProgram.name,
    workout: CHECK_WORKOUT.name,
    to: program,
  });

  // 2. This run's athlete, added as a parent does. They land on their day page, which is on no
  //    program yet and links to Programs (15 PR 2); following it reaches the Programs page.
  await addAthlete(page, athlete, PROFILE_KIND.kid, added);
  await expect(page.getByRole('heading', { name: new RegExp(athlete), level: 1 })).toBeVisible();
  // At 360px: the link is a full tap target and the notice it sits in does not overflow.
  const link = programsLink(page, athlete);
  const box = await link.boundingBox();
  expect(box?.height ?? 0, 'the Programs link is a 44px tap target').toBeGreaterThanOrEqual(
    MIN_TAP_TARGET_PX,
  );
  expect(box?.width ?? 0, 'the Programs link is 44px wide').toBeGreaterThanOrEqual(
    MIN_TAP_TARGET_PX,
  );
  await expectNoOverflowWithin(
    page.locator('p', { hasText: PROGRAM_COPY.notYetPutOn(athlete) }),
    'not-on-a-program notice',
  );
  await link.click();
  await expect(page).toHaveURL(PROGRAMS_PATH);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(BUILDER_COPY.programs);

  // Home's tile says they are on no program yet (15 PR 3).
  await page.goto(APP_HOME_PATH);
  await expect(homeTile(page, athlete)).toHaveAccessibleDescription(NO_PROGRAM_YET_LINE);

  // 3. Put them on from today. The dialog names who is starting.
  await page.goto(mine);
  const putOn = await putOnFromToday(page, program, athlete);

  // 3b. Home's tile now names the program, in the day page's words, with no overflow at 360px (15 PR 3).
  await page.goto(APP_HOME_PATH);
  await expect(homeTile(page, athlete)).toHaveAccessibleDescription(PROGRAM_COPY.line([program]));
  await expectNoOverflowWithin(homeTile(page, athlete), 'Home tile with its programs line');
  await page.goto(mine);

  // 4. Their name under "Who's on it" opens their day page, which shows the program's workout.
  const who = page.getByRole('region', { name: BUILDER_COPY.whosOnIt });
  await who.getByRole('link', { name: athlete, exact: true }).click();
  await expect(page.getByRole('heading', { name: new RegExp(athlete), level: 1 })).toBeVisible();
  const tick = programRowTick(page, CHECK_WORKOUT.name, CHECK_ITEM);
  await tick.click();
  await settled(tick, true);
  await page.reload();
  await expect(tick, 'the ✓ was saved').toHaveAttribute('aria-pressed', 'true');

  // 5. Take off: they had logged today, so they come off after today, and the line says so.
  await page.goto(mine);
  await who.getByRole('button', { name: takeOffLabel(athlete) }).click();
  await expect(page.getByText(takenOffText(athlete, program, true))).toBeAttached();
  await expect(who.getByRole('button', { name: takeOffLabel(athlete) })).toHaveCount(0);
  const lastDayToday = lastDayText(isoDaysAgo(0), isoDaysAgo(0));
  await expect(who.getByText(lastDayToday, { exact: false })).toBeVisible();
  // Home's tile says the same: the program is still named, with its last day (15 PR 3).
  await page.goto(APP_HOME_PATH);
  await expect(homeTile(page, athlete)).toHaveAccessibleDescription(
    PROGRAM_COPY.line([`${program} (${lastDayToday})`]),
  );
  await page.goto(mine);

  // 6. Put them back on before midnight: the same stretch, no last day, and Take off is back.
  await page.getByRole('button', { name: PUT_ON_COPY.open }).click();
  await expect(putOn).toBeVisible();
  await putOn.getByRole('checkbox', { name: athlete, exact: true }).check();
  await expect(putOn.getByText(PUT_ON_COPY.stayOnNoGap)).toBeVisible();
  await putOn.getByRole('button', { name: keepLabel(1, program) }).click();
  await expect(putOn).toBeHidden();
  await expect(who.getByRole('button', { name: takeOffLabel(athlete) })).toBeVisible();
  await expect(who.getByText(lastDayToday, { exact: false })).toHaveCount(0);
});
