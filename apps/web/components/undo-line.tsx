'use client';

import { Button } from '@/components/ui/button';
import { NAME_WRAP_CLASS, UNDO_BUTTON_ATTR, UNDO_LABEL } from '@/lib/constants';

/**
 * **The shared Undo line** (PROF-1 b; the spec's "Seams the plans settled",
 * `docs/specs/crud-1-fix-it-yourself.md`).
 *
 * `PROF-1` is the first to ship one. `V1-9b` (delete + restore), `ASSIGN-1`, `V1-22` A4, `RETIRE-1`
 * and `CLONE-1` all import it rather than each growing their own, which is why it lives in
 * `components/` instead of beside this route.
 *
 * ## What it is NOT
 *
 * 🔴 **Not a toast, and not a live region.** Both are the default mental model and both are wrong
 * here, so they are stated as prohibitions:
 *
 * - **No dismiss timer.** A timer races the person: on a gym floor the parent who needs Undo is the
 *   one who looked up at the mat for four seconds. The line stays until the next result replaces it,
 *   and `/settings`'s Archived section is the durable second path when it is gone.
 * - **It owns no live region.** The message arrives here as **visible static text** in a `<span id>`;
 *   the page's island owns the one `<Announcer>`. Two reasons. First, a region that is also the
 *   `aria-describedby` target would have its text swapped out from under the description. Second,
 *   `components/ui/announcer.tsx` rule 1 means there must be exactly one persistent region per page,
 *   and a shared component cannot know whether its host already has one (the weigh-in's
 *   `SavedAnnouncer` does).
 *
 * ## Where it renders, which is part of the contract
 *
 * **Between the `<h1>` and the first section**, so Undo is the second tab stop and is inside the
 * viewport after the focus scroll. Rendering it beside the thing it undid — "where the athlete went"
 * — puts it 2N tabs down and below the fold on a three-athlete household at 780px.
 *
 * **Always mounted**, empty until there is a result, so the layout does not jump when one arrives.
 *
 * ## `aria-disabled`, never `disabled`
 *
 * A `disabled` button blurs the moment it disables, dropping a screen-reader user to `<body>` for the
 * length of the round trip. `aria-disabled` keeps focus and keeps the name; the handler early-returns.
 */
export function UndoLine({
  message,
  undoLabel,
  messageId,
  pending,
  onUndo,
}: {
  /** `''` is the mounted-and-silent state, which is the initial one. */
  message: string;
  /** Names what it undoes, so the button is not a bare "Undo" out of context (A11Y-5). */
  undoLabel: string;
  /** The id of the visible text, so the button can be described by it. */
  messageId: string;
  pending: boolean;
  /** Omitted once the action is no longer undoable, which hides the button but keeps the message. */
  onUndo?: () => void;
}) {
  return (
    // 🔴 **The VISIBLE line collapses when empty; the live region does not.** Reserving 44px here
    // unconditionally put ~110px of dead space under the `<h1>` on every visit to this screen — a
    // screenshot caught what reading the code did not. Hiding it is safe precisely because this is
    // static text, not the live region: `AthleteList` mounts the one `<Announcer>` separately and it
    // stays in the accessibility tree always (`announcer.tsx` rule 1 and rule 3). That split — an
    // sr-only region that persists plus a visible line that may collapse — is the shape the UX panel
    // asked for, and it is only now actually paying for itself.
    <div className={`flex flex-wrap items-center gap-3 ${message ? 'min-h-11' : 'hidden'}`}>
      {/* Visible, static, and NOT a live region — see the docblock. `min-h-5` keeps the row's height
          stable between the empty and filled states so the sections below never shift. */}
      {/* `NAME_WRAP_CLASS` (D11): this line carries an athlete's NAME, so a 40-character one is wider
          than a 360px phone's 328px of usable width. A UX lens found it missing here and on the day
          page's archived notice — two new name renderers that skipped the rule every other one keeps. */}
      <p id={messageId} className={`text-muted-foreground min-h-5 text-sm ${NAME_WRAP_CLASS}`}>
        {message}
      </p>
      {message && onUndo ? (
        <Button
          type="button"
          // The island's focus effect finds it by this, rather than by an id the caller must invent.
          {...{ [UNDO_BUTTON_ATTR]: '' }}
          variant="outline"
          size="sm"
          aria-describedby={messageId}
          aria-label={undoLabel}
          aria-disabled={pending || undefined}
          onClick={() => {
            // The early return is what `aria-disabled` buys: focus and the accessible name stay put
            // for the round trip, and a second tap is swallowed here rather than queued.
            if (pending) return;
            onUndo();
          }}
        >
          {UNDO_LABEL}
        </Button>
      ) : null}
    </div>
  );
}
