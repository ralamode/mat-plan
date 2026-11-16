import { SLOT_LABEL_MAX, type Superset } from '@mat-plan/shared';

/** What the superset rules read on a card: its place in a group, and the group's rest. */
export type SupersetMember = { superset: Superset; restAfter: string | null };

/**
 * Keep a workout's supersets well formed after a move or a remove (FAM-1 step 8; plan D14; the
 * prototype's `normalize`). Decided to live here, not at 8b _(maintainer, 2026-11-16)_, so every
 * draft the editor saves is one the writer accepts:
 *
 * - **A group is a run of neighbours.** A group key that comes back after another group is a new
 *   group, under a fresh key.
 * - **A group of one dissolves** (D14: the rule `dissolveSmallSupersets` applies to logged sets,
 *   restated because the draft's `{ group, order }` is not that helper's shape).
 * - `order` runs 1..n, and the group's rest sits on its **last** item (`restAfter`'s contract).
 * - **The rest belongs to the group, not to an item.** It stays with the run that held it, or moves
 *   to the group's surviving run if that one dissolved; it is dropped only when no run of the group
 *   survives.
 *
 * Pure. Returns the items, how many groups ended, which items left a group that goes on, and the
 * rests dropped, so the screen can say each.
 */
export function normalizeSupersets<T extends SupersetMember>(
  items: readonly T[],
): { items: T[]; ended: number; left: number[]; droppedRests: string[] } {
  const runs: { key: string | null; start: number; members: T[] }[] = [];
  items.forEach((item, index) => {
    const key = item.superset?.group ?? null;
    const last = runs.at(-1);
    if (key !== null && last?.key === key) last.members.push(item);
    else runs.push({ key, start: index, members: [item] });
  });

  const survives = (run: (typeof runs)[number]) => run.key !== null && run.members.length > 1;
  // Each group's rest, and the run that keeps it.
  const holders = new Map<(typeof runs)[number], string>();
  const droppedRests: string[] = [];
  let ended = 0;
  for (const key of new Set(runs.flatMap((run) => (run.key === null ? [] : [run.key])))) {
    const ofKey = runs.filter((run) => run.key === key);
    const surviving = ofKey.filter(survives);
    const withRest = ofKey.find((run) => run.members.some((member) => member.restAfter));
    const rest = withRest?.members.find((member) => member.restAfter)?.restAfter ?? null;
    if (!surviving.length) {
      ended += 1;
      if (rest) droppedRests.push(rest);
      continue;
    }
    if (rest) holders.set(withRest && survives(withRest) ? withRest : surviving.at(-1)!, rest);
  }

  const used = new Set<string>();
  const left: number[] = [];
  const out: T[] = [];
  for (const run of runs) {
    if (!survives(run)) {
      run.members.forEach((member, i) => {
        if (
          member.superset &&
          run.key !== null &&
          !droppedFromEndedGroup(runs, run.key, survives)
        ) {
          left.push(run.start + i);
        }
        out.push({ ...member, superset: null, restAfter: null });
      });
      continue;
    }
    const group = freshKey(run.key!, used);
    const rest = holders.get(run) ?? null;
    run.members.forEach((member, i) =>
      out.push({
        ...member,
        superset: { group, order: i + 1 },
        restAfter: i === run.members.length - 1 ? rest : null,
      }),
    );
  }
  return { items: out, ended, left, droppedRests };
}

/** Whether no run of `key` survives: then its items did not "leave" a group, the group ended. */
function droppedFromEndedGroup<R extends { key: string | null }>(
  runs: readonly R[],
  key: string,
  survives: (run: R) => boolean,
): boolean {
  return !runs.some((run) => run.key === key && survives(run));
}

/** `key`, or `key-2`, `key-3`… when an earlier run took it, kept within `SLOT_LABEL_MAX`. */
function freshKey(key: string, used: Set<string>): string {
  let candidate = key;
  for (let n = 2; used.has(candidate); n += 1) {
    const suffix = `-${n}`;
    candidate = `${key.slice(0, SLOT_LABEL_MAX - suffix.length)}${suffix}`;
  }
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
