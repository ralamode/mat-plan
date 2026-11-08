/**
 * A polite live region — the "announce a result to a screen reader" half of a save, as ONE component.
 *
 * ## Why this is a component rather than three lines at each use site
 *
 * `docs/tech-debt.md` records **four** copies of `<p role="status" className="sr-only">{message}</p>`
 * paired with transition tracking (`saved-announcer.tsx`, `bodyweight-amend.tsx`,
 * `editable-set.tsx`, the `StrengthForm` island). PROF-1 a-r's rename form was going to be the fifth,
 * which the UX panel flagged (U12), so the element gets a home before it multiplies rather than after.
 *
 * ⚠️ **It owns the REGION, not the trigger — and that split is deliberate.** The four copies differ in
 * *what* announces (a value transition, an action result, an explicit focus target) and that
 * difference is load-bearing: `saved-announcer.tsx`'s own comment explains why a value→value change
 * must NOT announce. Collapsing the triggers would be the refactor that breaks one of them. The
 * transition half is already single-sourced for action results — `use-on-action-success.ts`.
 *
 * ⚠️ **This PR does not convert the four.** a-r is the first consumer; a-1 and PROF-1 b follow, and
 * the tech-debt entry names this file as where they land. Converting four tested components in a PR
 * that also adds a route, an action module and a writer would bury the behavioural change.
 *
 * ## The two rules a caller must respect
 *
 * 1. **Render it in BOTH states, mounted before the message exists.** A screen reader announces
 *    *changes* to a region that already existed; a region that mounts with its text is silent. This is
 *    why `message` is `''` rather than the component being conditionally rendered.
 * 2. **`role="status"`, i.e. `aria-live="polite"`** — a save is not an interruption. A refusal the
 *    person must act on is `role="alert"`, which is a different element and not this one.
 */
export function Announcer({
  message,
  className = 'sr-only',
}: {
  /** The text to announce. `''` is the mounted-and-silent state, which is the initial one. */
  message: string;
  /**
   * Defaults to `sr-only` — invisible, announced. Pass a visible class where the message is ALSO the
   * sighted confirmation: a form that works without JavaScript has no other way to report a save
   * (PROF-1 D6), so its status line is seen as well as heard.
   */
  className?: string;
}) {
  return (
    <p role="status" className={className}>
      {message}
    </p>
  );
}
