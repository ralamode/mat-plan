import type { Superset } from '@mat-plan/shared';

/** What the superset rules read on a card: its place in a group, and the group's rest. */
export type SupersetMember = { superset: Superset; restAfter: string | null };

/**
 * Keep a workout's supersets well formed after a move or a remove (FAM-1 step 8; plan D14; the
 * prototype's `normalize`). Decided to live here, not at 8b _(maintainer, 2026-11-16)_, so every
 * draft the editor saves is one the writer accepts:
 *
 * - **A group is a run of neighbours.** A group key that comes back after another group is a new
 *   group, under a fresh key.
 * - **A group of one dissolves**, and its rest goes with it (D14: the rule `dissolveSmallSupersets`
 *   applies to logged sets, restated because the draft's `{ group, order }` is not that helper's
 *   shape).
 * - `order` runs 1..n, and the group's rest sits on its **last** item (`restAfter`'s contract).
 *
 * Pure: returns new items, and the rests it had to drop, so the screen can say so.
 */
export function normalizeSupersets<T extends SupersetMember>(
  items: readonly T[],
): { items: T[]; droppedRests: string[] } {
  const runs: { key: string | null; members: T[] }[] = [];
  for (const item of items) {
    const key = item.superset?.group ?? null;
    const last = runs.at(-1);
    if (key !== null && last?.key === key) last.members.push(item);
    else runs.push({ key, members: [item] });
  }

  const used = new Set<string>();
  const droppedRests: string[] = [];
  const out: T[] = [];
  for (const { key, members } of runs) {
    const rest = members.find((member) => member.restAfter)?.restAfter ?? null;
    if (key === null || members.length < 2) {
      if (key !== null && rest) droppedRests.push(rest);
      out.push(...members.map((member) => ({ ...member, superset: null, restAfter: null })));
      continue;
    }
    const group = freshKey(key, used);
    out.push(
      ...members.map((member, index) => ({
        ...member,
        superset: { group, order: index + 1 },
        restAfter: index === members.length - 1 ? rest : null,
      })),
    );
  }
  return { items: out, droppedRests };
}

/** `key`, or `key-2`, `key-3`… when an earlier run already took it. */
function freshKey(key: string, used: Set<string>): string {
  let candidate = key;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${key}-${n}`;
  used.add(candidate);
  return candidate;
}

/**
 * The letter each card shows (A1, A2, B1), or `null` for an item on its own. Ordinal, never the
 * key (`supersetSchema`'s rule): the letter is the order in which each group first appears, the
 * number is the item's place among that group's items.
 */
export function supersetLabels(items: readonly SupersetMember[]): (string | null)[] {
  const letters = new Map<string, string>();
  const counts = new Map<string, number>();
  return items.map(({ superset }) => {
    if (!superset) return null;
    if (!letters.has(superset.group)) {
      letters.set(superset.group, String.fromCharCode(65 + letters.size));
    }
    const n = (counts.get(superset.group) ?? 0) + 1;
    counts.set(superset.group, n);
    return `${letters.get(superset.group)}${n}`;
  });
}
