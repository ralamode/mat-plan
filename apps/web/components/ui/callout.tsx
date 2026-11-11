import type { ReactNode, Ref } from 'react';

/**
 * A bordered notice with a ⚠ mark, a message and a slot for choices (PROF-1 a-1d).
 *
 * 🔴 **A presentation SHELL, not a duplicate-warning component.** It encodes none of Add / Open /
 * Restore, so `a-1d-ren`'s single "Save anyway" drops into the same component without a mode flag.
 * ⚠️ That chunk shipped ONE choice, not two: "Cancel" was rejected at `U11` and the 2026-11-10 UX
 * panel settled on one button plus a sentence naming the other routes. This line said
 * "Save anyway / Cancel" until then.
 * The moment this file knows what a duplicate is, the second caller needs a prop to turn that off.
 *
 * ⚠️ **The border is DECORATION, not a boundary.** `border` measures **1.26:1** on the light page
 * (`design.md` records it as under AA), so a reader who cannot see it must lose nothing: the ⚠ mark
 * and the words carry the whole meaning. Do not add a coloured border and call it a status.
 *
 * ⚠️ **No `role="alert"`, by design.** This is not an error the parent made, and asserting it over
 * their typing is wrong. The add form moves FOCUS here instead, which both announces the message and
 * scrolls it into view; a live region on top of that would double-announce. The focus target carries
 * `role="group"` + `aria-labelledby`, so it announces as a named group rather than as silence.
 *
 * `ref` is forwarded so the caller can do exactly that. React 19 passes `ref` as an ordinary prop,
 * so no `forwardRef` wrapper is needed. `tabIndex={-1}` is **fixed here, not a prop** — focusability
 * is not optional for a component whose announcement strategy is the focus move, so there is nothing
 * for a caller to decide. (An earlier version of this docblock said `tabIndex` was forwarded. It
 * never was.)
 */
export function Callout({
  id,
  messageId,
  message,
  children,
  ref,
}: {
  id?: string;
  /** The id of the message paragraph — what a caller points `aria-describedby` at. */
  messageId?: string;
  message: ReactNode;
  /** The choices. Stacked full-width by the caller; this only provides the gap. */
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      id={id}
      tabIndex={-1}
      // 🔴 **`role="group"` + `aria-labelledby`, or the focus move announces nothing.** A focused bare
      // `<div tabindex=-1>` reads as unstructured text or as silence, depending on the screen reader.
      // Naming the group from its own message means a user hears "That looks like Ada … group" and
      // knows the buttons below belong to it. Still no `role="alert"` — focus already reads it, and
      // the two together double-announce.
      role="group"
      aria-labelledby={messageId}
      // `scroll-mt-4` so focusing it does not jam against the viewport edge.
      // `outline-none` + `focus-visible:ring-3` is this repo's idiom (`INPUT_CLASS` is the same
      // pair): the browser's default outline is suppressed and replaced by a ring that only shows
      // for keyboard focus. ⚠️ The ring matters here even though the focus move is programmatic —
      // the sentinel means an Enter press re-focuses this container, and for that user it really is
      // where focus lives.
      className="border-input focus-visible:ring-ring flex scroll-mt-4 flex-col gap-3 rounded-lg border p-4 outline-none focus-visible:ring-3"
    >
      <div className="flex gap-2.5">
        <span aria-hidden="true" className="text-base leading-6">
          ⚠
        </span>
        {/* 🔴 The message is the FIRST child and carries its own id. A caller pointing
            `aria-describedby` at the whole callout would make a screen reader read the button
            labels as part of the description. `text-foreground`, never muted: this is the sentence
            the parent has to read, and `text-muted-foreground` sits on the AA floor at 4.74:1. */}
        <p id={messageId} className="max-w-prose text-sm">
          {message}
        </p>
      </div>
      {children ? <div className="flex flex-col gap-2">{children}</div> : null}
    </div>
  );
}
