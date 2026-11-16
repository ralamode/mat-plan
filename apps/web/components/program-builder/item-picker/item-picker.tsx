'use client';

import {
  MAX_WORKOUT_ITEMS,
  MOVEMENT_NAME_MAX,
  movementNameKey,
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
import { DOUBLE_TAP_MS, useAttempt } from '../use-attempt';

/**
 * The item's stored name from `newItem`'s answer. ⚠️ Contract change C8 (roadmap thread, 2026-11-16)
 * adds `name` to every success: the existing item's own name when `existed`, the cleaned typed name
 * otherwise. Until C8 is on main the answer has no `name`, so it is read defensively here, in ONE
 * place; once C8 lands this becomes `result.name`.
 */
function storedName(result: object, typed: string): string {
  return 'name' in result && typeof result.name === 'string' ? result.name : typed;
}

const FORM_ID = 'new-item-form';
const NAME_ID = 'new-item-name';
const TYPE_ID = 'new-item-type';
const TYPE_HINT_ID = 'new-item-type-hint';
const WARNING_ID = 'new-item-warning';
const EXISTING_ID = 'new-item-existing';
const SUMMARY_ID = 'item-picker-picked';

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
 * - **A name already in the list selects that item**, by the picker's own rule
 *   (`matchMovementOptions`: `movementNameKey`, aliases): typing "RDL" never makes a second Romanian
 *   Deadlift. The server answers `existed` for the same reason, and a retry that landed reads the
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
  options,
  selected,
  onToggle,
  inWorkout,
  room,
  newItem,
  onCreated,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: RefObject<HTMLElement | null>;
  /** Every item the household can add, including those made here. */
  options: readonly MovementOptionDTO[];
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
}) {
  const [notice, setNoticeNow] = useState('');
  /** Cleared first and set a frame later, so the same message twice is said twice. */
  const setNotice = (message: string) => {
    setNoticeNow('');
    if (message) requestAnimationFrame(() => setNoticeNow(message));
  };
  /** When the form last closed: a tap within `DOUBLE_TAP_MS` of it is the same tap, not Add. */
  const formClosedAt = useRef(0);
  const [form, setForm] = useState<{
    name: string;
    type: TrackingType | '';
    error: string | null;
    pending: boolean;
    /** Create was pressed: the name's problems show from then on, not on the first keystroke. */
    tried: boolean;
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
  /** The item this name already is, by the picker's own rule (`listedAs`: name or alias). */
  const existing = form && cleaned ? listedAs(options, cleaned) : undefined;
  const nameIssue =
    form && cleaned && !existing
      ? (() => {
          const parsed = newItemSchema.shape.name.safeParse(cleaned);
          if (!parsed.success) return parsed.error.issues[0]?.message ?? null;
          // A name the "same movement" rule folds to nothing ("S") could be added twice; contract
          // C8 refuses it in `newItemSchema`, and until then this is that rule.
          return movementNameKey(cleaned) === '' ? COPY.giveAName : null;
        })()
      : null;
  const canCreate =
    !!form && !form.pending && !!cleaned && (existing ? true : !nameIssue && !!form.type);

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
  const closeForm = (focusId?: string) => {
    // Cancel: an answer still in flight no longer belongs to the screen.
    if (!focusId) cancel();
    // The frame's time is on the same clock as a tap's `event.timeStamp`.
    requestAnimationFrame((time) => {
      formClosedAt.current = time;
    });
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

  /** What to say once an item is chosen: selected, or not ticked because the workout is full. */
  const said = (ticked: boolean, option: MovementOptionDTO, existed: boolean) =>
    !ticked
      ? notTickedText(option.name)
      : existed
        ? existedText(option.name, TRACKING_TYPE_LABELS[option.trackingType])
        : createdText(option.name);

  async function create() {
    if (!form || form.pending) return;
    if (!canCreate) return showMissing();
    if (existing) {
      setNotice(said(select(existing), existing, true));
      return closeForm(existing.publicId);
    }
    const trackingType = form.type as TrackingType;
    const mine = begin();
    setForm({ ...form, pending: true, error: null });
    const result = await newItem({ name: cleaned, trackingType });
    const known = result.ok ? byId.get(result.itemPublicId) : undefined;
    const made = (answer: Extract<typeof result, { ok: true }>): MovementOptionDTO => ({
      publicId: answer.itemPublicId,
      name: storedName(answer, cleaned),
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
      setForm((now) => now && { ...now, pending: false, error: refusal.field, tried: true });
      // A name refusal is the name's; a failure to reach the server is not, so it is not marked
      // on the field.
      if (refusal.footer) setNotice(refusal.footer);
      nameRef.current?.focus();
      return;
    }
    const option = known ?? made(result);
    if (!known) onCreated(option);
    setNotice(said(select(option), option, result.existed));
    closeForm(option.publicId);
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
              void create();
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
                onChange={(name) => setForm({ ...form, name, error: null })}
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
                  onChange={(event) =>
                    setForm({ ...form, type: event.target.value as TrackingType | '' })
                  }
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
            <Button
              ref={createRef}
              type="submit"
              form={FORM_ID}
              size="lg"
              className={`h-auto w-full text-base whitespace-normal ${NAME_WRAP_CLASS} ${PENDING_CLASS}`}
              aria-disabled={!canCreate || undefined}
              aria-describedby={
                existing ? EXISTING_ID : form.type ? WARNING_ID : `${TYPE_HINT_ID} ${WARNING_ID}`
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
              onClick={() => closeForm()}
            >
              {BUILDER_COPY.cancel}
            </Button>
          </div>
        ),
      }
    : null;

  return (
    <MovementPicker
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
      multiple={{
        selected,
        onToggle: toggle,
        onCreate: openForm,
        createLabel: newItemLabel,
        noMatchHint: COPY.noMatch,
        describe: (option) => TRACKING_TYPE_LABELS[option.trackingType],
        notice,
        onQueryChange: () => setNoticeNow(''),
        searchLabel: COPY.searchLabel,
        searchPlaceholder: COPY.searchPlaceholder,
        takeover,
        footerAction: (
          <div className="flex flex-col gap-2">
            {/* Seen as well as heard: a different type than the one chosen, the cap. */}
            {notice ? <p className={`text-sm font-medium ${NAME_WRAP_CLASS}`}>{notice}</p> : null}
            {/* At most two lines, so the list keeps its room; the whole order is read with Add. */}
            {pickedNames.length ? (
              <p id={SUMMARY_ID} className="line-clamp-2 text-sm wrap-anywhere">
                {pickedText(pickedNames)}
              </p>
            ) : null}
            {full && notice !== capText(MAX_WORKOUT_ITEMS) ? (
              <p className="text-muted-foreground text-sm">{capText(MAX_WORKOUT_ITEMS)}</p>
            ) : null}
            <Button
              type="button"
              size="lg"
              className={`w-full text-base ${PENDING_CLASS}`}
              aria-disabled={selected.length === 0 || undefined}
              aria-describedby={pickedNames.length ? SUMMARY_ID : undefined}
              onClick={(event) => {
                // The form's last button sat here a moment ago: a double tap is not an Add.
                if (event.timeStamp - formClosedAt.current < DOUBLE_TAP_MS) return;
                if (selected.length) onAdd();
              }}
            >
              {selected.length ? addItemsText(selected.length) : COPY.pickToAdd}
            </Button>
          </div>
        ),
      }}
    />
  );
}
