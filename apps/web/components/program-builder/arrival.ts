/**
 * What the workout editor hands the program page it returns to after a Save (FAM-1 7b-ii's owed
 * follow-up): the page's message, once. Save leaves the editor (`router.replace`), its button
 * unmounts with the page, and Next's router leaves focus where it was, so without this focus drops
 * to `<body>` and nothing says the workout was saved.
 *
 * **Module state, one per document.** A client navigation keeps it, so the program page that mounts
 * next takes it; a reload starts empty, so a page opened fresh never moves focus. It is taken once,
 * and only by the program it names, and only within `ARRIVAL_MS` of the Save: a navigation that
 * failed must not leave a message for a program page opened minutes later.
 */
export const ARRIVAL_MS = 5_000;

let pending: { programPublicId: string; message: string; at: number } | null = null;

export function noteArrival(programPublicId: string, message: string, now = Date.now()): void {
  pending = { programPublicId, message, at: now };
}

/** The message left for this program, once and while fresh; `null` when there is none. */
export function takeArrival(programPublicId: string, now = Date.now()): string | null {
  if (pending?.programPublicId !== programPublicId) return null;
  const { message, at } = pending;
  pending = null;
  return now - at <= ARRIVAL_MS ? message : null;
}
