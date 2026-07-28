/**
 * Pure superset-grouping transforms for the strength form (V1-8-3d). Extracted from the React component
 * so the group / ungroup / dissolve-below-2 transitions are unit-tested independent of rendering — they
 * are the form's highest-risk new logic (a bug here makes the ≥2 superRefine reject on submit). Generic
 * over the minimal movement shape (`clientId` + the optional superset tags).
 */
export type SupersetTaggable = {
  clientId: string;
  supersetClientId?: string;
  supersetOrder?: number;
};

/** Tag the selected movements (only if ≥2) as ONE new superset — `supersetOrder` is 1-based in their
 *  current array order (the alternating order). Fewer than 2 selected is a no-op. */
export function groupSelected<T extends SupersetTaggable>(
  movements: readonly T[],
  selected: ReadonlySet<string>,
  supersetClientId: string,
): T[] {
  const count = movements.filter((m) => selected.has(m.clientId)).length;
  if (count < 2) return [...movements];
  let order = 0;
  return movements.map((m) =>
    selected.has(m.clientId) ? { ...m, supersetClientId, supersetOrder: ++order } : m,
  );
}

/** Strip a superset's tags off all its members (explicit ungroup). */
export function ungroupSuperset<T extends SupersetTaggable>(
  movements: readonly T[],
  supersetClientId: string,
): T[] {
  return movements.map((m) =>
    m.supersetClientId === supersetClientId
      ? { ...m, supersetClientId: undefined, supersetOrder: undefined }
      : m,
  );
}

/** Dissolve any superset that has dropped below 2 members (call after a remove/ungroup): strip the tags
 *  off the survivors so no lone member reaches the ≥2 superRefine. A no-op when every superset is ≥2. */
export function dissolveSmallSupersets<T extends SupersetTaggable>(movements: readonly T[]): T[] {
  const counts = new Map<string, number>();
  for (const m of movements) {
    if (m.supersetClientId)
      counts.set(m.supersetClientId, (counts.get(m.supersetClientId) ?? 0) + 1);
  }
  return movements.map((m) =>
    m.supersetClientId && (counts.get(m.supersetClientId) ?? 0) < 2
      ? { ...m, supersetClientId: undefined, supersetOrder: undefined }
      : m,
  );
}
