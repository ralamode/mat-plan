'use client';

import {
  MOVEMENT_NAME_MAX,
  MOVEMENT_PICKER_GROUPS,
  matchMovementOptions,
  movementNameKey,
  movementNameSchema,
} from '@mat-plan/shared';
import { useDeferredValue, useId, useMemo, useRef, useState, type RefObject } from 'react';

import type { MovementOptionDTO, MovementPickerData } from '@/lib/movements/movement-option';
import { MOVEMENT_PICKER_COPY as COPY } from '@/lib/movements/movement-picker-copy';
import { Button } from '@/components/ui/button';
import { Sheet, sheetStatusId } from '@/components/ui/sheet';
import { INPUT_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The movement picker (PICK-1 Decision 8) — **reusable, and it never writes.**
 *
 * 🔴 **It lives outside `app/p/[profileId]/` so `D2`'s program editor mounts the SAME component**
 * (criterion 34), and it imports no Server Action and no `app/` module — a source-scan test pins
 * that, because "it cannot write" is the property that makes it safe to reuse. A typed name is
 * created by the CALLER's save: the set's today, the program's later.
 *
 * ## What is settled elsewhere, so this file does not re-decide it
 *
 * The browse groups and aliases are `MOVEMENT_PICKER_ENTRIES` (Decision 3); the fold, the match and
 * the alias/exact rules are `matchMovementOptions` (Decision 4), which is pure and tested against
 * the plan's vector table; every string is `MOVEMENT_PICKER_COPY` (reuse S4). The eight gaps the
 * pre-implementation UX panel found in Decision 8 are decided in the plan's
 * § "UX panel, round 2" and implemented here — each marked `panel 2 · N` at its site.
 */

const SHEET_ID = 'movement-picker';

/** What the picker needs to know about the day's program, as IDS on both sides (panel 2 · 6). */
export type TodaysProgramForPicker = {
  /** The prescribed movements' option public ids, in program order. */
  readonly ids: readonly string[];
  /** Those already on a card. PR 4 resolves each card to an id; this component never sees a card. */
  readonly onFormIds: ReadonlySet<string>;
};

export type MovementPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `"Choose a movement"` on the log form; `D2` passes its own. */
  title: string;
  data: MovementPickerData;
  todaysProgram?: TodaysProgramForPicker;
  /** `D2`: movements already in the workout being edited. Absent on the log form. */
  alreadyIn?: { readonly ids: ReadonlySet<string>; readonly label: string };
  /** The card's current movement, marked `aria-current`. */
  currentId?: string;
  returnFocusTo: RefObject<HTMLElement | null>;
  onPick: (
    picked: { kind: 'existing'; option: MovementOptionDTO } | { kind: 'typed'; name: string },
  ) => void;
};

/** A row, plus the single tag it earns. One tag per row, by precedence (panel 2 · 5). */
type Row = { option: MovementOptionDTO; tag: string | null };

export function MovementPicker({
  open,
  onOpenChange,
  title,
  data,
  todaysProgram,
  alreadyIn,
  currentId,
  returnFocusTo,
  onPick,
}: MovementPickerProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const headingId = useId();

  // The query resets on every open (UX NIT) — a sheet that reopens holding the last search makes the
  // browse list unreachable without a manual clear.
  //
  // ⚠️ **Adjusted DURING render, not in an effect.** `setQuery('')` inside `useEffect` is React's
  // documented cascading-render smell and this repo's lint refuses it: the sheet would paint once
  // with the stale query before clearing it. Comparing against the previous `open` and setting
  // during render is the documented pattern for deriving state from a prop, and React re-renders
  // immediately without committing the intermediate paint.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery('');
  }

  // 🔴 **The search box takes focus only when there is no on-screen keyboard to raise** (criterion
  // 18): focusing a field on touch covers the list the sheet exists to show. `matchMedia` is absent
  // in jsdom, so the guard is a capability check and the default (the sheet's title) applies there.
  const prefersKeyboardFocus =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(pointer: coarse)').matches;

  // Filtering runs on the deferred value so typing stays responsive over ~110 rows (FE-12's intent).
  const deferredQuery = useDeferredValue(query);
  const trimmed = deferredQuery.trim();

  const result = useMemo(
    () =>
      matchMovementOptions(
        data.options.map((option) => ({
          name: option.name,
          isCatalog: option.owner === 'catalog',
          aliases: option.owner === 'catalog' ? option.aliases : [],
          option,
        })),
        trimmed,
      ),
    [data.options, trimmed],
  );

  const byName = useMemo(
    () => new Map(data.options.map((o) => [o.name, o] as const)),
    [data.options],
  );
  const byId = useMemo(
    () => new Map(data.options.map((o) => [o.publicId, o] as const)),
    [data.options],
  );

  /** The ONE tag a row earns, highest precedence first (Decision 8; panel 2 · 5). */
  const tagFor = (
    option: MovementOptionDTO,
    inSearchResults: boolean,
    underHouseholdHeading: boolean,
  ) => {
    if (alreadyIn?.ids.has(option.publicId)) return COPY.tagAlreadyIn(alreadyIn.label);
    // `also called` fires ONLY on an alias hit, naming the alias that hit — otherwise it would
    // outrank the group label for every aliased row in search results (panel 2 · 5, against UX1 8).
    if (result.aliasHit && option.owner === 'catalog') {
      const hit = option.aliases.find((a) => movementNameKey(a) === movementNameKey(trimmed));
      if (hit) return COPY.tagAlsoCalled(hit);
    }
    if (option.publicId === currentId) return COPY.tagCurrent;
    if (inSearchResults && option.owner === 'catalog') return COPY.groupLabel(option.group);
    if (option.owner === 'household' && !underHouseholdHeading) return COPY.tagHousehold;
    return null;
  };

  const rowsFrom = (
    options: readonly MovementOptionDTO[],
    opts: { inSearchResults?: boolean; underHouseholdHeading?: boolean } = {},
  ): Row[] =>
    options.map((option) => ({
      option,
      tag: tagFor(option, opts.inSearchResults ?? false, opts.underHouseholdHeading ?? false),
    }));

  // ── The ordered candidate list, and what Enter may act on (panel 2 · 3) ─────────────────────────
  const matches = result.matches
    .map((m) => byName.get(m.name))
    .filter((o): o is MovementOptionDTO => !!o);
  const someWords = result.someWords
    .map((m) => byName.get(m.name))
    .filter((o): o is MovementOptionDTO => !!o);
  // Enter picks `matches[0]` iff unambiguous. Two `exact` hits resolve to the first — catalog-first by
  // Decision 4's tie rule, which is also the row the status names. `someWords` NEVER picks.
  const enterTarget =
    result.exact || result.aliasHit || matches.length === 1 ? matches[0] : undefined;

  // ── "Use as typed": offered for raw non-empty text that is not already in the list ─────────────
  // 🔴 Tested on the TRIMMED RAW text, not the fold (panel 2 · 4): `🙂` and `---` fold to `''`, and
  // testing the fold would drop them into browse mode and never show the disabled footer Decision 8
  // promises for them.
  const rawTrimmed = query.trim();
  const offersTyped = rawTrimmed !== '' && !result.exact && !result.aliasHit;
  // The reason comes from the SCHEMA, so the UI never hand-composes a rule the boundary owns. A name
  // breaking two rules shows the first, by `typedMovementNameIssues`' order.
  const typedNameIssue = useMemo(() => {
    if (!offersTyped) return null;
    const parsed = movementNameSchema.safeParse(rawTrimmed);
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  }, [offersTyped, rawTrimmed]);

  // ── The status region: ONE shape, `{count}. {reason}`, one reason by precedence (panel 2 · 1-2) ──
  const status = (() => {
    if (rawTrimmed === '') return COPY.statusEmpty; // mounts silent — Announcer's rule 1
    const count =
      matches.length > 0
        ? COPY.statusCount(matches.length)
        : someWords.length > 0
          ? COPY.statusSomeWords(someWords.length)
          : COPY.statusNoMatches;
    const reason =
      (result.exact || result.aliasHit) && matches[0]
        ? COPY.statusAlreadyListed(matches[0].name)
        : typedNameIssue;
    return reason ? `${count} ${reason}` : count;
  })();

  const pickExisting = (option: MovementOptionDTO) => {
    onPick({ kind: 'existing', option });
    onOpenChange(false);
  };

  // Empty groups are omitted, so `wrestling` simply does not render until `C3` seeds it. The DTO
  // carries the group the DAL read out of `MOVEMENT_PICKER_ENTRIES`, so this trusts the DTO rather
  // than re-deriving it — one source, read once, at the boundary.
  const groupSections = MOVEMENT_PICKER_GROUPS.map((group) => ({
    group,
    rows: rowsFrom(data.options.filter((o) => o.owner === 'catalog' && o.group === group)),
  })).filter(({ rows }) => rows.length > 0);

  return (
    <Sheet
      id={SHEET_ID}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      returnFocusTo={returnFocusTo}
      initialFocus={prefersKeyboardFocus ? searchRef : undefined}
      status={status}
      headerExtra={
        <div>
          <label className="sr-only" htmlFor={`${SHEET_ID}-search`}>
            {COPY.searchLabel}
          </label>
          <input
            ref={searchRef}
            id={`${SHEET_ID}-search`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter picks only when unambiguous, and NEVER fires "use as typed" (UX3 N8).
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (enterTarget) pickExisting(enterTarget);
            }}
            maxLength={MOVEMENT_NAME_MAX}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={COPY.searchPlaceholder}
            aria-describedby={sheetStatusId(SHEET_ID)}
            className={cn(INPUT_CLASS, 'w-full')}
          />
        </div>
      }
      footer={
        // 🔴 **ALWAYS a footer, and Close is ALWAYS its last child** (panel 2 · 7). U0 renders a
        // full-width outline Close when no footer is passed, so a conditional footer made the slot
        // swap Close for an outline "Use as typed" at the same thumb position two keystrokes apart —
        // and that button mints a household movement with no in-app undo until V1-9b.
        <div className="flex flex-col gap-2">
          {offersTyped ? (
            <>
              <Button
                type="button"
                // Quiet with candidates above, loud with none (UX2 B1). `someWords` counts as
                // candidates (panel 2 · 8): UX3 6 exists to steer toward them.
                variant={matches.length > 0 || someWords.length > 0 ? 'ghost' : 'outline'}
                size="lg"
                aria-disabled={typedNameIssue !== null}
                aria-describedby={`${SHEET_ID}-typed-hint`}
                onClick={() => {
                  if (typedNameIssue) return; // focusable but inert, with the reason in the hint
                  onPick({ kind: 'typed', name: rawTrimmed });
                  onOpenChange(false);
                }}
                // `button.tsx` is `whitespace-nowrap`; a long typed name must wrap, not clip.
                className="h-auto min-h-11 w-full whitespace-normal break-words text-base"
              >
                {COPY.asTyped(rawTrimmed)}
              </Button>
              <p id={`${SHEET_ID}-typed-hint`} className="text-muted-foreground text-xs">
                {typedNameIssue ?? COPY.asTypedHint(rawTrimmed)}
              </p>
            </>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full text-base"
            onClick={() => onOpenChange(false)}
          >
            {COPY.close}
          </Button>
        </div>
      }
    >
      {rawTrimmed === '' ? (
        <>
          {data.recentIds && data.recentIds.length > 0 ? (
            <Section
              currentId={currentId}
              onPick={pickExisting}
              id={`${headingId}-recent`}
              heading={COPY.recent}
              rows={rowsFrom(
                data.recentIds.map((id) => byId.get(id)).filter((o): o is MovementOptionDTO => !!o),
              )}
            />
          ) : null}
          {todaysProgram && !alreadyIn ? (
            <TodaysProgram
              headingId={`${headingId}-program`}
              program={todaysProgram}
              byId={byId}
              rowsFrom={rowsFrom}
              currentId={currentId}
              onPick={pickExisting}
            />
          ) : null}
          {groupSections.map(({ group, rows }) => (
            <Section
              key={group}
              currentId={currentId}
              onPick={pickExisting}
              id={`${headingId}-${group}`}
              heading={COPY.groupLabel(group)}
              rows={rows}
            />
          ))}
          <Section
            currentId={currentId}
            onPick={pickExisting}
            id={`${headingId}-household`}
            heading={COPY.household}
            rows={rowsFrom(
              data.options.filter((o) => o.owner === 'household'),
              { underHouseholdHeading: true },
            )}
          />
        </>
      ) : matches.length > 0 ? (
        <Section
          currentId={currentId}
          onPick={pickExisting}
          id={`${headingId}-matches`}
          heading={COPY.matches}
          rows={rowsFrom(matches, { inSearchResults: true })}
        />
      ) : someWords.length > 0 ? (
        <Section
          currentId={currentId}
          onPick={pickExisting}
          id={`${headingId}-some`}
          heading={COPY.someWords}
          rows={rowsFrom(someWords, { inSearchResults: true })}
        />
      ) : (
        // No matches at all: the browse list stays reachable under the "No matches" status, so the
        // sheet is never a dead end.
        <>
          {groupSections.map(({ group, rows }) => (
            <Section
              key={group}
              currentId={currentId}
              onPick={pickExisting}
              id={`${headingId}-${group}`}
              heading={COPY.groupLabel(group)}
              rows={rows}
            />
          ))}
        </>
      )}
    </Sheet>
  );
}

function TodaysProgram({
  headingId,
  program,
  byId,
  rowsFrom,
  currentId,
  onPick,
}: {
  headingId: string;
  program: TodaysProgramForPicker;
  byId: Map<string, MovementOptionDTO>;
  rowsFrom: (options: readonly MovementOptionDTO[]) => Row[];
  currentId?: string;
  onPick: (option: MovementOptionDTO) => void;
}) {
  // ⚠️ A prescribed id with no option is DROPPED before the open/closed decision (panel 2 · 6) —
  // otherwise the `<details>` opens over a row it cannot render. It happens when a prescription names
  // a movement outside the picker map, or a household row that fell off Decision 5's list.
  const options = program.ids.map((id) => byId.get(id)).filter((o): o is MovementOptionDTO => !!o);
  if (options.length === 0) return null;
  // Open while any prescribed movement is NOT yet on a card; the list always shows every prescribed
  // row, so a second card for one stays one tap away — only the summary changes.
  const allOnForm = options.every((o) => program.onFormIds.has(o.publicId));
  return (
    <section aria-labelledby={headingId} className="mb-4">
      <details open={!allOnForm}>
        <summary
          id={headingId}
          className="text-muted-foreground mb-1 min-h-11 text-sm font-semibold"
        >
          {allOnForm ? COPY.todaysProgramAllOnForm : COPY.todaysProgram}
        </summary>
        <OptionList rows={rowsFrom(options)} currentId={currentId} onPick={onPick} />
      </details>
    </section>
  );
}

function OptionList({
  rows,
  currentId,
  onPick,
}: {
  rows: Row[];
  currentId?: string;
  onPick: (option: MovementOptionDTO) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map(({ option, tag }) => (
        <li key={option.publicId}>
          <button
            type="button"
            onClick={() => onPick(option)}
            // `aria-current` marks the card's movement; `min-h-12` is the ≥44px tap target.
            aria-current={option.publicId === currentId ? true : undefined}
            className="focus-visible:ring-ring hover:bg-accent flex min-h-12 w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-3"
          >
            <span className="min-w-0 break-words text-base">{option.name}</span>
            {tag ? (
              <span className="text-muted-foreground shrink-0 rounded border px-2 text-xs">
                {tag}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One labelled section of the list. **Module scope, not nested in `MovementPicker`** — a component
 * defined inside another is a new type on every render, which remounts its whole subtree and loses
 * focus; this repo's lint refuses it ("Cannot create components during render").
 */
function Section({
  id,
  heading,
  rows,
  currentId,
  onPick,
  children,
}: {
  id: string;
  heading: string;
  rows: Row[];
  currentId?: string;
  onPick: (option: MovementOptionDTO) => void;
  children?: React.ReactNode;
}) {
  if (rows.length === 0 && !children) return null;
  return (
    <section aria-labelledby={id} className="mb-4">
      <h3 id={id} className="text-muted-foreground mb-1 text-sm font-semibold">
        {heading}
      </h3>
      {children ?? <OptionList rows={rows} currentId={currentId} onPick={onPick} />}
    </section>
  );
}
