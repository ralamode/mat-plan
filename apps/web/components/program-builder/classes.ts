/**
 * The program builder's shared class strings (FAM-1 lane B), each named at its second use.
 *
 * The prototype groups a list's rows in one bordered box with dividers (`.menu`), not a card per
 * row, so these are `NAV_ROW_CLASS` without its own border and corners. The ring is inset so the
 * group's border does not clip it.
 */
export const GROUP_LIST_CLASS = 'divide-y overflow-hidden rounded-lg border';

export const GROUP_ROW_LINK_CLASS =
  'focus-visible:ring-ring hover:bg-accent flex min-h-11 flex-col justify-center px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-inset';

/** A target focus is moved to after an action: invisible to a tap, a ring for the keyboard. */
export const FOCUS_TARGET_CLASS =
  'focus-visible:ring-ring rounded-sm outline-none focus-visible:ring-3';

/** A row's `›`: decoration, in the text colour as the prototype has it. */
export const CHEVRON_CLASS = 'shrink-0';
