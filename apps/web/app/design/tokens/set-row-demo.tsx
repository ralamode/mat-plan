'use client';

import { useState } from 'react';

import { SetModeToggles } from '@/app/p/[profileId]/set-mode-toggles';
import { SetRepsWeightFields } from '@/app/p/[profileId]/set-fields';

/**
 * A live strength-set row for the token preview — **the real components**, not a lookalike.
 *
 * This is the row that matters: the densest, most constrained thing in the app (one hand, a phone at
 * 360px, sometimes an eight-year-old), and the one whose own comments budget against ~294px of usable
 * width. It is also exactly where the candidate sets' `--spacing` and `--radius` do their damage, so a
 * hand-copied facsimile would be the one artifact a reviewer must not trust — it would drift from the
 * original with nothing to catch it, and `set-fields.tsx` says in its own docblock that it exists to
 * be the single source for precisely these attributes (the panel's reuse and architecture lenses both
 * refused the copy).
 *
 * `SetRepsWeightFields` is `'use client'` and takes `onReps`/`onWeight`, so it needs a state host;
 * that is all this file is. The page itself stays a Server Component.
 */
export function SetRowDemo({ ariaLabel }: { ariaLabel: string }) {
  const [reps, setReps] = useState('8');
  const [weight, setWeight] = useState('95');
  const [isBodyweight, setIsBodyweight] = useState(false);
  const [isBand, setIsBand] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Back Squat</p>
      <div className="flex flex-wrap items-center gap-2">
        <SetRepsWeightFields
          reps={reps}
          weight={weight}
          onReps={setReps}
          onWeight={setWeight}
          ariaLabel={ariaLabel}
          unit="lb"
        />
      </div>
      <SetModeToggles
        isBodyweight={isBodyweight}
        isBand={isBand}
        onChange={(patch) => {
          if (patch.isBodyweight !== undefined) setIsBodyweight(patch.isBodyweight);
          if (patch.isBand !== undefined) setIsBand(patch.isBand);
        }}
        ariaLabel={ariaLabel}
      />
    </div>
  );
}
