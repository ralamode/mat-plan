/**
 * A one-shot focus hand-off between two client islands that share no parent (V1-9b B2-prep; plan
 * `docs/plans/v1-9b-delete-and-restore.md` § "B2 as amended", panel row R2). Clear this day's dialog
 * claims focus for the banner's Restore all; the banner mounts after the revalidated page renders,
 * which can be before or after the claim is made, so neither order may lose it.
 *
 * - **`claim(key, targetId, trigger?)`** — focus the element with `targetId` now if it is mounted and
 *   focus is "nowhere", else wait for it. `key` names the hand-off (an athlete and a day), so a claim
 *   made on one day's page is never taken by another's.
 * - **`take(key, node)`** — from the target's ref callback: if a claim for `key` names this node's
 *   id, focus it and end the claim.
 * - **`expire(key)`** — end a claim.
 *
 * Focus is **"nowhere"** when it is on `<body>`, on `<main>`, on the claiming island's own `trigger`
 * (where a closing Sheet returns it), or on nothing. A claim never takes focus from anywhere else,
 * and it **expires as soon as the person moves focus elsewhere or taps**: a late mount must never pull
 * someone back from where they went. The Sheet's own focus return lands on the trigger, which is
 * "nowhere", so it does not expire the claim.
 *
 * **A claim also lapses after `CLAIM_TTL_MS`.** A target that never mounts (an athlete archived
 * meanwhile, so no banner) would otherwise leave a claim that Back and a soft navigation do not end
 * (neither fires `focusin` or a tap), and a later visit to that day would pull focus to it. A caller
 * should also `expire` its claim when it unmounts.
 *
 * `single-value-live.tsx` keeps its own claim: that is one island, where a context reaches every
 * target. This module is the cross-island case, not a second copy of it.
 */

/** How long a claim waits for its target: long enough for a revalidated page on a slow phone. */
export const CLAIM_TTL_MS = 10_000;

type Claim = { targetId: string; trigger: HTMLElement | null; until: number };

const claims = new Map<string, Claim>();
let listening = false;

function isNowhere(active: Element | null, trigger: HTMLElement | null): boolean {
  return (
    active === null ||
    active === document.body ||
    active.tagName === 'MAIN' ||
    (trigger !== null && active === trigger)
  );
}

/** Focus `node` for a claim. The claim ends BEFORE `focus()`, so its own `focusin` expires nothing. */
function focusFor(key: string, node: HTMLElement): void {
  claims.delete(key);
  node.focus();
}

function listen(): void {
  if (listening) return;
  listening = true;
  // A person's focus elsewhere ends every claim it is not "nowhere" for; a tap ends them all.
  document.addEventListener('focusin', (e) => {
    for (const [key, c] of claims) {
      if (!isNowhere(e.target instanceof Element ? e.target : null, c.trigger)) claims.delete(key);
    }
  });
  document.addEventListener('pointerdown', () => claims.clear());
}

export function claim(key: string, targetId: string, trigger: HTMLElement | null = null): void {
  if (typeof document === 'undefined') return;
  listen();
  if (!isNowhere(document.activeElement, trigger)) return;
  const node = document.getElementById(targetId);
  if (node) return focusFor(key, node);
  claims.set(key, { targetId, trigger, until: Date.now() + CLAIM_TTL_MS });
}

export function take(key: string, node: HTMLElement | null): void {
  if (!node) return;
  const c = claims.get(key);
  if (!c || node.id !== c.targetId) return;
  if (Date.now() > c.until || !isNowhere(document.activeElement, c.trigger)) {
    claims.delete(key);
    return;
  }
  focusFor(key, node);
}

export function expire(key: string): void {
  claims.delete(key);
}
