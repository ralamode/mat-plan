/**
 * The clear's outcome line, between its two islands (V1-9b B2-ii): the dialog at the foot reports,
 * the banner at the top shows. They share no parent (the page is a Server Component), so a small
 * module-level channel carries the text, keyed by athlete and day as `focus-handoff.ts` keys its
 * claims, so one day's report never lands on another's banner.
 */
type Listener = (text: string) => void;

const listeners = new Map<string, Set<Listener>>();

/** The key both islands use: one athlete's one day. */
export function clearDayKey(profileId: string, day: string): string {
  return `clear-day/${profileId}/${day}`;
}

/** The banner subscribes; the returned function unsubscribes. */
export function onClearOutcome(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** The dialog reports. No banner mounted for `key` means nobody is told, which is the right answer. */
export function reportClearOutcome(key: string, text: string): void {
  for (const listener of listeners.get(key) ?? []) listener(text);
}
