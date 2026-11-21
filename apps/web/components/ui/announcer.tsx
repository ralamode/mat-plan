/**
 * A polite live region — the "announce a result to a screen reader" half of a save, as ONE component.
 *
 * ## Why this is a component rather than three lines at each use site
 *
 * `docs/tech-debt.md` records **four** copies of `<p role="status" className="sr-only">{message}</p>`
 * paired with transition tracking (the day page's former `SavedAnnouncer`, removed at
 * V1-24 3b-life; `bodyweight-amend.tsx`; two in the strength form FAM-1 12f deleted). PROF-1 a-r's rename form was going to be the fifth,
 * which the UX panel flagged (U12), so the element gets a home before it multiplies rather than after.
 *
 * ⚠️ **It owns the REGION, not the trigger — and that split is deliberate.** The four copies differ in
 * *what* announces (a value transition, an action result, an explicit focus target) and that
 * difference is load-bearing: a value→value change (paging to a logged day) must NOT announce, which
 * is why the day page's island reports from the action's result instead. Collapsing the triggers would be the refactor that breaks one of them. The
 * transition half is already single-sourced for action results — `use-on-action-success.ts`.
 *
 * ⚠️ **This PR does not convert the four.** a-r is the first consumer; a-1 and PROF-1 b follow, and
 * the tech-debt entry names this file as where they land. Converting four tested components in a PR
 * that also adds a route, an action module and a writer would bury the behavioural change.
 *
 * ## The rules a caller must respect
 *
 * 1. **Render it in BOTH states, mounted before the message exists.** A screen reader announces
 *    *changes* to a region that already existed; a region that mounts with its text is silent. This is
 *    why `message` is `''` rather than the component being conditionally rendered.
 * 2. **`role="status"`, i.e. `aria-live="polite"`** — a save is not an interruption. A refusal the
 *    person must act on is `role="alert"`, which is a different element and not this one.
 * 3. 🔴 **Never pass a class that HIDES it while empty** — `empty:hidden`, `hidden`,
 *    `invisible`, or any `display:none`. That is rule 1 defeated by a different mechanism: a region
 *    removed from the accessibility tree and then restored *with* its text is a region that mounts
 *    with its text, and it is silent. ⚠️ Added 2026-11-08 because the component's first and only
 *    consumer did exactly this (`edit/rename-form.tsx`, shipped at `PROF-1 a-r`) — the rule existed,
 *    but only as prose about mounting, and `empty:hidden` did not look like mounting. If the empty
 *    line must not take space, give it `min-h-*` or `h-0`, which keep the element in the tree.
 *    `announcer.test.tsx` scans every consumer for this.
 * 4. **`messages`: a held sentence keeps its key** (the type's own docblock); only the new node is
 *    read. Engines differ (TalkBack reads a region's whole text on a change), so a caller adds a
 *    sentence beside another only when both must be heard, never for a run of its own taps.
 */
/** One sentence of a region that holds several (`messages`): its key must stay with it. */
export type AnnouncerMessage = { key: number; text: string };

type AnnouncerProps = {
  /**
   * An id, so a CONTROL can point `aria-describedby` at this region (PICK-1 PR 3, criterion 46).
   *
   * ⚠️ **Describing a control is a second job, not a replacement for the live region's first one.**
   * `role="status"` announces a CHANGE to whoever is listening; `aria-describedby` makes the same
   * text part of a control's description, read when focus arrives. The picker's search box needs
   * both — the match count should reach someone who moves to the field as well as someone already
   * in it — and with no id there is no way to wire the second.
   */
  id?: string;
  /**
   * Defaults to `sr-only` — invisible, announced. Pass a visible class where the message is ALSO the
   * sighted confirmation: a form that works without JavaScript has no other way to report a save
   * (PROF-1 D6), so its status line is seen as well as heard.
   */
  className?: string;
} & (
  | {
      /** The text to announce. `''` is the mounted-and-silent state, which is the initial one. */
      message: string;
      /**
       * Change it to announce the SAME message again (V1-24 3b-bw). A live region reads a change to
       * its text; an identical string is no change, so a second "Bodyweight logged" would be silent.
       * A new key makes the text a new node, which is read, without a blank frame in between.
       */
      messageKey?: number;
      messages?: never;
    }
  | {
      /**
       * Several sentences, one keyed node each (the day page, `components/day/announcements.ts`):
       * a sentence added beside the others is read alone. ⚠️ Rule 4: a sentence keeps its key for as
       * long as it is held; a new key on an old sentence makes it a new node, and it is read again.
       * `[]` is the mounted-and-silent state.
       */
      messages: readonly AnnouncerMessage[];
      message?: never;
      messageKey?: never;
    }
);

export function Announcer(props: AnnouncerProps) {
  const { id, className = 'sr-only' } = props;
  return (
    // `aria-atomic="false"` overrides `role="status"`'s implicit `true`: read the node that was
    // added, not the whole region. A one-node region (every `message` caller) reads the same either
    // way; the `messages` form depends on it.
    <p role="status" aria-atomic="false" id={id} className={className}>
      {props.messages ? (
        props.messages.map((m, i) => (
          <span key={m.key}>
            {i > 0 ? ' ' : null}
            {m.text}
          </span>
        ))
      ) : props.messageKey === undefined ? (
        props.message
      ) : (
        <span key={props.messageKey}>{props.message}</span>
      )}
    </p>
  );
}
