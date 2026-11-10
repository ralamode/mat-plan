import type { ReactNode, Ref } from 'react';

/**
 * A bordered notice with a ⚠ mark, a message and a slot for choices (PROF-1 a-1d).
 *
 * 🔴 **A presentation SHELL, not a duplicate-warning component.** It encodes none of Add / Open /
 * Restore, so `a-1d-ren`'s "Save anyway / Cancel" drops into the same component without a mode flag.
 * The moment this file knows what a duplicate is, the second caller needs a prop to turn that off.
 *
 * ⚠️ **The border is DECORATION, not a boundary.** `border` measures **1.26:1** on the light page
 * (`design.md` records it as under AA), so a reader who cannot see it must lose nothing: the ⚠ mark
 * and the words carry the whole meaning. Do not add a coloured border and call it a status.
 *
 * ⚠️ **No `role="alert"`, by design.** This is not an error the parent made, and asserting it over
 * their typing is wrong. The add form moves FOCUS here instead, which both announces the message and
 * scrolls it into view; a live region on top of that would double-announce.
 *
 * `ref` and `tabIndex` are forwarded so the caller can do exactly that. React 19 passes `ref` as an
 * ordinary prop, so no `forwardRef` wrapper is needed.
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
      // `scroll-mt-4` so focusing it does not jam it against the viewport edge; `outline-none`
      // because the focus here is a programmatic announcement, not keyboard navigation — the ring
      // would read as "you tabbed here".
      className="border-input flex scroll-mt-4 flex-col gap-3 rounded-lg border p-4 outline-none"
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
