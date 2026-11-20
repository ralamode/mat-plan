/**
 * Whether focusing a text field is safe here: true unless the primary pointer is coarse (a phone or
 * a tablet), where focusing a field raises the on-screen keyboard over what the screen is for (the
 * movement picker's criterion 18). `matchMedia` is absent in jsdom and on the server, so the check is
 * a capability check and answers `false` there, leaving a caller's default focus in place.
 *
 * Lifted once from `movement-picker.tsx` (V1-9b B2-prep), so Clear this day's dialog reads the same
 * rule rather than a second inline copy.
 */
export function prefersFineFocus(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(pointer: coarse)').matches
  );
}
