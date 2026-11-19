import {
  collapseWhitespace,
  quantityText,
  FREE_TEXT_NOTE_MAX,
  hasStarted,
  LOGGABLE_DIMENSION_LABELS,
  MAX_DAY_SLOTS,
  MAX_HOUSEHOLD_ITEMS,
  MAX_PROGRAM_WORKOUTS,
  MAX_WORKOUT_ITEMS,
  MONDAY_FIRST,
  MAX_SETS_PER_MOVEMENT,
  PROGRAM_REFUSAL,
  SLOT_LABEL_MAX,
  TRACKING_TYPE_FIELDS,
  UNIT_LABELS,
  type ProgramRefusal,
  type ProgramView,
  type TrackingType,
  type Unit,
  type UnitDimension,
  type Weekday,
} from '@mat-plan/shared';

import { itemCountText } from '@/lib/constants';
import { formatDayShort, onDayText } from '@/lib/date';
import { formatValueUnit } from '@/lib/entries/format-value-unit';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { formatList, plural, quote } from '@/lib/i18n/plural';

/**
 * The program builder's words, and the small rules that pick between them (FAM-1 lane B). Pure, so
 * each sentence is tested without rendering a screen. The wording is the accepted prototype's
 * (`docs/prototypes/beta-0/index.html`: `vPrograms`, `vProgram`, `usedBy`, `usedOn`, `provText`).
 */
const PROGRAMS = 'Programs';

export const BUILDER_COPY = {
  programs: PROGRAMS,
  /** Home's way in (7b-i): the chevron says navigation, as Settings' row does (`SETTINGS_COPY.navLink`). */
  programsNavLink: `${PROGRAMS} ›`,
  /** The program page's document title: never the program's name (PROF-1 D8). */
  programTitle: 'Program',
  home: '← Home',
  backToPrograms: '← Programs',
  noPrograms: 'No programs yet.',
  noOneYet: 'No one yet',
  createProgram: '+ Create a program',
  createProgramForm: 'Create a program',
  create: 'Create',
  creating: 'Creating…',
  cancel: 'Cancel',
  programName: 'Program name',
  programNamePlaceholder: 'e.g. Family program',
  /**
   * Said before Create, where the permanence starts (7b plan, §Caps). True since H7 (a): the app
   * cannot delete a program, and the notice says how to ask for one to be removed (runbook "Remove
   * one program, workout or typed item on request").
   */
  createHint:
    'A program can be renamed but not deleted in the app. To have one removed, ask (see the privacy notice).',
  severalPrograms: 'A person can be on several programs.',
  rename: 'Rename',
  save: 'Save',
  /** The program page's status bar, until a message: every change there saves as it is made. */
  savesAsYouGo: 'Changes save as you make them.',
  renamed: 'Program renamed',
  whosOnIt: 'Who’s on it',
  noOneOnIt: 'No one yet.',
  /**
   * Under "Who's on it" while the route wires no Put on (7b-i until step 15, which deletes it): the
   * builder is not a dead end by mistake (7b plan, UX1 #4). Says what is true now, not when it comes:
   * "the next update" would be false once 7b-ii ships first.
   */
  putOnComing: 'Putting someone on a program isn’t in the app yet.',
  takeOff: 'Take off',
  takingOff: 'Taking off…',
  workouts: 'Workouts',
  noWorkouts: 'No workouts yet.',
  newWorkout: '+ New workout',
  week: 'Week',
  restDay: 'Rest day',
  optional: '(optional)',
} as const;

/** What a refused write says when trying again is the only advice. */
export const SAVE_FAILED = 'Couldn’t save. Try again.';

/**
 * Text typed the way the schemas store it: runs of whitespace (a pasted tab or line break
 * included) become one space, and the ends are trimmed. The contract refuses a control character
 * and a line break, so a pasted tab would otherwise come back `invalid` under text that looks fine.
 */
export const cleanName = (raw: string) => collapseWhitespace(raw).trim();

/**
 * A pending button: `aria-disabled` (a disabled one drops focus to <body>), which `Button` does
 * not style, so it is dimmed here.
 */
export const PENDING_CLASS = 'aria-disabled:opacity-60';

/** What a refused name write says, under the field. */
export function nameRefusal(reason: ProgramRefusal): string {
  switch (reason) {
    case PROGRAM_REFUSAL.name_taken:
      return 'A program with this name already exists.';
    case PROGRAM_REFUSAL.invalid:
      return 'Give the program a name.';
    case PROGRAM_REFUSAL.not_found:
      return 'This program no longer exists.';
    default:
      return SAVE_FAILED;
  }
}

/**
 * The line under a program's name. **Everyone on `athletes` counts**, an athlete whose last day is
 * today included: they are on it through today, so an edit now still changes their day.
 */
export function usedByText(athletes: readonly string[]): string {
  if (athletes.length === 0) return 'No one is on this yet. Changes affect no one.';
  const who =
    athletes.length === 1 ? athletes[0] : athletes.length === 2 ? 'both' : `all ${athletes.length}`;
  return `Used by ${formatList(athletes)}. Changes apply to ${who}.`;
}

/**
 * Accessible names that name their subject, so a screen reader's list of buttons tells them
 * apart. The visible word is a prefix of each (WCAG 2.5.3, as `changeLabel` in `lib/constants`).
 */
export const renameLabel = (program: string) => `${BUILDER_COPY.rename} ${program}`;
export const takeOffLabel = (athlete: string) => `${BUILDER_COPY.takeOff} ${athlete}`;
export const takingOffLabel = (athlete: string) => `${BUILDER_COPY.takingOff} ${athlete}`;

/** An athlete's line on the program page: "since Mon, Nov 9 · last day … · also on Stretching". */
export function athleteHint(athlete: ProgramView['athletes'][number], today: string): string {
  const parts = [
    `${hasStarted(athlete, today) ? 'since' : 'starts'} ${formatDayShort(athlete.since)}`,
  ];
  if (athlete.lastDay) parts.push(`last day ${formatDayShort(athlete.lastDay)}`);
  if (athlete.alsoOn.length) parts.push(`also on ${formatList(athlete.alsoOn)}`);
  return parts.join(' · ');
}

/** What Take off says once it worked. Someone who had not started yet simply never starts. */
export function takenOffText(athlete: string, program: string, started: boolean): string {
  return started
    ? `${athlete} comes off ${program} after today. Days already logged keep what they had.`
    : `${athlete} won’t start ${program}.`;
}

export function takeOffFailedText(athlete: string): string {
  return `Couldn’t take ${athlete} off. Try again.`;
}

/** A weekday's name, from a fixed week that starts on a Sunday (2026-11-15). */
export function weekdayName(weekday: number, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(APP_LOCALE, { weekday: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 10, 15 + weekday)),
  );
}

/** "6 items · Used Mon, Tue" or "… · Not on any day yet". */
export function workoutSummary(itemCount: number, usedOn: readonly number[]): string {
  const items = itemCountText(itemCount);
  const days = usedOn.length
    ? `Used ${formatList(
        usedOn.map((k) => weekdayName(k, 'short')),
        APP_LOCALE,
        'unit',
      )}`
    : 'Not on any day yet';
  return `${items} · ${days}`;
}

/** Where a copied workout came from: the program's name as it was on the day of the copy. */
export function copiedFromText(from: { programName: string; on: string }): string {
  return `Copied from ${from.programName} · ${formatDayShort(from.on)}`;
}

/** The link control's words, which the intro line names too. */
const LINK_NEXT = 'Superset with next';

/** The workout editor's words (FAM-1 step 8; the prototype's `vWorkout`). */
export const EDITOR_COPY = {
  backToProgram: '← Program',
  editWorkout: 'Edit workout',
  newWorkout: 'New workout',
  workoutName: 'Name',
  workoutNamePlaceholder: 'e.g. Heavy A',
  description: 'Description',
  items: 'Items',
  noItems: 'No items yet.',
  checkHint: 'Checked off in one tap.',
  sets: 'Sets',
  reps: 'Reps',
  unit: 'Unit',
  chooseUnit: 'Choose…',
  instructions: 'Instructions',
  instructionsHint: 'Shown with the item, every time.',
  rest: 'Rest',
  restPlaceholder: 'e.g. 90 s after each round',
  supersetIntro: `A superset is items done back to back. Tap “${LINK_NEXT}” under an item; add a third the same way.`,
  linkNext: LINK_NEXT,
  unlinkNext: 'Unlink from next',
  up: 'Up',
  down: 'Down',
  remove: 'Remove',
  save: 'Save workout',
  discardQuestion: 'Discard your changes to this workout?',
  discard: 'Discard',
  keepEditing: 'Keep editing',
  alreadyFirst: 'Already first.',
  alreadyLast: 'Already last.',
  nameTaken: 'A workout with this name is already in this program.',
} as const;

export type MoveDirection = 'up' | 'down';

/** A field's refusal, under it. Each names its field, so two on one card can be told apart. */
export const EDITOR_ERRORS = {
  name: 'Give the workout a name, then Save.',
  sets: `Sets: a whole number from 1 to ${MAX_SETS_PER_MOVEMENT}.`,
  reps: 'Reps: a whole number, or leave it blank.',
  value: (label: string) => `${label}: a number like 22.5, or leave it blank.`,
  ceiling: (label: string, ceiling: number, unit: Unit) =>
    `${label}: at most ${formatValueUnit(ceiling, unit)}.`,
  unit: (label: string) => `${label}: choose a unit.`,
  tooLong: `At most ${FREE_TEXT_NOTE_MAX} characters.`,
  rest: `Rest: at most ${SLOT_LABEL_MAX} characters.`,
} as const;

/** The words a type's quantity field is called by, where the type does not fix its unit. */
const QUANTITY_WORDS: Partial<Record<TrackingType, string>> = {
  weight_reps: 'Weight',
  distance: 'Distance',
  count: 'Target',
};

/**
 * What a card's quantity field is called, or `null` for a type with no quantity
 * (`TRACKING_TYPE_FIELDS[type].slot`). A fixed unit names its own field: "Minutes", "Seconds".
 */
export function quantityLabel(type: TrackingType): string | null {
  const { slot, unit } = TRACKING_TYPE_FIELDS[type];
  if (!slot) return null;
  return unit ? UNIT_LABELS[unit] : (QUANTITY_WORDS[type] ?? null);
}

/** The unit select's group names: the shared ones, plus a count. */
export const UNIT_GROUP_LABELS: Partial<Record<UnitDimension, string>> = {
  ...LOGGABLE_DIMENSION_LABELS,
  count: 'Count',
};

/** Names that tell a card's buttons apart; the visible word comes first (WCAG 2.5.3). */
export const moveLabel = (direction: MoveDirection, item: string) =>
  `${EDITOR_COPY[direction]}: ${item}`;
export const removeLabel = (item: string) => `${EDITOR_COPY.remove} ${item}`;

/** A superset's letter, read out: "A1" is "Superset A, item 1". */
export function supersetSpoken(label: string): string {
  const letter = supersetLetterOf(label);
  return `Superset ${letter}, item ${label.slice(letter.length)}`;
}

/** What a move or a remove did to the supersets, for the status line. */
export type SupersetChange = { ended: number; left: readonly string[]; droppedRests: number };

function supersetChangeText({ ended, left, droppedRests }: SupersetChange): string {
  const parts: string[] = [];
  if (ended) {
    parts.push(plural(ended, { one: 'A superset ended.', other: `${ended} supersets ended.` }));
  }
  if (left.length) {
    parts.push(`${formatList(left)} left ${left.length === 1 ? 'its' : 'their'} superset.`);
  }
  if (droppedRests) {
    parts.push(
      plural(droppedRests, { one: 'Its rest is gone.', other: `${droppedRests} rests are gone.` }),
    );
  }
  return parts.join(' ');
}

export function movedText(item: string, direction: MoveDirection, change: SupersetChange): string {
  return [`${item} moved ${direction}.`, supersetChangeText(change)].filter(Boolean).join(' ');
}

export function removedText(item: string, change: SupersetChange): string {
  return [`${item} removed. Cancel undoes all changes.`, supersetChangeText(change)]
    .filter(Boolean)
    .join(' ');
}

/** A unit changed under a typed number: say what the number now means. */
export function unitChangedText(item: string, value: number, from: Unit, to: Unit): string {
  return `${item}: now ${quantityText(value, to)} (was ${quantityText(value, from)}).`;
}

/** The save bar after a refused Save. No count, so it stays true as fields are fixed. */
export function fieldsToFixText(count: number): string {
  return count === 1
    ? 'One field needs fixing before saving.'
    : `${count} fields need fixing before saving.`;
}

/** What a refused Save says in the save bar. `name_taken` is said under the name as well. */
export function saveRefusal(reason: ProgramRefusal): string {
  switch (reason) {
    case PROGRAM_REFUSAL.name_taken:
      return EDITOR_COPY.nameTaken;
    case PROGRAM_REFUSAL.invalid:
      return 'Couldn’t save: part of this workout wasn’t accepted. Check it and try again.';
    case PROGRAM_REFUSAL.not_found:
      return 'This workout no longer exists.';
    // A new workout in a program at `MAX_PROGRAM_WORKOUTS` (C35): the stop is at "+ New workout",
    // so this is a race or a typed URL (7b-ii, plan §Caps). An edit is never capped.
    case PROGRAM_REFUSAL.limit_reached:
      return `${PROGRAM_FULL} This one wasn’t saved.`;
    default:
      return SAVE_FAILED;
  }
}

/**
 * The link control's visible words: joining two supersets says so before the tap (a merge can drop
 * a rest); otherwise "Superset with next" or "Unlink from next". Never the item's name, which may
 * be 100 characters at 360px; the next card's heading is right below it.
 */
export function linkText(link: {
  linked: boolean;
  joins: readonly [string, string] | null;
}): string {
  if (link.linked) return EDITOR_COPY.unlinkNext;
  return link.joins ? `Join supersets ${link.joins[0]} and ${link.joins[1]}` : EDITOR_COPY.linkNext;
}

/**
 * The control's accessible name: its visible words first (WCAG 2.5.3), then the two items it
 * joins, this card's own first, as the card's other buttons name their own item.
 */
export const linkLabel = (visible: string, item: string, next: string) =>
  `${visible}: ${item} and ${next}`;

/** A superset's letter from its label: "A2" is "A", "AA1" is "AA". */
export const supersetLetterOf = (label: string) => label.replace(/\d+$/, '');

/** A rest a link or unlink removed, said one way. */
const restRemovedText = (rest: string) => `Rest “${rest}” removed.`;

/** A rest field's name, told apart from the others by its superset's letter. */
export const restForLabel = (letter: string) => `of superset ${letter}`;

/**
 * What a link did, for the status line: by superset letter, never by item names, so it stays
 * within two lines in the save bar. A join names the rest it removed; the one kept is in the field.
 */
export function linkedText(link: {
  letter: string;
  joined: 'pair' | 'one' | 'groups';
  size: number;
  from: readonly [string, string] | null;
  dropped: string | null;
}): string {
  // A new pair: its rest field is on its last card, which may be off-screen.
  if (link.joined === 'pair')
    return `Linked: superset ${link.letter}. Its rest is on its last item.`;
  if (link.joined === 'one') return `Linked: superset ${link.letter} now has ${link.size} items.`;
  const done = `Supersets ${link.from![0]} and ${link.from![1]} are now ${link.letter}.`;
  return link.dropped ? `${done} ${restRemovedText(link.dropped)}` : done;
}

/** What an unlink did: the superset ended, lost an item, or became two. By letter. */
export function unlinkedText(unlink: {
  letter: string;
  ended: boolean;
  /** The size of the one side still a superset, or `null` when both are. */
  size: number | null;
  droppedRest: string | null;
}): string {
  if (unlink.ended) {
    const done = `Unlinked: superset ${unlink.letter} ended.`;
    return unlink.droppedRest ? `${done} ${restRemovedText(unlink.droppedRest)}` : done;
  }
  return unlink.size === null
    ? `Unlinked: superset ${unlink.letter} is now two.`
    : `Unlinked: superset ${unlink.letter} now has ${unlink.size} items.`;
}

/** The opposite tap, straight after: everything is as it was before the first. */
export function undoneText(linked: boolean): string {
  return linked ? 'Linked again: as it was.' : 'Unlinked again: as it was.';
}

/** The item picker's words (FAM-1 step 9; the prototype's `vPicker2`). */
const HOUSEHOLD_FULL = `Your household has the most custom items it can keep (${MAX_HOUSEHOLD_ITEMS})`;
/**
 * Whether the household's own items (never the library's) are at `MAX_HOUSEHOLD_ITEMS`.
 * ⚠️ Must agree with the server's count, `newItem`'s `owner !== 'catalog'`
 * (`packages/db/src/writers/program/new-item.ts`): today every non-catalog option is `household`,
 * but see the TODO(CAT-3 chunk R) in `item-picker/item-picker.tsx`'s `create`.
 */
export const householdIsFull = (options: readonly { owner: string }[]) =>
  options.filter((option) => option.owner === 'household').length >= MAX_HOUSEHOLD_ITEMS;

export const ITEM_PICKER_COPY = {
  title: 'Add items',
  open: '+ Add items',
  newItem: '+ New item',
  noMatch: 'No item matches. Make it a new item with the button above.',
  searchLabel: 'Search items',
  searchPlaceholder: 'Search items',
  /** An empty name. A name with nothing to tell it apart is the contract's own refusal (C8). */
  giveAName: 'Give the item a name.',
  pickToAdd: 'Pick items to add',
  /** The shared picker's tag reads "already in {this}". */
  alreadyIn: 'this workout',
  formTitle: 'New item',
  name: 'Name',
  namePlaceholder: 'e.g. Bear crawl',
  tracks: 'What it tracks',
  chooseType: 'Choose…',
  chooseTypeFirst: 'Choose what it tracks.',
  create: 'Create',
  creating: 'Creating…',
  failed: 'Couldn’t create it. Try again.',
  refused: 'That name wasn’t accepted. Check it and try again.',
  /**
   * The household holds `MAX_HOUSEHOLD_ITEMS` of its own (C35; 7b-ii, plan §Caps), said before any
   * typing; a name that is already an item still selects it (never capped, contract invariant 30).
   */
  householdFull: `${HOUSEHOLD_FULL}. Pick one from the list instead.`,
  /** `newItem` refused `limit_reached`: a race the stop above did not see. */
  full: `${HOUSEHOLD_FULL}, so this one wasn’t made. Pick one from the list instead.`,
} as const;

/** "New item: “Bear Crawl”", or the plain "+ New item" for an empty search. */
export const newItemLabel = (typed: string) =>
  typed ? `New item: ${quote(typed)}` : ITEM_PICKER_COPY.newItem;

/** The Add button, with the count. */
export const addItemsText = (n: number) => `Add ${itemCountText(n)}`;

/** The picked items, in the order they were picked, above the Add button. */
export const pickedText = (names: readonly string[]) =>
  `${names.length} picked: ${formatList(names)}`;

/** Why a tap selected nothing: the workout is full. */
export const capText = (max: number) => `A workout holds at most ${max} items.`;
/** Under the editor's "+ Add items", and what a tap on it says, once the workout is full (7b-ii). */
export const workoutFullText = `This workout is full: a workout holds at most ${MAX_WORKOUT_ITEMS} items.`;

/**
 * The caps the program page stops at (FAM-1 7b-i, plan §Caps). Each says "is full … holds at most
 * N", from the shared consts, and offers no delete, because none exists.
 */
export const programIsFull = (workouts: number) => workouts >= MAX_PROGRAM_WORKOUTS;
const PROGRAM_FULL = `This program is full: a program holds at most ${MAX_PROGRAM_WORKOUTS} workouts.`;
/** Under "+ New workout", once the program holds `MAX_PROGRAM_WORKOUTS`. */
export const programFullText = `${PROGRAM_FULL} To add one, change a workout that’s not on any day, or create another program.`;
export const dayIsFull = (slots: number) => slots >= MAX_DAY_SLOTS;
/** Under a full day's header, and what its "+ Add" says when tapped. */
export const dayFullText = (day: number) =>
  `${weekdayName(day)} is full: a day holds at most ${MAX_DAY_SLOTS} workouts.`;
/** Days ticked for a copy that filled while the dialog was open, so were left out; '' for none. */
export const skippedFullText = (days: readonly number[]) =>
  days.length
    ? `${formatList(days.map((day) => weekdayName(day)))} ${days.length > 1 ? 'were' : 'was'} full, so skipped.`
    : '';
/** A full day's checkbox, as "has it" is named. */
export const dayFullLabel = (day: number) => `${weekdayName(day)}, ${WEEK_COPY.full}`;

/** What each type logs, shown under the type chooser once one is picked. */
export const TRACKING_TYPE_EXAMPLES: Record<TrackingType, string> = {
  check: 'Done or not done.',
  count: 'One number in a unit, like a 10 lb vest or 20 reps.',
  reps: 'Sets of reps, like 3 × 10.',
  weight_reps: 'Sets of reps at a weight, like 3 × 8 at 20 lb.',
  duration: 'One length of time, like 5 min.',
  time_sets: 'Sets of a time, like 3 × 30 s.',
  distance: 'Sets of a distance, like 1 × 400 m.',
};

/**
 * The permanence warning (the single picker's, `asTypedHint`, made true for the builder): an item
 * is the household's, it cannot be deleted or renamed, and its type is set once (plan D25).
 */
export const newItemWarning = (name: string) =>
  `Adds ${name ? quote(name) : 'this item'} for everyone in your household. It can’t be deleted or renamed, and what it tracks can’t be changed. Check both.`;

/** The form's Create, when the name is already an item: it selects that one instead. */
export const selectExistingText = (name: string) => `Select ${name}`;
export const alreadyListedText = (name: string, type: string) =>
  `Already in the list as ${name} (${type}).`;
/** Made by this Create, or by an earlier one of the same form that got no answer. */
export const createdText = (name: string) => `${name} created and selected.`;
/** A name that already existed, and is in the screen's list. */
export const existedText = (name: string, type: string) =>
  `${name} is in the list (${type}). Selected.`;
/**
 * The server answered an item the screen's list did not have (`existed`, not listed): another
 * parent made it first, or, until the catalog's fresh start, a built-in the list was given no row
 * for. "Is in the list" would be false, and the type the person chose was not used, so this says
 * what happened (7a-ii trust lens; maintainer, 2026-11-17).
 */
export const existedUnlistedText = (name: string, type: string) =>
  `${name} already exists (${type}), so nothing new was made. Selected.`;
export const addedText = (n: number) => `${itemCountText(n)} added.`;

/** A row ticked from the search's Enter, where no row has focus to say so. */
export const selectedText = (name: string) => `${name} selected.`;

/** What a refused new item says: a name refusal under the field, anything else in the footer. */
export function newItemRefusal(reason: ProgramRefusal): {
  field: string | null;
  footer: string | null;
} {
  if (reason === PROGRAM_REFUSAL.invalid) return { field: ITEM_PICKER_COPY.refused, footer: null };
  if (reason === PROGRAM_REFUSAL.limit_reached)
    return { field: null, footer: ITEM_PICKER_COPY.full };
  return { field: null, footer: ITEM_PICKER_COPY.failed };
}

/** Made or found, but not ticked: the workout is full. */
export const notTickedText = (name: string) =>
  `${name} is in the list, not ticked. ${capText(MAX_WORKOUT_ITEMS)}`;

/** The week editor's words (FAM-1 step 10; the prototype's Week section). */
export const WEEK_COPY = {
  intro: 'Each day runs its workouts in this order. A day with none is a rest day.',
  today: 'today',
  add: '+ Add',
  workout: 'Workout',
  chooseWorkout: 'Choose a workout',
  label: 'Label',
  labelHint: 'Shown above the workout on the day. It doesn’t change the order; use ↑ ↓.',
  days: 'Days',
  hasIt: 'has it',
  /** A day at `MAX_DAY_SLOTS`, in the days fieldset. */
  full: 'full',
  oncePerDay: 'A workout runs at most once a day; days that already have it are skipped.',
  pickADay: 'Pick at least one day that doesn’t have it yet.',
  addButton: 'Add',
  undo: 'Undo',
  addLabel: '+ Label',
  editLabel: 'Edit label',
  noWorkouts: 'Make a workout first, then add it to days.',
  stale:
    'This week was changed somewhere else. It now shows the latest; your last change wasn’t saved.',
  labelPlaceholder: 'e.g. Morning',
  labelInvalid: 'A label is one line of plain text.',
  failed: 'Couldn’t save that change. The week is back as it was. Try again.',
} as const;

/** "Heavy A (already on Monday)": an option already on the day the form opened from. */
export const alreadyOnText = (workout: string, day: number) =>
  `${workout} (already on ${weekdayName(day)})`;

/** "Add a workout on Monday". */
export const addOnLabel = (day: number) => `Add a workout on ${weekdayName(day)}`;
export const moveOnLabel = (direction: MoveDirection, workout: string, day: number) =>
  `Move ${workout} ${direction} on ${weekdayName(day)}`;
export const removeFromLabel = (workout: string, day: number) =>
  `Remove ${workout} from ${weekdayName(day)}`;

/** "Heavy A added on Mon, Wed and Fri. Already on Tue, so skipped." */
export function addedOnText(workout: string, added: readonly number[], skipped: readonly number[]) {
  // Monday first, whatever order the days were ticked in.
  const short = (days: readonly number[]) =>
    formatList(
      [...days]
        .sort((a, b) => MONDAY_FIRST.indexOf(a as Weekday) - MONDAY_FIRST.indexOf(b as Weekday))
        .map((day) => weekdayName(day, 'short')),
    );
  return [
    added.length ? `${workout} added on ${short(added)}.` : '',
    skipped.length ? `Already on ${short(skipped)}, so skipped.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export const removedFromText = (workout: string, day: number) =>
  `${workout} removed from ${weekdayName(day)}.`;
/** The row left where a removed slot was. */
export const removedRowText = (workout: string) => `${workout} removed`;
export const restoredText = (workout: string, day: number) =>
  `${workout} is back on ${weekdayName(day)}.`;
export const movedOnText = (workout: string, direction: MoveDirection, day: number) =>
  `${workout} moved ${direction} on ${weekdayName(day)}.`;
export const labelSetText = (workout: string, day: number, label: string | null) =>
  label
    ? `${workout} on ${weekdayName(day)} is labelled ${quote(label)}.`
    : `${workout} on ${weekdayName(day)} has no label.`;

/** A refusal that can only mean the page's week is stale: the editor refreshes the page. */
export const isStaleWeek = (reason: ProgramRefusal) =>
  reason === PROGRAM_REFUSAL.once_per_day || reason === PROGRAM_REFUSAL.not_found;

/**
 * What a refused week says: a stale page (the editor never sends a repeat), a full day, or a
 * failure. `limit_reached` names the days of the sent week at or over `MAX_DAY_SLOTS`, Monday
 * first: the editor stops at the cap, so a day at it is the one a race could have pushed past.
 */
export function weekRefusal(reason: ProgramRefusal, sent?: ProgramView['week']): string {
  if (reason === PROGRAM_REFUSAL.limit_reached) {
    const full = sent ? MONDAY_FIRST.filter((day) => dayIsFull(sent[day].length)) : [];
    const days = full.length ? formatList(full.map((day) => weekdayName(day))) : 'A day';
    return `${days} ${full.length > 1 ? 'are' : 'is'} full: a day holds at most ${MAX_DAY_SLOTS} workouts. Nothing was added; the week is back as it was.`;
  }
  return isStaleWeek(reason) ? WEEK_COPY.stale : WEEK_COPY.failed;
}

/** The Undo button's name: the row's words are not linked to it. */
export const undoLabel = (workout: string, day: number) =>
  `Undo: put ${workout} back on ${weekdayName(day)}`;

/** A day that already has the chosen workout, in the days fieldset. */
export const hasItLabel = (day: number) => `${weekdayName(day)}, ${WEEK_COPY.hasIt}`;

/** The Put-on dialog's words (FAM-1 step 10b; the prototype's `openStart`). */
export const PUT_ON_COPY = {
  open: 'Put someone on this program…',
  everyoneOn: 'Everyone in the household is on it.',
  who: 'Who',
  intro: 'This adds a program; their other programs stay.',
  starting: 'Starting',
  onIt: 'on it',
  noProgramYet: 'no program yet',
  pickSomeone: 'Pick someone first',
  start: 'Start',
  startPending: 'Starting…',
  failed: 'Couldn’t start them. Try again.',
  stale: 'This program changed somewhere else. It now shows the latest; no one was started.',
  dayChanged: 'The day has changed since this page loaded. It now shows today; no one was started.',
} as const;

export const putOnTitle = (program: string) => `Put someone on ${program}`;
export const keepsText = (programs: readonly string[]) =>
  programs.length ? `keeps ${formatList(programs)}` : PUT_ON_COPY.noProgramYet;
export const lastDayText = (day: string) => `last day ${formatDayShort(day)}`;
export const candidateOnLabel = (name: string, hint: string) => `${name}, ${hint}`;
export const startLabel = (count: number, program: string) =>
  count ? `${PUT_ON_COPY.start} ${count} on ${program}` : PUT_ON_COPY.start;
export const fromText = (when: 'today' | 'tomorrow', day: string) =>
  `${when === 'today' ? 'Today' : 'Tomorrow'}, ${formatDayShort(day)}`;

/**
 * What the chosen start changes, named (the trust lens): the workouts that go on their page that
 * day, or that the day has none and when the first one is. Today also says what was logged stays.
 */
export function startEffectText(
  when: 'today' | 'tomorrow',
  workouts: readonly string[],
  next: { day: string; workouts: readonly string[] } | null,
): string {
  const day = when === 'today' ? 'Today' : 'Tomorrow';
  const kept = when === 'today' ? ' What they’ve already logged today stays.' : '';
  if (workouts.length) {
    return `${day}: ${formatList(workouts)} ${workouts.length > 1 ? 'go' : 'goes'} on their page.${kept}`;
  }
  const first = next ? ` Their first workout is ${formatDayShort(next.day)}.` : '';
  return `${day}: nothing from this program.${first}${kept}`;
}

/** Shown when someone ticked keeps another program: where this one goes in their day's order. */
export const orderHintText = (program: string) =>
  `${program} goes where it sits in the Programs list. Each person can change their order from their day page.`;
/** Shown when someone ticked keeps another program and Take off is wired: how to switch instead. */
export const switchHintText = (programs: readonly string[]) =>
  `To switch instead, start tomorrow, then take them off ${formatList(programs)} from that program’s page.`;
export function startedText(
  names: readonly string[],
  program: string,
  from: string,
  today: string,
) {
  // The day page's own phrase for a day (`onDayText`, #517): one wording on both screens.
  return `${formatList(names)} ${names.length > 1 ? 'start' : 'starts'} ${program} ${onDayText(from, today)}.`;
}
/** Someone put back on after a Take off: they never left, whatever the start date (C15). */
export const backOnText = (names: readonly string[], program: string) =>
  `${formatList(names)} ${names.length > 1 ? 'stay' : 'stays'} on ${program}.`;

/** The Copy dialog's words (FAM-1 step 10b; the prototype's `openCopy`). */
export const COPY_COPY = {
  open: 'Copy to…',
  to: 'To',
  chooseProgram: 'Choose a program',
  chooseFirst: 'Choose where to copy it',
  days: 'On which days',
  optional: '(optional)',
  labelHint: 'Shown above the workout on those days.',
  separate: 'The copy is separate: editing one never changes the other.',
  /** The copy's permanence, as `BUILDER_COPY.createHint` says the program's (H7 (a)). */
  permanent:
    'A copy can’t be deleted in the app. To have one removed, ask (see the privacy notice).',
  copy: 'Copy',
  copying: 'Copying…',
  name: 'Name',
  nameMissing: 'Give the copy a name.',
  nameInvalid: 'A name is one line of plain text.',
  failed: 'Couldn’t copy it. Try again.',
  stale: 'This program changed somewhere else. It now shows the latest; nothing was copied.',
} as const;

/**
 * What a copy refused `limit_reached` says (D13: the refusal carries no cap field, so the words name
 * both causes). Into this program with no day picked, only the program can be full.
 */
export function copyRefusal(
  reason: ProgramRefusal,
  copy: { sameProgram: boolean; dayPicked: boolean; target: string },
): string {
  if (reason !== PROGRAM_REFUSAL.limit_reached) return COPY_COPY.failed;
  if (copy.sameProgram && !copy.dayPicked) {
    return `${PROGRAM_FULL} Nothing was copied. Create another program to copy it into.`;
  }
  // Into another program, it is named: "This program" would read as the page the parent is on.
  const which = copy.sameProgram ? 'This program' : copy.target;
  return `${which} can’t take another workout, or one of those days is full (${MAX_PROGRAM_WORKOUTS} workouts in a program, ${MAX_DAY_SLOTS} on a day).`;
}

/** The trigger's name: the visible words first (WCAG 2.5.3), then which workout. */
export const copyToLabel = (workout: string) => `${COPY_COPY.open} a program: ${workout}`;
export const copyTitle = (workout: string) => `Copy ${workout}`;
export const thisProgramOption = (program: string) => `This program: ${program}`;
/** This program in Copy's To, once it holds `MAX_PROGRAM_WORKOUTS`: a copy here would be refused. */
export const thisProgramFullOption = (program: string) => `${thisProgramOption(program)} (full)`;

export const copyTakenText = (name: string) =>
  `There’s already a ${name} here. Give the copy another name.`;
/** A copy to another program keeps its name; that program already has one. */
export const copyTakenElsewhereText = (program: string, name: string) =>
  `${program} already has a ${name}. Give the copy another name.`;

/** Who sees the copy: the people on the target program. */
export const targetPeopleText = (program: string, people: readonly string[]) =>
  people.length
    ? `On ${program}: ${formatList(people)}. They’ll see it on the days you pick.`
    : `No one is on ${program} yet.`;
/** An athlete on both programs who already does this workout on a picked day. */
export const doubleText = (
  athlete: string,
  workout: string,
  days: readonly number[],
  program: string,
) =>
  `${athlete} already does ${workout} on ${formatList(days.map((d) => weekdayName(d, 'short')))} (${program}).`;
export const putOnInsteadText = (program: string) =>
  `If you want someone to get every change to ${program}, put them on it instead: they get its whole week, and every later change.`;

export function copiedText(
  workout: string,
  target: string,
  days: readonly number[],
  sameProgram: boolean,
): string {
  const on = days.length ? `, on ${formatList(days.map((d) => weekdayName(d, 'short')))}` : '';
  return sameProgram
    ? `${workout} added${on}.`
    : `${workout} copied to ${target}${on}. Editing one won’t change the other.`;
}

/**
 * A loaded number the card cannot hold (FAM-1 editor): what it was, and what to do. Information
 * only; the field stays empty for a person to type (plan D27).
 */
export function droppedText(was: { value: number; unit: Unit }, fixedUnit: Unit | null): string {
  const unit = (u: Unit) => (UNIT_LABELS[u] ?? u).toLowerCase();
  const saved = `This was saved as ${was.value} ${unit(was.unit)}`;
  return fixedUnit
    ? `${saved}, which this item can’t hold. Enter it in ${unit(fixedUnit)}.`
    : `${saved}. Choose a unit and enter it again.`;
}
