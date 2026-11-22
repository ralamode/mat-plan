/**
 * What the day page's live region holds: one keyed sentence each (`Announcer`'s `messages`), so a
 * sentence added beside another is read alone and the one before it is not read again.
 *
 * - **This phone's own sentence** (a ✓, a failure, a cancel) replaces what this phone said before:
 *   three quick ✓s are three single sentences, never a stack (TalkBack reads a region's whole text
 *   on a change, so a stack is heard as "A", "A B", "A B C"; #786).
 * - **Another phone's change** (`elsewhere`) is added beside what is there, and survives this
 *   phone's next sentence for `ANNOUNCE_TOGETHER_MS`: a ✓ and the refresh it brings are both read,
 *   whichever lands first.
 * - At most `MAX_ANNOUNCEMENTS`, the oldest dropped.
 */

/** How long another phone's sentence stays beside this phone's next one. */
export const ANNOUNCE_TOGETHER_MS = 1500;
/** The most sentences the region holds at once. */
export const MAX_ANNOUNCEMENTS = 3;

export type AnnouncementKind = 'local' | 'elsewhere';
export type Announcement = { key: number; text: string; at: number; kind: AnnouncementKind };

/** The region after one more sentence. `key` is new each call, so a repeat is a new node. */
export function nextAnnouncements(
  held: readonly Announcement[],
  text: string,
  kind: AnnouncementKind,
  key: number,
  now: number,
): Announcement[] {
  const young = (a: Announcement) => now - a.at >= 0 && now - a.at < ANNOUNCE_TOGETHER_MS;
  const kept = held.filter((a) => young(a) && (kind === 'elsewhere' || a.kind === 'elsewhere'));
  return [...kept, { key, text, at: now, kind }].slice(-MAX_ANNOUNCEMENTS);
}
