/**
 * What the workout editor hands the program page it returns to after a Save (FAM-1 7b-ii's owed
 * follow-up): the page's message, once. Save leaves the editor (`router.replace`), its button
 * unmounts with the page, and Next's router leaves focus where it was, so without this focus drops
 * to `<body>` and nothing says the workout was saved.
 *
 * **Module state, one per document.** A client navigation keeps it, so the program page that mounts
 * next takes it; a reload starts empty, so a page opened fresh never moves focus. It is taken once,
 * and only by the program it names.
 */
let pending: { programPublicId: string; message: string } | null = null;

export function noteArrival(programPublicId: string, message: string): void {
  pending = { programPublicId, message };
}

/** The message left for this program, once; `null` when there is none. */
export function takeArrival(programPublicId: string): string | null {
  if (pending?.programPublicId !== programPublicId) return null;
  const { message } = pending;
  pending = null;
  return message;
}
