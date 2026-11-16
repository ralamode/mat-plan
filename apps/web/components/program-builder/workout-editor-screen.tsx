'use client';

import {
  FREE_TEXT_NOTE_MAX,
  WORKOUT_NAME_MAX,
  type ProgramActions,
  type ProgramList,
  type Unit,
  type WorkoutDraft,
} from '@mat-plan/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@/components/ui/button';
import { FOCUS_TARGET_CLASS, NAME_WRAP_CLASS, NAV_LINK_CLASS, SAVING_LABEL } from '@/lib/constants';
import type { MovementPickerData } from '@/lib/movements/movement-option';

import {
  EDITOR_COPY,
  fieldsToFixText,
  movedText,
  PENDING_CLASS,
  removedText,
  saveRefusal,
  unitChangedText,
  usedByText,
} from './builder-text';
import {
  fieldId,
  readDraft,
  toCards,
  type EditorCard,
  type EditorError,
  type EditorField,
} from './editor-draft';
import { ItemCard, type CardControl } from './item-card';
import { NameField } from './name-field';
import { programPath } from './routes';
import { StatusLine, useStatusLine } from './status-line';
import { normalizeSupersets, supersetLabels } from './supersets';

/**
 * The workout editor: one screen of item cards and one Save (FAM-1 step 8; plan §8 "Workout
 * editor"; the prototype's `vWorkout`). 8b adds linking supersets and their rest; 9 adds the item
 * picker ("+ Add items").
 *
 * **The screen is the page.** Its route is thin, so the screen renders the page's `<h1>` and its
 * top-level blocks, inside the shell's one `<main>`. It adds no landmark of its own around them.
 *
 * - `draft` is what the editor loads and what Save sends (`saveWorkout`), under the draft's own
 *   `workoutClientId`, so a retried Save replays the same attempt.
 * - `program` names the program in the back link and says who a change applies to. **Optional**:
 *   the preview route does not pass it yet (the maintainer kept the harness as it is, 2026-11-16),
 *   and 7b's page does. Without it the link reads "← Program" and the line is not shown.
 * - `picker` is the item picker's data (step 9).
 *
 * Decided at step 8 _(maintainer, 2026-11-16)_: a superset is kept well formed after every move
 * and remove (`normalizeSupersets`); Remove has no undo but Cancel, as the prototype; leaving with
 * changes asks first; Reps are a whole number. Enter never saves: Save is the button.
 */
export type WorkoutEditorScreenProps = {
  draft: WorkoutDraft;
  picker: MovementPickerData;
  actions: ProgramActions;
  program?: ProgramList[number];
};

const ITEMS_HEADING_ID = 'workout-items';
const DISCARD_QUESTION_ID = 'workout-discard-question';
/** How soon after a Remove a second one is taken as the same tap. */
const REMOVE_DEBOUNCE_MS = 500;
const SAVE_ALERT_ID = 'workout-save-alert';

/** Everything typed, as one comparable value: the screen is "changed" when it differs. */
const snapshot = (name: string, description: string, cards: readonly EditorCard[]) =>
  JSON.stringify([name, description, cards]);

export function WorkoutEditorScreen({ draft, actions, program }: WorkoutEditorScreenProps) {
  const router = useRouter();
  const initialCards = useMemo(() => toCards(draft), [draft]);
  const initial = useMemo(
    () => snapshot(draft.name, draft.description ?? '', initialCards),
    [draft, initialCards],
  );
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description ?? '');
  const [cards, setCards] = useState(initialCards);
  const [errors, setErrors] = useState<EditorError[]>([]);
  const [pending, setPending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { status, report } = useStatusLine();

  const attempt = useRef(0);
  const lastRemoveAt = useRef(0);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const itemsHeadingRef = useRef<HTMLHeadingElement>(null);

  const back = programPath(draft.programPublicId);
  const dirty = snapshot(name, description, cards) !== initial;
  const labels = supersetLabels(cards.map((card) => card.item));

  // Leaving the screen ends a Save in flight: its answer must not navigate afterwards.
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );

  // The browser's own "leave this page?" while there are changes. The App Router has no hook for
  // its own navigations, so Cancel and the back link ask inline instead.
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

  /** Drops a field's refusal once it is edited; the bar's alert goes with the last one. */
  const clearError = (card: string | null, field: EditorField) => {
    const left = errors.filter((error) => !(error.card === card && error.field === field));
    if (left.length === errors.length) return;
    setErrors(left);
    if (!left.length && status.tone === 'alert') report('');
  };

  const updateCard = (id: string, patch: Partial<EditorCard>) =>
    setCards((all) =>
      all.map((card) => (card.item.prescriptionClientId === id ? { ...card, ...patch } : card)),
    );

  /** Re-forms the supersets after a move or a remove, and counts the groups that ended. */
  const settle = (next: EditorCard[]) => {
    const groups = (list: readonly EditorCard[]) =>
      new Set(list.flatMap((card) => (card.item.superset ? [card.item.superset.group] : []))).size;
    const { items } = normalizeSupersets(next.map((card) => card.item));
    const settled = next.map((card, index) => ({ ...card, item: items[index]! }));
    return { settled, ended: Math.max(0, groups(next) - groups(settled)) };
  };

  function move(index: number, direction: 'up' | 'down') {
    const card = cards[index]!;
    const to = direction === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= cards.length) {
      report(direction === 'up' ? EDITOR_COPY.alreadyFirst : EDITOR_COPY.alreadyLast);
      return;
    }
    const id = card.item.prescriptionClientId;
    const before = control(id, direction)?.getBoundingClientRect().top ?? 0;
    const next = [...cards];
    [next[index], next[to]] = [next[to]!, next[index]!];
    const { settled, ended } = settle(next);
    flushSync(() => setCards(settled));
    // The same button on the moved card, held where the thumb is: a second tap moves it again.
    const button = control(id, direction);
    button?.focus({ preventScroll: true });
    const after = button?.getBoundingClientRect().top ?? before;
    if (after !== before) window.scrollBy(0, after - before);
    report(movedText(card.item.itemName, direction, ended));
  }

  /** `at` is the tap's `event.timeStamp`. */
  function remove(index: number, at: number) {
    // A double tap lands on the next card's Remove, which slides up under the thumb.
    if (lastRemoveAt.current && at - lastRemoveAt.current < REMOVE_DEBOUNCE_MS) return;
    lastRemoveAt.current = at;
    const card = cards[index]!;
    const neighbour = cards[index + 1] ?? cards[index - 1];
    const { settled, ended } = settle(cards.filter((_, i) => i !== index));
    flushSync(() => setCards(settled));
    setErrors((all) => all.filter((error) => error.card !== card.item.prescriptionClientId));
    const target = neighbour ? control(neighbour.item.prescriptionClientId, 'remove') : null;
    (target ?? itemsHeadingRef.current)?.focus();
    report(removedText(card.item.itemName, ended));
  }

  function changeUnit(card: EditorCard, unit: Unit) {
    const typed = card.value.trim();
    updateCard(card.item.prescriptionClientId, { unit });
    if (typed && card.unit && card.unit !== unit) {
      report(unitChangedText(card.item.itemName, typed, card.unit, unit));
    }
  }

  function refuse(found: EditorError[], message: string) {
    setErrors(found);
    report(message, 'alert');
    const first = found[0];
    const field = first ? document.getElementById(fieldId(first.card, first.field)) : null;
    field?.focus();
    field?.scrollIntoView?.({ block: 'center' });
  }

  async function save() {
    if (pending) return;
    const read = readDraft(draft, { name, description, cards });
    if (!read.ok) {
      const nameOnly = read.errors.length === 1 && read.errors[0]!.field === 'name';
      refuse(read.errors, nameOnly ? read.errors[0]!.message : fieldsToFixText(read.errors.length));
      return;
    }
    const mine = ++attempt.current;
    setPending(true);
    report('');
    const result = await actions.saveWorkout(read.draft);
    if (mine !== attempt.current) return;
    // `pending` stays set on success: the page changes, and Save must not read as ready again.
    if (result.ok) return router.push(back);
    setPending(false);
    const message = saveRefusal(result.reason);
    if (result.reason === 'name_taken') {
      refuse([{ card: null, field: 'name', message }], message);
    } else refuse([], message);
  }

  function leave() {
    if (!dirty) return router.push(back);
    report('');
    flushSync(() => setLeaving(true));
    keepEditingRef.current?.focus();
  }

  function keepEditing() {
    flushSync(() => setLeaving(false));
    cancelRef.current?.focus();
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
    <form
      className="flex flex-col gap-6 [&_:is(input,select,textarea,button,a)]:scroll-mb-40"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={holdEnter}
      aria-labelledby="workout-editor-heading"
      noValidate
    >
      <div className="flex flex-col gap-2">
        <Link
          href={back}
          className={NAV_LINK_CLASS}
          onClick={(event) => {
            // A new tab (cmd or ctrl) leaves this one as it is.
            if (!dirty || event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            leave();
          }}
        >
          {program ? `← ${program.name}` : EDITOR_COPY.backToProgram}
        </Link>
        <h1 id="workout-editor-heading" className="text-2xl font-semibold tracking-tight">
          {draft.workoutPublicId ? EDITOR_COPY.editWorkout : EDITOR_COPY.newWorkout}
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
                    clearError(id, field);
                  }}
                  onUnit={(unit) => changeUnit(card, unit)}
                  onMove={(direction) => move(index, direction)}
                  onRemove={(at) => remove(index, at)}
                />
              );
            })}
          </ol>
        ) : (
          <p className="text-muted-foreground">{EDITOR_COPY.noItems}</p>
        )}
      </section>

      {/* The save bar: always in view on a phone, where Save and what it says are. */}
      <div className="bg-background sticky bottom-0 flex flex-col gap-2 border-t pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <StatusLine status={status} alertId={SAVE_ALERT_ID} />
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
                variant="destructive"
                className="flex-1"
                onClick={() => router.push(back)}
              >
                {EDITOR_COPY.discard}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button ref={cancelRef} type="button" variant="ghost" onClick={leave}>
              {EDITOR_COPY.cancel}
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
  );
}
