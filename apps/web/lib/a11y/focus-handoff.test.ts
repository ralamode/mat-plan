// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLAIM_TTL_MS, claim, expire, take } from './focus-handoff';

const KEY = 'athlete-1/2026-11-19';
const TARGET = 'restore-all';

function button(id?: string): HTMLButtonElement {
  const b = document.createElement('button');
  if (id) b.id = id;
  document.body.append(b);
  return b;
}

describe('the cross-island focus hand-off', () => {
  afterEach(() => {
    vi.useRealTimers();
    expire(KEY);
    expire('other');
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.replaceChildren();
  });

  it('focuses a target that is already mounted when the claim is made', () => {
    const target = button(TARGET);
    claim(KEY, TARGET);
    expect(document.activeElement).toBe(target);
  });

  it('waits for a target that mounts after the claim, and focuses it from its ref callback', () => {
    claim(KEY, TARGET);
    const target = button(TARGET);
    take(KEY, target);
    expect(document.activeElement).toBe(target);
  });

  it('is used once', () => {
    claim(KEY, TARGET);
    const first = button(TARGET);
    take(KEY, first);
    first.blur();
    take(KEY, first);
    expect(document.activeElement).not.toBe(first);
  });

  it('a claim for one key is never taken by another', () => {
    claim('other', TARGET);
    const target = button(TARGET);
    take(KEY, target);
    expect(document.activeElement).not.toBe(target);
  });

  it("the claiming island's trigger counts as nowhere, so the Sheet's focus return keeps the claim", () => {
    const trigger = button();
    trigger.focus();
    claim(KEY, TARGET, trigger);
    trigger.focus(); // the Sheet hands focus back to its trigger
    const target = button(TARGET);
    take(KEY, target);
    expect(document.activeElement).toBe(target);
  });

  it("the person's own focus elsewhere expires it, and a late mount does not pull them back", () => {
    claim(KEY, TARGET);
    const elsewhere = button();
    elsewhere.focus();
    const target = button(TARGET);
    take(KEY, target);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('a tap expires it', () => {
    claim(KEY, TARGET);
    document.dispatchEvent(new Event('pointerdown'));
    const target = button(TARGET);
    take(KEY, target);
    expect(document.activeElement).not.toBe(target);
  });

  it('lapses when its target has not mounted in time, so a later visit is not pulled to it', () => {
    vi.useFakeTimers();
    claim(KEY, TARGET);
    vi.advanceTimersByTime(CLAIM_TTL_MS + 1);
    const target = button(TARGET);
    take(KEY, target);
    expect(document.activeElement).not.toBe(target);
  });

  it('never takes focus from somewhere real when the claim is made', () => {
    const elsewhere = button();
    elsewhere.focus();
    button(TARGET);
    claim(KEY, TARGET);
    expect(document.activeElement).toBe(elsewhere);
  });
});
