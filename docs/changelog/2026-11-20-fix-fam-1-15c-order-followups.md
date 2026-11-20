- **2026-11-20** — **FAM-1 15c follow-up: Program order's loose ends, and the programs line as the
  prototype draws it.** The day page lists each program as a "Name ›" link after a muted
  "Programs:" label, with no commas, underlined only on hover and a 44px target both ways
  (`PROGRAM_NAME_LINK_CLASS`). When a re-read leaves nothing to order while the dialog is open, one
  sentence replaces its explainer and lists ("… isn't on a program now, so there's nothing to
  order." or "…'s programs all come off after today, so there's nothing to order."), describes
  Done and is announced once. Forward after closing it no longer reopens a dialog whose button the
  page has hidden: the shared sheet gains `reopenFromHistory` (default unchanged), and Program
  order passes `canOrder`. The dialog's code now loads on demand (prefetched on idle and on the
  button's pointerdown or focus, then kept mounted); a failed load leaves the button with
  "Couldn't open. Try again." under it instead of reaching the error page.
