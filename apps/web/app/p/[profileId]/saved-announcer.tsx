'use client';

import { useEffect, useState } from 'react';

/**
 * Announces a save and moves focus to what was saved (V1-24 PR 1a, plan acceptance 6).
 *
 * On a successful weigh-in the form unmounts and the server renders the receipt in its place, so the
 * submit button that had focus is gone (focus drops to `<body>`) and a live region mounted WITH the
 * receipt is not announced — screen readers only read changes to a region that already existed. So
 * this is rendered in BOTH states, before and after the save, and owns the region itself.
 *
 * `saved` is the announcement for the current state (`Bodyweight saved: 84.5 lb.`), or `null` when
 * nothing is saved. Only the **none → value** transition within this page session announces (the
 * CREATE path; an amend announces itself, from its own action result): the first render never does, so opening a day that already has a weight is silent. Mount it with
 * `key={day}` so paging to a different day is a first render, not a "transition".
 */
export function SavedAnnouncer({ saved, focusId }: { saved: string | null; focusId: string }) {
  // Previous-render tracking via state, not an effect (react.dev "storing information from previous
  // renders"): the transition is derived during render, so there is no extra commit.
  const [previous, setPrevious] = useState(saved);
  const [message, setMessage] = useState('');
  if (saved !== previous) {
    setPrevious(saved);
    // ⚠️ none → value ONLY. A value→value change is not evidence of THIS user's save: a refused
    // amend revalidates in another device's value, and announcing that as "saved" (and pulling focus
    // out of the still-open editor) is the S1 defect in reverse. The amend announces its own success
    // from its action result (`bodyweight-amend.tsx`), which also covers saving an unchanged value.
    if (previous === null && saved !== null) setMessage(saved);
  }

  useEffect(() => {
    // The receipt arrives in the same server render that flipped `saved`, so it is in the DOM here.
    if (message) document.getElementById(focusId)?.focus();
  }, [message, focusId]);

  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}
