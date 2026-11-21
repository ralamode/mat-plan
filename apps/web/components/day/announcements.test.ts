import { describe, expect, it } from 'vitest';

import {
  ANNOUNCE_TOGETHER_MS,
  MAX_ANNOUNCEMENTS,
  type Announcement,
  nextAnnouncements,
} from './announcements';

/** Says `steps` in order, each `[text, kind, at]`, and returns what the region holds. */
function run(steps: readonly [string, Announcement['kind'], number][]) {
  let held: Announcement[] = [];
  steps.forEach(([text, kind, at], i) => (held = nextAnnouncements(held, text, kind, i + 1, at)));
  return held;
}
const texts = (held: readonly Announcement[]) => held.map((a) => a.text);

describe('nextAnnouncements', () => {
  it('this phone’s own sentences replace each other: three quick ✓s are one sentence', () => {
    expect(
      texts(
        run([
          ['A', 'local', 0],
          ['B', 'local', 100],
          ['C', 'local', 200],
        ]),
      ),
    ).toEqual(['C']);
  });

  it('another phone’s change is said beside this phone’s ✓, whichever lands first', () => {
    expect(
      texts(
        run([
          ['tick', 'local', 0],
          ['other', 'elsewhere', 40],
        ]),
      ),
    ).toEqual(['tick', 'other']);
    expect(
      texts(
        run([
          ['other', 'elsewhere', 0],
          ['tick', 'local', 40],
        ]),
      ),
    ).toEqual(['other', 'tick']);
  });

  it('past ANNOUNCE_TOGETHER_MS, it does not survive this phone’s next sentence', () => {
    expect(
      texts(
        run([
          ['other', 'elsewhere', 0],
          ['tick', 'local', ANNOUNCE_TOGETHER_MS],
        ]),
      ),
    ).toEqual(['tick']);
  });

  it('this phone’s earlier sentence never stays beside its next one, even with another phone’s between', () => {
    expect(
      texts(
        run([
          ['tick', 'local', 0],
          ['other', 'elsewhere', 10],
          ['tick 2', 'local', 20],
        ]),
      ),
    ).toEqual(['other', 'tick 2']);
  });

  it('holds at most MAX_ANNOUNCEMENTS, the oldest dropped', () => {
    const held = run(
      Array.from({ length: MAX_ANNOUNCEMENTS + 2 }, (_, i) => [`e${i}`, 'elsewhere', i] as const),
    );
    expect(held).toHaveLength(MAX_ANNOUNCEMENTS);
    expect(held.at(-1)!.text).toBe(`e${MAX_ANNOUNCEMENTS + 1}`);
  });

  it('a kept sentence keeps its key; a repeat is a new key', () => {
    const held = run([
      ['tick', 'local', 0],
      ['other', 'elsewhere', 10],
      ['other', 'elsewhere', 20],
    ]);
    expect(held.map((a) => a.key)).toEqual([1, 2, 3]);
  });
});
