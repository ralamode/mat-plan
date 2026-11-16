'use client';

import {
  FREE_TEXT_NOTE_MAX,
  MAX_WORKOUT_ITEMS,
  newId,
  PROGRAM_REFUSAL,
  WORKOUT_NAME_MAX,
  type ProgramActions,
  type ProgramListEntry,
  supersetLabels,
  type Unit,
  type WorkoutDraft,
  type WorkoutDraftItem,
} from '@mat-plan/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@/components/ui/button';
import {
  CTA_CLASS,
  FOCUS_TARGET_CLASS,
  NAME_WRAP_CLASS,
  NAV_LINK_CLASS,
  SAVING_LABEL,
} from '@/lib/constants';
import type { MovementOptionDTO, MovementPickerData } from '@/lib/movements/movement-option';
import { moveDown, moveUp } from '@/lib/routine/editor';

import {
  addedText,
  capText,
  BUILDER_COPY,
  EDITOR_COPY,
  ITEM_PICKER_COPY,
  fieldsToFixText,
  movedText,
  PENDING_CLASS,
  linkedText,
  removedText,
  saveRefusal,
  supersetLetterOf,
  undoneText,
  unlinkedText,
  unitChangedText,
  usedByText,
  type MoveDirection,
  type SupersetChange,
} from './builder-text';
import {
  fieldId,
  readDraft,
  cardHeadingId,
  newCard,
  toCards,
  type EditorCard,
  type EditorError,
  type EditorField,
} from './editor-draft';
import { ItemCard, type CardControl, type CardLink } from './item-card';
import { ItemPicker } from './item-picker/item-picker';
import { NameField } from './name-field';
import { programPath } from './routes';
import { StatusLine, useStatusLine } from './status-line';
import { linkWithNext, normalizeSupersets, unlinkFromNext } from './supersets';
import { focusField, holdUnderThumb, isSameTap, useAttempt } from './use-attempt';

/**
 * The workout editor: one screen of item cards and one Save (FAM-1 step 8; plan §8 "Workout
 * editor"; the prototype's `vWorkout`), with superset links and their rest (8b); 9 adds the item
 * picker ("+ Add items").
 *
 * **The screen is the page.** Its route is thin, so the screen renders the page's `<h1>` and its
 * top-level blocks, inside the shell's one `<main>`. Its `<form>` is unnamed, so it adds no landmark.
 *
 * - `draft` is read **once**, when the editor opens: what it loaded, what "changed" compares with,
 *   and the ids Save sends (its `workoutClientId`, so a retried Save replays the same attempt). A
 *   later `draft` from a refreshed page does not move them.
 * - `program` names the program in the back link and says who a change applies to. **Optional**:
 *   the preview route does not pass it yet (the maintainer kept the harness as it is, 2026-11-16);
 *   7b's page must (`owed.test.ts`). Without it the link reads "← Program" and the line is hidden.
 * - `picker` is the item picker's data (step 9).
 *
 * Decided at step 8 _(maintainer, 2026-11-16)_: a superset is kept well formed after every move
 * and remove (`normalizeSupersets`); Remove has no undo but Cancel, as the prototype; leaving with
 * changes asks first; Reps are a whole number; Sets are required. Enter never saves: Save is the
 * button.
 */
export type WorkoutEditorScreenProps = {
  draft: WorkoutDraft;
  picker: MovementPickerData;
  actions: ProgramActions;
  program?: ProgramListEntry;
};

const HEADING_ID = 'workout-editor-heading';
const ITEMS_HEADING_ID = 'workout-items';
const SAVE_ALERT_ID = 'workout-save-alert';
const DISCARD_QUESTION_ID = 'workout-discard-question';

/**
 * Everything typed, as one comparable value: the screen is "changed" when it differs. Group keys
 * are compared by their order of first appearance, so a key minted by an unlink and relink is not
 * a change by itself.
 */
const snapshot = (name: string, description: string, cards: readonly EditorCard[]) => {
  const keys = new Map<string, number>();
  const plain = cards.map((card) => {
    const superset = card.item.superset;
    if (!superset) return card;
    if (!keys.has(superset.group)) keys.set(superset.group, keys.size);
    return {
      ...card,
      item: { ...card.item, superset: { ...superset, group: keys.get(superset.group) } },
    };
  });
  return JSON.stringify([name, description, plain]);
};

export function WorkoutEditorScreen({ draft, picker, actions, program }: WorkoutEditorScreenProps) {
  const router = useRouter();
  // The draft as opened, held for the life of the screen.
  const [loaded] = useState(() => {
    const cards = toCards(draft);
    return { draft, cards, snapshot: snapshot(draft.name, draft.description ?? '', cards) };
  });
  const [name, setName] = useState(loaded.draft.name);
  const [description, setDescription] = useState(loaded.draft.description ?? '');
  const [cards, setCards] = useState(loaded.cards);
  const [errors, setErrors] = useState<EditorError[]>([]);
  const [pending, setPending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { status, report } = useStatusLine();
  const { begin, isCurrent } = useAttempt();

  const lastRemoveAt = useRef(0);
  /** The last link tap per card: a second one on the same card is the same tap. */
  const lastLinkAt = useRef(new Map<string, number>());
  /**
   * The last link or unlink: on which card, the cards before it, and the cards it made. The
   * opposite tap on the same card, with nothing else changed in between (`cards` is still
   * `after`, by identity: every other edit makes a new array), puts `before` back exactly. Any
   * other edit leaves it stale, so it can never bring back a rest over one typed since.
   */
  const lastToggle = useRef<{
    id: string;
    before: EditorCard[];
    after: EditorCard[];
  } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  /** What asked "Discard?": Keep editing returns there. */
  const leftFrom = useRef<HTMLElement | null>(null);
  const itemsHeadingRef = useRef<HTMLHeadingElement>(null);

  // ── The item picker (step 9) ─────────────────────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Ticked items, in pick order. Kept across a Close until Add _(maintainer, 2026-11-16)_. */
  const [picked, setPicked] = useState<string[]>([]);
  /** Items made in the picker, so a reopened picker lists them. */
  const [made, setMade] = useState<MovementOptionDTO[]>([]);
  const addItemsRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes when the picker closes: "+ Add items", or the first card it added. */
  const pickerReturn = useRef<HTMLElement | null>(null);
  // An item made here is kept until the route's own list has it (a reload, or the preview's fake,
  // which adds it at once); then it is listed once, from there.
  const listed = new Set(picker.options.map((option) => option.publicId));
  const pickerOptions = [
    ...picker.options,
    ...made.filter((option) => !listed.has(option.publicId)),
  ];

  const back = programPath(loaded.draft.programPublicId);
  const dirty = snapshot(name, description, cards) !== loaded.snapshot;
  const labels = supersetLabels(cards.map((card) => card.item));
  const groupOf = (index: number) => cards[index]?.item.superset?.group ?? null;
  /** The card's link to the next one, or `null` on the last card. */
  const linkOf = (index: number): CardLink | null => {
    const next = cards[index + 1];
    if (!next) return null;
    const [a, b] = [groupOf(index), groupOf(index + 1)];
    const joins =
      a !== null && b !== null && a !== b
        ? ([supersetLetterOf(labels[index]!), supersetLetterOf(labels[index + 1]!)] as const)
        : null;
    return { linked: a !== null && a === b, joins, next: next.item.itemName };
  };
  /** The superset's letter, on its last card only: where the group's rest is edited. */
  const restLetterOf = (index: number) => {
    const group = groupOf(index);
    return group !== null && groupOf(index + 1) !== group
      ? labels[index]
        ? supersetLetterOf(labels[index]!)
        : null
      : null;
  };

  // The browser's own "leave this page?" while there are changes. The App Router has no hook for
  // its own navigations, so Cancel and the back link ask inline instead (guide invariant 15).
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending]);

  const control = (card: string, which: CardControl) => controls.current.get(`${card}:${which}`);
  const errorsOf = (card: string | null) => errors.filter((error) => error.card === card);
  const errorOn = (field: EditorField) =>
    errors.find((error) => error.card === null && error.field === field)?.message ?? null;

  /** Drops refusals once their field is edited; the bar's alert goes with the last one. */
  const clearErrors = (keep: (error: EditorError) => boolean) => {
    const left = errors.filter(keep);
    if (left.length === errors.length) return;
    setErrors(left);
    if (!left.length && status.tone === 'alert') report('');
  };
  const clearError = (card: string | null, field: EditorField) =>
    clearErrors((error) => !(error.card === card && error.field === field));

  /** The next edit clears a status message, so the bar does not stay tall with an old one. */
  const quiet = () => {
    if (status.message && status.tone === 'status') report('');
  };

  const updateCard = (id: string, patch: Partial<EditorCard>) =>
    setCards((all) =>
      all.map((card) => (card.item.prescriptionClientId === id ? { ...card, ...patch } : card)),
    );

  /** Re-forms the supersets after a move or a remove, and says what changed. */
  const settle = (next: EditorCard[]): { settled: EditorCard[]; change: SupersetChange } => {
    const result = normalizeSupersets(next.map((card) => card.item));
    const settled = next.map((card, index) => ({ ...card, item: result.items[index]! }));
    const change = {
      ended: result.ended,
      left: result.left.map((index) => next[index]!.item.itemName),
      droppedRests: result.droppedRests.length,
    };
    return { settled, change };
  };

  function move(index: number, direction: MoveDirection) {
    const card = cards[index]!;
    if (direction === 'up' ? index === 0 : index === cards.length - 1) {
      report(direction === 'up' ? EDITOR_COPY.alreadyFirst : EDITOR_COPY.alreadyLast);
      return;
    }
    const { settled, change } = settle(
      direction === 'up' ? moveUp(cards, index) : moveDown(cards, index),
    );
    holdCard(card.item.prescriptionClientId, direction, settled);
    report(movedText(card.item.itemName, direction, change));
  }

  /**
   * Puts `next` on screen and keeps the tapped control focused and where the thumb is, so a second
   * tap lands on the same control.
   */
  function holdCard(id: string, which: CardControl, next: EditorCard[]) {
    holdUnderThumb(
      () => control(id, which),
      () => setCards(next),
      barRef.current,
    );
  }

  /** Links the card at `index` with the next, or unlinks them. `at` is the tap's time. */
  function toggleLink(index: number, at: number) {
    const first = cards[index]!;
    const second = cards[index + 1]!;
    const firstId = first.item.prescriptionClientId;
    const last = lastLinkAt.current.get(firstId);
    if (isSameTap(last, at)) return;
    lastLinkAt.current.set(firstId, at);
    const a = first.item.superset?.group ?? null;
    const b = second.item.superset?.group ?? null;
    const unlinking = a !== null && a === b;

    // The opposite of the last tap, on the same card, with nothing changed since: undo it.
    const undo = lastToggle.current;
    if (undo && undo.id === firstId && undo.after === cards) {
      lastToggle.current = null;
      holdCard(firstId, 'link', undo.before);
      report(undoneText(!unlinking));
      return;
    }

    const items = cards.map((card) => card.item);
    const letter = (i: number) => (labels[i] ? supersetLetterOf(labels[i]!) : '');
    const settled = (out: readonly WorkoutDraftItem[]) => {
      const next = withItems(out);
      lastToggle.current = { id: firstId, before: cards, after: next };
      holdCard(firstId, 'link', next);
      return supersetLabels(out);
    };

    if (unlinking) {
      const result = unlinkFromNext(items, index);
      const after = settled(result.items);
      const sides = [index, index + 1].filter((i) => result.items[i]!.superset);
      const size =
        sides.length === 1
          ? result.items.filter(
              (item) => item.superset?.group === result.items[sides[0]!]!.superset!.group,
            ).length
          : null;
      report(
        unlinkedText({
          letter: sides.length === 1 ? supersetLetterOf(after[sides[0]!]!) : letter(index),
          ended: result.ended,
          size,
          droppedRest: result.droppedRest,
        }),
      );
      return;
    }

    const result = linkWithNext(items, index);
    const after = settled(result.items);
    const group = result.items[index]!.superset!.group;
    report(
      linkedText({
        letter: supersetLetterOf(after[index]!),
        joined: result.merged ? 'groups' : a || b ? 'one' : 'pair',
        size: result.items.filter((item) => item.superset?.group === group).length,
        from: result.merged ? [letter(index), letter(index + 1)] : null,
        dropped: result.droppedRest,
      }),
    );
  }

  const withItems = (out: readonly WorkoutDraftItem[]) =>
    cards.map((card, i) => ({ ...card, item: out[i]! }));

  /**
   * Adds a card per ticked item, in pick order, with no numbers (`newCard`), and closes the picker
   * with focus on the first new card's heading.
   */
  function addPicked() {
    const byId = new Map(pickerOptions.map((option) => [option.publicId, option] as const));
    const added = picked.flatMap((id) => {
      const option = byId.get(id);
      return option ? [newCard(option, newId())] : [];
    });
    if (!added.length) return;
    flushSync(() => {
      setCards((all) => [...all, ...added]);
      setPicked([]);
    });
    pickerReturn.current = document.getElementById(
      cardHeadingId(added[0]!.item.prescriptionClientId),
    );
    setPickerOpen(false);
    quiet();
    report(addedText(added.length));
  }

  /** The group's rest, typed on its last card. */
  function changeRest(id: string, value: string) {
    setCards((all) =>
      all.map((card) =>
        card.item.prescriptionClientId === id
          ? { ...card, item: { ...card.item, restAfter: value === '' ? null : value } }
          : card,
      ),
    );
    clearError(id, 'rest');
    quiet();
  }

  /** `at` is the tap's `event.timeStamp`. */
  function remove(index: number, at: number) {
    // A double tap lands on the next card's Remove, which slides up under the thumb.
    if (isSameTap(lastRemoveAt.current || undefined, at)) return;
    lastRemoveAt.current = at;
    const card = cards[index]!;
    const neighbour = cards[index + 1] ?? cards[index - 1];
    const rest = cards.filter((_, i) => i !== index);
    // The group's rest was on the removed card: it passes to the group's new last member.
    const group = card.item.superset?.group;
    if (card.item.restAfter && group) {
      const heir = rest.findLastIndex((other) => other.item.superset?.group === group);
      if (heir >= 0) {
        rest[heir] = {
          ...rest[heir]!,
          item: { ...rest[heir]!.item, restAfter: card.item.restAfter },
        };
      }
    }
    const { settled, change } = settle(rest);
    flushSync(() => setCards(settled));
    const target = neighbour ? control(neighbour.item.prescriptionClientId, 'remove') : null;
    (target ?? itemsHeadingRef.current)?.focus();
    report(removedText(card.item.itemName, change));
  }

  function changeUnit(card: EditorCard, unit: Unit) {
    const typed = card.value.trim();
    updateCard(card.item.prescriptionClientId, { unit });
    clearError(card.item.prescriptionClientId, 'value');
    quiet();
    if (typed && card.unit && card.unit !== unit && Number.isFinite(Number(typed))) {
      report(unitChangedText(card.item.itemName, Number(typed), card.unit, unit));
    }
  }

  /** Shows the refusals, says `message` in the bar, and focuses the first refused field. */
  function refuse(found: EditorError[], message: string) {
    flushSync(() => setErrors(found));
    report(message, 'alert');
    const first = found[0];
    if (first) focusField(document.getElementById(fieldId(first.card, first.field)));
  }

  async function save() {
    if (pending) return;
    const read = readDraft(loaded.draft, { name, description, cards });
    if (!read.ok) {
      if (!read.errors.length) return refuse([], saveRefusal(PROGRAM_REFUSAL.invalid));
      const nameOnly = read.errors.length === 1 && read.errors[0]!.field === 'name';
      refuse(read.errors, nameOnly ? read.errors[0]!.message : fieldsToFixText(read.errors.length));
      return;
    }
    const mine = begin();
    setPending(true);
    report('');
    const result = await actions.saveWorkout(read.draft);
    if (!isCurrent(mine)) return;
    // `pending` stays set on success: the page changes, and Save must not read as ready again.
    if (result.ok) return router.push(back);
    setPending(false);
    const message = saveRefusal(result.reason);
    refuse(
      result.reason === PROGRAM_REFUSAL.name_taken ? [{ card: null, field: 'name', message }] : [],
      message,
    );
  }

  function leave(from: HTMLElement | null) {
    if (!dirty) return router.push(back);
    leftFrom.current = from;
    report('');
    flushSync(() => setLeaving(true));
    keepEditingRef.current?.focus();
  }

  function keepEditing() {
    flushSync(() => setLeaving(false));
    (leftFrom.current?.isConnected ? leftFrom.current : cancelRef.current)?.focus();
  }

  /**
   * Enter in a field never submits: a half-built workout must not save from the keyboard. It
   * closes the keyboard instead, which is what the phone's "Done" key promises.
   */
  const holdEnter = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Enter' && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      event.preventDefault();
      target.blur();
    }
    if (event.key === 'Escape' && leaving) keepEditing();
  };

  return (
    <>
      <form
        className="flex flex-col gap-6 [&_:is(input,select,textarea,button,a)]:scroll-mb-40"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onKeyDown={holdEnter}
        noValidate
      >
        <div className="flex flex-col gap-2">
          <Link
            href={back}
            className={NAV_LINK_CLASS}
            onClick={(event) => {
              // A new tab (cmd, ctrl or shift) leaves this one as it is.
              if (!dirty || event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              leave(event.currentTarget);
            }}
          >
            {program ? (
              <>
                <span aria-hidden>← </span>
                <span className={NAME_WRAP_CLASS}>{program.name}</span>
              </>
            ) : (
              EDITOR_COPY.backToProgram
            )}
          </Link>
          <h1 id={HEADING_ID} className="text-2xl font-semibold tracking-tight">
            {loaded.draft.workoutPublicId ? EDITOR_COPY.editWorkout : EDITOR_COPY.newWorkout}
          </h1>
          {program ? (
            <p className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
              {usedByText(program.athletes)}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <NameField
            id={fieldId(null, 'name')}
            label={EDITOR_COPY.workoutName}
            value={name}
            max={WORKOUT_NAME_MAX}
            placeholder={EDITOR_COPY.workoutNamePlaceholder}
            error={errorOn('name')}
            announce={false}
            onChange={(value) => {
              setName(value);
              quiet();
              clearError(null, 'name');
            }}
          />
          <NameField
            id={fieldId(null, 'description')}
            label={EDITOR_COPY.description}
            value={description}
            max={FREE_TEXT_NOTE_MAX}
            error={errorOn('description')}
            announce={false}
            optional
            multiline
            onChange={(value) => {
              setDescription(value);
              quiet();
              clearError(null, 'description');
            }}
          />
        </div>

        <section aria-labelledby={ITEMS_HEADING_ID} className="flex flex-col gap-3">
          <h2
            id={ITEMS_HEADING_ID}
            ref={itemsHeadingRef}
            tabIndex={-1}
            className={`rounded-sm text-lg font-semibold ${FOCUS_TARGET_CLASS}`}
          >
            {EDITOR_COPY.items}
          </h2>
          {cards.length > 1 ? (
            <p className="text-muted-foreground text-sm">{EDITOR_COPY.supersetIntro}</p>
          ) : null}
          {cards.length ? (
            <ol className="flex flex-col gap-3">
              {cards.map((card, index) => {
                const id = card.item.prescriptionClientId;
                return (
                  <ItemCard
                    key={id}
                    card={card}
                    label={labels[index] ?? null}
                    isFirst={index === 0}
                    isLast={index === cards.length - 1}
                    errors={errorsOf(id)}
                    controlRef={(which, node) => {
                      if (node) controls.current.set(`${id}:${which}`, node);
                      else controls.current.delete(`${id}:${which}`);
                    }}
                    onChange={(field, value) => {
                      updateCard(id, { [field]: value });
                      quiet();
                      clearError(id, field);
                    }}
                    onUnit={(unit) => changeUnit(card, unit)}
                    onMove={(direction) => move(index, direction)}
                    onRemove={(at) => remove(index, at)}
                    link={linkOf(index)}
                    onLink={(at) => toggleLink(index, at)}
                    restLetter={restLetterOf(index)}
                    onRest={(value) => changeRest(id, value)}
                  />
                );
              })}
            </ol>
          ) : (
            <p className="text-muted-foreground">{EDITOR_COPY.noItems}</p>
          )}
          {/* One instance after both branches, so the picker's return target never detaches. */}
          <Button
            ref={addItemsRef}
            type="button"
            variant={cards.length ? 'ghost' : 'outline'}
            className={CTA_CLASS}
            aria-disabled={cards.length >= MAX_WORKOUT_ITEMS || undefined}
            onClick={() => {
              // A full workout says so here, rather than opening a picker where every row refuses.
              if (cards.length >= MAX_WORKOUT_ITEMS) return report(capText(MAX_WORKOUT_ITEMS));
              pickerReturn.current = addItemsRef.current;
              setPickerOpen(true);
            }}
          >
            {ITEM_PICKER_COPY.open}
          </Button>
        </section>

        {/* The save bar: always in view on a phone, where Save and what it says are. The status
          line keeps two lines' height, which a link or unlink message never passes, so one
          does not push the bar up over a card. */}
        <div
          ref={barRef}
          className="bg-background sticky bottom-0 flex flex-col gap-2 border-t pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <StatusLine status={status} alertId={SAVE_ALERT_ID} className="min-h-14 justify-end" />
          {leaving ? (
            <div role="group" aria-labelledby={DISCARD_QUESTION_ID} className="flex flex-col gap-2">
              <p id={DISCARD_QUESTION_ID} className="text-sm font-medium">
                {EDITOR_COPY.discardQuestion}
              </p>
              <div className="flex gap-2">
                <Button
                  ref={keepEditingRef}
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={keepEditing}
                >
                  {EDITOR_COPY.keepEditing}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive flex-1"
                  onClick={() => router.push(back)}
                >
                  {EDITOR_COPY.discard}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                ref={cancelRef}
                type="button"
                variant="ghost"
                onClick={(event) => leave(event.currentTarget)}
              >
                {BUILDER_COPY.cancel}
              </Button>
              <Button
                type="submit"
                className={`flex-1 ${PENDING_CLASS}`}
                aria-disabled={pending || undefined}
                aria-describedby={SAVE_ALERT_ID}
              >
                {pending ? SAVING_LABEL : EDITOR_COPY.save}
              </Button>
            </div>
          )}
        </div>
      </form>
      {/* Outside the form: a portal's events bubble to React ancestors, and the picker's own form
        must not submit the workout. */}
      <ItemPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        returnFocusTo={pickerReturn}
        options={pickerOptions}
        selected={picked}
        onToggle={(option) =>
          setPicked((all) =>
            all.includes(option.publicId)
              ? all.filter((id) => id !== option.publicId)
              : [...all, option.publicId],
          )
        }
        inWorkout={new Set(cards.map((card) => card.item.itemPublicId))}
        room={MAX_WORKOUT_ITEMS - cards.length}
        newItem={actions.newItem}
        // Once per item: a retried Create can answer twice for the same one.
        onCreated={(option) =>
          setMade((all) =>
            all.some((made) => made.publicId === option.publicId) ? all : [...all, option],
          )
        }
        onAdd={addPicked}
      />
    </>
  );
}
