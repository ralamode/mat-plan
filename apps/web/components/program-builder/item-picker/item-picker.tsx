'use client';

import {
  matchMovementOptions,
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

import { MovementPicker } from '@/components/movements/movement-picker';
import { Button } from '@/components/ui/button';
import { INPUT_CLASS } from '@/lib/constants';
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
  newItemWarning,
  PENDING_CLASS,
  pickedText,
  selectExistingText,
  TRACKING_TYPE_EXAMPLES,
} from '../builder-text';
import { FieldLabel } from '../field-label';
import { NameField } from '../name-field';
import { useAttempt } from '../use-attempt';

const FORM_ID = 'new-item-form';
const NAME_ID = 'new-item-name';
const TYPE_ID = 'new-item-type';
const TYPE_HINT_ID = 'new-item-type-hint';
const WARNING_ID = 'new-item-warning';

/**
 * The workout editor's item picker (FAM-1 step 9; plan §8 "Item picker"; the prototype's `vPicker2`):
 * the shared movement picker in its multi-select mode, with "Add n items" and a new-item form.
 *
 * - **Its state is the editor's.** The selection (in pick order) and the items made here are held by
 *   the editor, so a Close or a back swipe keeps the ticks _(maintainer, 2026-11-16)_ and a reopened
 *   picker lists what was just made.
 * - **The new-item form takes over the sheet** _(maintainer, 2026-11-16)_: search and list hide,
 *   Create and Cancel are pinned where a thumb reaches with the keyboard up.
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
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<{
    name: string;
    type: TrackingType | '';
    error: string | null;
    pending: boolean;
  } | null>(null);
  const { begin, isCurrent } = useAttempt();
  const typeRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const byId = new Map(options.map((option) => [option.publicId, option] as const));
  const pickedNames = selected.flatMap((id) => {
    const option = byId.get(id);
    return option ? [option.name] : [];
  });
  const full = selected.length >= room;

  const toggle = (option: MovementOptionDTO) => {
    if (!selected.includes(option.publicId) && full) {
      setNotice(capText(MAX_WORKOUT_ITEMS));
      return;
    }
    setNotice('');
    onToggle(option);
  };

  const select = (option: MovementOptionDTO) => {
    if (!selected.includes(option.publicId) && !full) onToggle(option);
  };

  // ── The new-item form ───────────────────────────────────────────────────────────────────────────
  const cleaned = form ? cleanName(form.name) : '';
  const match = form
    ? matchMovementOptions(
        options.map((option) => ({
          name: option.name,
          isCatalog: option.owner === 'catalog',
          aliases: option.owner === 'catalog' ? option.aliases : [],
          option,
        })),
        cleaned,
      )
    : null;
  /** The item this name already is, by the picker's rule. */
  const existing = match && (match.exact || match.aliasHit) ? match.matches[0]?.option : undefined;
  const nameIssue =
    form && cleaned && !existing
      ? (() => {
          const parsed = newItemSchema.shape.name.safeParse(cleaned);
          return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
        })()
      : null;
  const canCreate =
    !!form && !form.pending && !!cleaned && (existing ? true : !nameIssue && !!form.type);

  const openForm = (typed: string) => {
    flushSync(() => setForm({ name: typed, type: '', error: null, pending: false }));
    // In the same tap, so a phone raises the keyboard (program-builder trap).
    nameRef.current?.focus();
  };

  const closeForm = () => setForm(null);

  async function create() {
    if (!form || !canCreate) return;
    if (existing) {
      select(existing);
      setNotice(existedText(existing.name, TRACKING_TYPE_LABELS[existing.trackingType]));
      return closeForm();
    }
    const trackingType = form.type as TrackingType;
    const mine = begin();
    setForm({ ...form, pending: true, error: null });
    const result = await newItem({ name: cleaned, trackingType });
    if (!isCurrent(mine)) return;
    if (!result.ok) {
      setForm(
        (now) =>
          now && {
            ...now,
            pending: false,
            error: result.reason === 'invalid' ? COPY.refused : COPY.failed,
          },
      );
      nameRef.current?.focus();
      return;
    }
    const known = byId.get(result.itemPublicId);
    const option: MovementOptionDTO = known ?? {
      publicId: result.itemPublicId,
      name: cleaned,
      trackingType: result.trackingType,
      owner: 'household',
      unitDefault: null,
      isBodyweight: false,
    };
    if (!known) onCreated(option);
    select(option);
    setNotice(
      result.existed
        ? existedText(option.name, TRACKING_TYPE_LABELS[option.trackingType])
        : createdText(option.name),
    );
    closeForm();
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
                // Enter in the name moves on to the type; it never creates.
                if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
                  event.preventDefault();
                  typeRef.current?.focus();
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
                error={
                  form.error ??
                  (existing
                    ? alreadyListedText(existing.name, TRACKING_TYPE_LABELS[existing.trackingType])
                    : nameIssue)
                }
                onChange={(name) => setForm({ ...form, name, error: null })}
              />
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
                <p id={TYPE_HINT_ID} className="text-muted-foreground text-sm">
                  {form.type ? TRACKING_TYPE_EXAMPLES[form.type] : COPY.chooseTypeFirst}
                </p>
              </div>
            )}
            {existing ? null : (
              <p id={WARNING_ID} className="text-sm">
                {newItemWarning(cleaned)}
              </p>
            )}
          </form>
        ),
        footer: (
          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              form={FORM_ID}
              size="lg"
              className={`w-full text-base ${PENDING_CLASS}`}
              aria-disabled={!canCreate || undefined}
              aria-describedby={existing ? undefined : WARNING_ID}
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
              onClick={closeForm}
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
      onOpenChange={onOpenChange}
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
        takeover,
        footerAction: (
          <div className="flex flex-col gap-2">
            {pickedNames.length ? <p className="text-sm">{pickedText(pickedNames)}</p> : null}
            {full ? (
              <p className="text-muted-foreground text-sm">{capText(MAX_WORKOUT_ITEMS)}</p>
            ) : null}
            <Button
              type="button"
              size="lg"
              className={`w-full text-base ${PENDING_CLASS}`}
              aria-disabled={selected.length === 0 || undefined}
              onClick={() => {
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
