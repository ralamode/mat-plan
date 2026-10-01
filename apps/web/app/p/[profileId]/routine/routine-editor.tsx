'use client';

import { type RoutineItem, ROUTINE_VERSION } from '@mat-plan/shared';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SAVING_LABEL } from '@/lib/constants';
import { type RoutineCatalogItem } from '@/lib/routine/catalog';
import { moveDown, moveUp, toggle } from '@/lib/routine/editor';

import { INITIAL_ACTION_STATE } from '../action-state';
import { editRoutineAction } from '../actions';
import { useOnActionSuccess } from '../use-on-action-success';

/**
 * The coach routine builder (V1-18 PR 2) — a checklist + ▲▼ reorder (the "picker is a checklist, not a
 * dropdown" the UX/kid panels settled on; ▲▼ not drag so it's RSC-friendly + keyboard-usable). Local state
 * is the ordered list of in-routine `RoutineItem`s (seeded from the profile's already-resolved routine, and
 * carrying the opaque `conditional` marker through every edit via the pure transforms). On Save it serializes
 * the whole config into ONE hidden JSON field (the strength-form idiom — an ordered variable-length list
 * can't be encoded as parallel fields); the action re-validates it strictly. Save is disabled at zero items,
 * because an empty routine is not authorable (the read path maps empty → the full default, so "save nothing"
 * would silently render everything). Weigh-in is pinned FIRST on Today by construction — never a routine
 * member — so it's a caption here, not an editable (and inert) row.
 */
export function RoutineEditor({
  profileId,
  initialOrder,
  catalog,
}: {
  profileId: string;
  initialOrder: readonly RoutineItem[];
  catalog: readonly RoutineCatalogItem[];
}) {
  const [state, formAction, pending] = useActionState(editRoutineAction, INITIAL_ACTION_STATE);
  const [order, setOrder] = useState<RoutineItem[]>(() => [...initialOrder]);

  const labelByKey = new Map(catalog.map((c) => [c.key, c.label]));
  // The kid's ORIGINAL items, keyed — so re-adding a removed activity restores its opaque `conditional`
  // marker (a day-conditional strength stays day-conditional across a remove/re-add), not a bare { key }.
  const initialByKey = new Map(initialOrder.map((item) => [item.key, item]));
  const present = new Set(order.map((item) => item.key));
  const available = catalog.filter((c) => !present.has(c.key));
  // The exact config the action re-validates + persists (version single-sourced, marker preserved).
  const routineJson = JSON.stringify({ version: ROUTINE_VERSION, order });

  // Show "Routine saved." only while the CURRENT order still matches what was last persisted — snapshot the
  // saved payload during render when the action flips to ok (`useOnActionSuccess`, not an effect). Any later edit changes `routineJson`, so the stale "saved" message clears and can't mislead the
  // coach into thinking un-submitted edits are persisted.
  const [savedJson, setSavedJson] = useState<string | null>(null);
  useOnActionSuccess(state, () => setSavedJson(routineJson));
  const showSaved = savedJson !== null && savedJson === routineJson;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <input type="hidden" name="routine" value={routineJson} readOnly />

      <section aria-labelledby="routine-order-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="routine-order-heading" className="text-lg font-medium">
            Routine order
          </h2>
          <p className="text-muted-foreground text-sm">Weigh-in always comes first.</p>
        </div>
        {order.length === 0 ? (
          <p className="text-muted-foreground text-sm">No activities yet — add some below.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {order.map((item, i) => {
              const label = labelByKey.get(item.key) ?? item.key;
              return (
                <li key={item.key} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="flex-1 text-base">{label}</span>
                  {/* Always enabled (moveUp/moveDown no-op at the bounds): a `disabled` button that the
                      user has focused would drop keyboard/AT focus to the body when it disables at the
                      boundary — a11y regression. `aria-disabled` marks the inert bound without losing focus. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-disabled={i === 0}
                    onClick={() => setOrder((o) => moveUp(o, i))}
                    aria-label={`Move ${label} up`}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-disabled={i === order.length - 1}
                    onClick={() => setOrder((o) => moveDown(o, i))}
                    aria-label={`Move ${label} down`}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setOrder((o) => toggle(o, item))}
                    aria-label={`Remove ${label} from the routine`}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {available.length > 0 ? (
        <section aria-labelledby="routine-add-heading" className="flex flex-col gap-3">
          <h2 id="routine-add-heading" className="text-lg font-medium">
            Add activity
          </h2>
          <ul className="flex flex-wrap gap-2">
            {available.map((c) => (
              <li key={c.key}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  // Re-add the ORIGINAL item if this key was in the kid's routine (keeps `conditional`);
                  // otherwise a fresh bare item.
                  onClick={() =>
                    setOrder((o) => toggle(o, initialByKey.get(c.key) ?? { key: c.key }))
                  }
                >
                  + {c.label}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div>
        <Button
          type="submit"
          size="lg"
          disabled={pending || order.length === 0}
          className="text-base"
        >
          {pending ? SAVING_LABEL : 'Save routine'}
        </Button>
      </div>

      {showSaved ? (
        <p role="status" className="text-muted-foreground text-sm">
          Routine saved.
        </p>
      ) : state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
