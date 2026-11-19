'use client';

import {
  MAX_WORKOUT_ITEMS,
  MOVEMENT_NAME_MAX,
  newItemSchema,
  TRACKING_TYPE_LABELS,
  TRACKING_TYPES,
  type ProgramActions,
  type TrackingType,
} from '@mat-plan/shared';
import { useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

import {
  listedAs,
  MovementPicker,
  type MovementPickerProps,
  OPTION_ID_ATTR,
  PICKER_CREATE_ID,
} from '@/components/movements/movement-picker';
import { Button } from '@/components/ui/button';
import { INPUT_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import type { MovementOptionDTO } from '@/lib/movements/movement-option';

import {
  addItemsText,
  BUILDER_COPY,
  alreadyListedText,
  capText,
  cleanName,
  createdText,
  existedText,
  existedUnlistedText,
  householdIsFull,
  ITEM_PICKER_COPY as COPY,
  newItemLabel,
  newItemRefusal,
  newItemWarning,
  PENDING_CLASS,
  notTickedText,
  pickedText,
  selectedText,
  selectExistingText,
  TRACKING_TYPE_EXAMPLES,
} from '../builder-text';
import { FieldLabel } from '../field-label';
import { NameField } from '../name-field';
import { isSameTap, useAttempt } from '../use-attempt';

const FORM_ID = 'new-item-form';
const NAME_ID = 'new-item-name';
const TYPE_ID = 'new-item-type';
const TYPE_HINT_ID = 'new-item-type-hint';
const WARNING_ID = 'new-item-warning';
const EXISTING_ID = 'new-item-existing';
const SUMMARY_ID = 'item-picker-picked';
const HOUSEHOLD_FULL_ID = 'new-item-household-full';

/**
 * The workout editor's item picker (FAM-1 step 9; plan §8 "Item picker"; the prototype's `vPicker2`):
 * the shared movement picker in its multi-select mode, with "Add n items" and a new-item form.
 *
 * - **Its state is the editor's.** The selection (in pick order) and the items made here are held by
 *   the editor, so a Close or a back swipe keeps the ticks _(maintainer, 2026-11-16)_ and a reopened
 *   picker lists what was just made.
 * - **The new-item form takes over the sheet** _(maintainer, 2026-11-16)_: search and list hide,
 *   and Create and Cancel sit in the sheet's footer (pinned, except under a 480px visual viewport,
 *   where the sheet lets the footer scroll; `sheet.tsx`).
 * - **What it tracks has no default** _(maintainer, 2026-11-16)_: Create is inactive until a type is
 *   chosen, because the type can never be changed and the item never deleted.
 * - **A name already in the list selects that item**, by the server's own rule
 *   (`listedAs`, which is `existingItem`: an exact name, an exact alias, or what the short forms
 *   spell): typing "RDL" or "db row" never makes a second Romanian Deadlift or Dumbbell row. The server answers `existed` for the same reason, and a retry that landed reads the
 *   same.
 * - It writes only through `newItem`; the picker it mounts never writes (movement-picker invariant 2).
 *
 * ⚠️ **Mount it outside the editor's `<form>`.** A portal's React events bubble to React ancestors,
 * so a form here inside the editor's form would submit the workout too.
 */
export function ItemPicker({
  open,
  onOpenChange,
  returnFocusTo,
  onReturned,
  options,
  selected,
  onToggle,
  inWorkout,
  room,
  newItem,
  onCreated,
  onAdd,
  howTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: RefObject<HTMLElement | null>;
  /** Every item the household can add, including those made here. */
  options: readonly MovementOptionDTO[];
  /** "How to" for a library row (CAT-3 P16), passed to the movement picker; none, no button. */
  howTo?: MovementPickerProps['howTo'];
  /** Selected ids, in pick order. */
  selected: readonly string[];
  onToggle: (option: MovementOptionDTO) => void;
  /** Items already on a card: tagged, still selectable (the same item twice is legal). */
  inWorkout: ReadonlySet<string>;
  /** How many more cards the workout holds (`MAX_WORKOUT_ITEMS` less the cards). */
  room: number;
  newItem: ProgramActions['newItem'];
  /** A new item, to keep in the editor's options. */
  onCreated: (option: MovementOptionDTO) => void;
  onAdd: () => void;
  /** Once per close, after focus is back: the moment for a page-level message ("3 items added."). */
  onReturned?: () => void;
}) {
  const [notice, setNoticeNow] = useState('');
  /** Cleared first and set a frame later, so the same message twice is said twice. */
  const setNotice = (message: string) => {
    setNoticeNow('');
    if (message) requestAnimationFrame(() => setNoticeNow(message));
  };
  /** When the form last closed: a tap within `DOUBLE_TAP_MS` of it is the same tap, not Add. */
  const formClosedAt = useRef<number | undefined>(undefined);
  const [form, setForm] = useState<{
    name: string;
    type: TrackingType | '';
    error: string | null;
    pending: boolean;
    /** Create was pressed: the name's problems show from then on, not on the first keystroke. */
    tried: boolean;
    /**
     * The last Create got no answer (a failure that is not the name's): its write may have landed,
     * so an `existed` answer to the same name and type is that first try's, not someone else's.
     */
    unanswered?: { name: string; type: TrackingType };
  } | null>(null);
  const { begin, isCurrent, cancel } = useAttempt();
  const createRef = useRef<HTMLButtonElement>(null);

  // A closed sheet drops the form, its message and any create in flight; the ticks and items made
  // stay. On the `open` prop, so Add's own close counts too. Adjusted during render (React's pattern
  // for deriving state from a prop; the movement picker does the same).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setForm(null);
      setNoticeNow('');
    }
  }
  const typeRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const byId = new Map(options.map((option) => [option.publicId, option] as const));
  const pickedNames = selected.flatMap((id) => {
    const option = byId.get(id);
    return option ? [option.name] : [];
  });
  const full = selected.length >= room;
  /**
   * The household has `MAX_HOUSEHOLD_ITEMS` of its own (7b-ii, plan §Caps): said before any typing,
   * and Create stays only for a name that selects an existing item (never capped, invariant 30).
   * Counted from the options, which hold every item the household made, those made here included.
   */
  const householdFull = householdIsFull(options);
  /** The household-full line, unless the footer is saying it already. */
  const householdFullShown = householdFull && notice !== COPY.householdFull;
  const householdFullLine = householdFullShown ? (
    <p id={HOUSEHOLD_FULL_ID} className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
      {COPY.householdFull}
    </p>
  ) : null;

  const toggle = (option: MovementOptionDTO, via?: 'tap' | 'enter') => {
    if (!selected.includes(option.publicId) && full) {
      setNotice(capText(MAX_WORKOUT_ITEMS));
      return;
    }
    // A tapped row says its own state; Enter ticks a row that has no focus, so it is said here.
    setNotice(via === 'enter' ? selectedText(option.name) : '');
    onToggle(option);
  };

  /** Ticks `option` unless it is ticked already; `false` when the workout is full. */
  const select = (option: MovementOptionDTO) => {
    if (selected.includes(option.publicId)) return true;
    if (full) return false;
    onToggle(option);
    return true;
  };

  // ── The new-item form ───────────────────────────────────────────────────────────────────────────
  const cleaned = form ? cleanName(form.name) : '';
  /** The item this name already is, by the picker's own rule (`listedAs`: name, alias or short form). */
  const existing = form && cleaned ? listedAs(options, cleaned) : undefined;
  const nameIssue = !form
    ? null
    : !cleaned
      ? COPY.giveAName
      : !existing
        ? // The contract's own rules, a name that folds to nothing ("S") included (C8).
          (newItemSchema.shape.name.safeParse(cleaned).error?.issues[0]?.message ?? null)
        : null;
  const canCreate =
    !!form &&
    !form.pending &&
    !!cleaned &&
    (existing ? true : !householdFull && !nameIssue && !!form.type);

  const openForm = (typed: string) => {
    setNotice('');
    cancel();
    flushSync(() => setForm({ name: typed, type: '', error: null, pending: false, tried: false }));
    // In the same tap, so a phone raises the keyboard (program-builder trap).
    nameRef.current?.focus();
  };

  /**
   * Back to the list, with focus on `focusId`'s row (the item just made or selected, scrolled into
   * view) or on the create button (Cancel). The control that had focus unmounts with the form, and
   * the sheet itself has no visible focus ring.
   */
  const closeForm = (at: number, focusId?: string) => {
    // Cancel: an answer still in flight no longer belongs to the screen, nor does its message.
    if (!focusId) {
      cancel();
      setNoticeNow('');
    }
    // The tap that closed it: a second tap within `DOUBLE_TAP_MS` lands on what took its place.
    formClosedAt.current = at;
    flushSync(() => setForm(null));
    const target =
      (focusId && document.querySelector<HTMLElement>(`[${OPTION_ID_ATTR}="${focusId}"]`)) ||
      document.getElementById(PICKER_CREATE_ID);
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest' });
  };

  /**
   * A Create that cannot run says why: the name's problems show from now on, and focus moves to
   * what is missing (the name first).
   */
  const showMissing = () => {
    if (!form) return;
    setForm({ ...form, tried: true });
    (!cleaned || nameIssue ? nameRef.current : typeRef.current)?.focus();
  };

  /**
   * What to say once an item is chosen: selected, or not ticked because the workout is full. An
   * item that `existed` but was not `listed` is not "in the list", and nothing new was made.
   */
  const said = (ticked: boolean, option: MovementOptionDTO, existed: boolean, listed = true) => {
    if (!ticked) return notTickedText(option.name);
    if (!existed) return createdText(option.name);
    const type = TRACKING_TYPE_LABELS[option.trackingType];
    return listed ? existedText(option.name, type) : existedUnlistedText(option.name, type);
  };

  /** `at` is the Create tap's `event.timeStamp`. */
  async function create(at: number) {
    if (!form || form.pending) return;
    // Full: nothing is missing, and nothing new can be made. Focus stays on Create.
    if (!canCreate && householdFull && cleaned && !existing) return setNotice(COPY.householdFull);
    if (!canCreate) return showMissing();
    if (existing) {
      setNotice(said(select(existing), existing, true));
      return closeForm(at, existing.publicId);
    }
    const trackingType = form.type as TrackingType;
    const mine = begin();
    setForm({ ...form, pending: true, error: null });
    setNoticeNow('');
    const result = await newItem({ name: cleaned, trackingType });
    const known = result.ok ? byId.get(result.itemPublicId) : undefined;
    // TODO(CAT-3 chunk R): an unlisted `existed` answer that is a BUILT-IN is built here as a custom
    // item with no unit, so it reads "Custom item" and its card drops the declared unit. Unreachable
    // while every built-in is listed (picker.ts); live once a row outside the list exists. The fix
    // needs the answer's owner and unit, or a re-read (7a-ii review; board, 2026-11-17).
    const made = (answer: Extract<typeof result, { ok: true }>): MovementOptionDTO => ({
      publicId: answer.itemPublicId,
      // The stored name: the existing item's own when `existed`, the cleaned typed one otherwise.
      name: answer.name,
      trackingType: answer.trackingType,
      owner: 'household',
      unitDefault: null,
      isBodyweight: false,
    });
    if (!isCurrent(mine)) {
      // Cancelled, closed or replaced by a newer form: leave the screen alone. The write may have
      // landed all the same (invariant 11), so a new item is still listed.
      if (result.ok && !known) onCreated(made(result));
      return;
    }
    if (!result.ok) {
      const refusal = newItemRefusal(result.reason);
      setForm(
        (now) =>
          now && {
            ...now,
            pending: false,
            error: refusal.field,
            tried: true,
            unanswered: refusal.field ? now.unanswered : { name: cleaned, type: trackingType },
          },
      );
      // A name refusal is the name's; a failure to reach the server is not, so it is not marked
      // on the field.
      if (refusal.footer) setNotice(refusal.footer);
      // A name refusal goes back to the name; a failure stays on Create, to try again, with no
      // keyboard raised for a name that was fine.
      (refusal.field ? nameRef.current : createRef.current)?.focus();
      return;
    }
    const option = known ?? made(result);
    if (!known) onCreated(option);
    // A retry whose first try landed: this person made it, with the type they chose. The ANSWER must
    // be that item too (its stored name and type are the item's own, contract C8): an item another
    // device made meanwhile, under another type or spelling, is someone else's.
    const ownRetry =
      !known &&
      form.unanswered?.name === cleaned &&
      form.unanswered.type === trackingType &&
      result.name === cleaned &&
      result.trackingType === trackingType;
    setNotice(said(select(option), option, result.existed && !ownRetry, !!known));
    closeForm(at, option.publicId);
  }

  const takeover = form
    ? {
        body: (
          <form
            id={FORM_ID}
            className="flex flex-col gap-4"
            aria-labelledby={`${FORM_ID}-title`}
            onSubmit={(event) => {
              event.preventDefault();
              void create(event.timeStamp);
            }}
          >
            <h3 id={`${FORM_ID}-title`} className="text-lg font-semibold">
              {COPY.formTitle}
            </h3>
            <div
              onKeyDown={(event) => {
                // Enter in the name moves on (to the type, or to "Select …"); it never creates.
                if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
                  event.preventDefault();
                  (typeRef.current ?? createRef.current)?.focus();
                }
              }}
            >
              <NameField
                ref={nameRef}
                id={NAME_ID}
                label={COPY.name}
                value={form.name}
                max={MOVEMENT_NAME_MAX}
                placeholder={COPY.namePlaceholder}
                autoCapitalize="words"
                enterKeyHint="next"
                error={form.error ?? (form.tried ? nameIssue : null)}
                onChange={(name) => {
                  setForm({ ...form, name, error: null });
                  setNoticeNow('');
                }}
              />
              {/* Not a refusal: the name is fine, and Create becomes "Select …". A polite status,
                  mounted empty, so a screen reader hears it when it appears. */}
              <p
                id={EXISTING_ID}
                role="status"
                className={existing ? `mt-1 text-sm ${NAME_WRAP_CLASS}` : 'h-0'}
              >
                {existing
                  ? alreadyListedText(existing.name, TRACKING_TYPE_LABELS[existing.trackingType])
                  : ''}
              </p>
            </div>
            {existing ? null : (
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={TYPE_ID}>{COPY.tracks}</FieldLabel>
                <select
                  ref={typeRef}
                  id={TYPE_ID}
                  value={form.type}
                  onChange={(event) => {
                    setForm({ ...form, type: event.target.value as TrackingType | '' });
                    setNoticeNow('');
                  }}
                  aria-describedby={TYPE_HINT_ID}
                  aria-invalid={(form.tried && !form.type) || undefined}
                  className={`${INPUT_CLASS} w-full`}
                >
                  <option value="" disabled>
                    {COPY.chooseType}
                  </option>
                  {TRACKING_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TRACKING_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                <p
                  id={TYPE_HINT_ID}
                  className={
                    form.tried && !form.type
                      ? 'text-destructive text-sm'
                      : 'text-muted-foreground text-sm'
                  }
                >
                  {form.type ? TRACKING_TYPE_EXAMPLES[form.type] : COPY.chooseTypeFirst}
                </p>
              </div>
            )}
            {existing ? null : (
              <p id={WARNING_ID} className={`text-sm ${NAME_WRAP_CLASS}`}>
                {newItemWarning(cleaned)}
              </p>
            )}
          </form>
        ),
        footer: (
          <div className="flex flex-col gap-2">
            {/* Seen, not only heard: a failure to reach the server leaves the form as it was. */}
            {notice ? <p className={`text-sm font-medium ${NAME_WRAP_CLASS}`}>{notice}</p> : null}
            {existing ? null : householdFullLine}
            <Button
              ref={createRef}
              type="submit"
              form={FORM_ID}
              size="lg"
              className={`h-auto w-full text-base whitespace-normal ${NAME_WRAP_CLASS} ${PENDING_CLASS}`}
              aria-disabled={!canCreate || undefined}
              aria-describedby={
                existing
                  ? EXISTING_ID
                  : [
                      householdFullShown ? HOUSEHOLD_FULL_ID : null,
                      form.type ? null : TYPE_HINT_ID,
                      WARNING_ID,
                    ]
                      .filter(Boolean)
                      .join(' ')
              }
            >
              {form.pending
                ? COPY.creating
                : existing
                  ? selectExistingText(existing.name)
                  : COPY.create}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full text-base"
              onClick={(event) => closeForm(event.timeStamp)}
            >
              {BUILDER_COPY.cancel}
            </Button>
          </div>
        ),
      }
    : null;

  return (
    <MovementPicker
      howTo={howTo}
      open={open}
      onOpenChange={(next) => {
        // A create in flight no longer belongs to the screen (the form itself goes on `open`).
        if (!next) cancel();
        onOpenChange(next);
      }}
      title={COPY.title}
      data={{ options }}
      alreadyIn={{ ids: inWorkout, label: COPY.alreadyIn }}
      returnFocusTo={returnFocusTo}
      onReturned={onReturned}
      multiple={{
        selected,
        onToggle: toggle,
        onCreate: openForm,
        createLabel: newItemLabel,
        // At the cap, "make it a new item" is not an offer the form can keep (7b-ii).
        noMatchHint: householdFull ? COPY.householdFull : COPY.noMatch,
        createDescribedBy: householdFullShown ? HOUSEHOLD_FULL_ID : undefined,
        notice,
        onQueryChange: () => setNoticeNow(''),
        searchLabel: COPY.searchLabel,
        searchPlaceholder: COPY.searchPlaceholder,
        takeover,
        footerNote: (
          <>
            {/* Seen as well as heard: a different type than the one chosen, the cap. */}
            {notice ? <p className={`text-sm font-medium ${NAME_WRAP_CLASS}`}>{notice}</p> : null}
            {/* One line, so the list keeps its room; the whole order is read with Add. */}
            {pickedNames.length ? (
              <p id={SUMMARY_ID} className="line-clamp-1 text-sm wrap-anywhere">
                {pickedText(pickedNames)}
              </p>
            ) : null}
            {householdFullLine}
            {full && notice !== capText(MAX_WORKOUT_ITEMS) ? (
              <p className="text-muted-foreground text-sm">{capText(MAX_WORKOUT_ITEMS)}</p>
            ) : null}
          </>
        ),
        footerAction: (
          <Button
            type="button"
            size="lg"
            className={`w-full text-base ${PENDING_CLASS}`}
            aria-disabled={selected.length === 0 || undefined}
            aria-describedby={pickedNames.length ? SUMMARY_ID : undefined}
            onClick={(event) => {
              // The form's last button sat here a moment ago: a double tap is not an Add.
              if (isSameTap(formClosedAt.current, event.timeStamp)) return;
              if (selected.length) onAdd();
            }}
          >
            {selected.length ? addItemsText(selected.length) : COPY.pickToAdd}
          </Button>
        ),
      }}
    />
  );
}
