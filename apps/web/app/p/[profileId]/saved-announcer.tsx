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
 * nothing is saved. Only the **none → value** transition within this page session announces: the
 * first render never does, so opening a day that already has a weight is silent. Mount it with
 * `key={day}` so paging to a different day is a first render, not a "transition".
 */
export function SavedAnnouncer({ saved, focusId }: { saved: string | null; focusId: string }) {
  // Previous-render tracking via state, not an effect (react.dev "storing information from previous
  // renders"): the transition is derived during render, so there is no extra commit.
  const [previous, setPrevious] = useState(saved);
  const [message, setMessage] = useState('');
  if (saved !== previous) {
    setPrevious(saved);
    // ⚠️ `saved !== null`, NOT `previous === null` (V1-24 PR 1b). An amend is value→value, so the
    // old none→value rule announced NOTHING and never ran the focus effect below — a screen-reader
    // user tapped Save and heard silence, indistinguishable from failure, which is the exact S1
    // defect this component exists to fix. First render stays silent for free, because `previous`
    // is seeded from `saved`.
    if (saved !== null) setMessage(saved);
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
