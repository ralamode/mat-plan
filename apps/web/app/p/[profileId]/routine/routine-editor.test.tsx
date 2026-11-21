// @vitest-environment jsdom
import { ACTIVITY_TYPE_KEYS, makeRoutineKey, STRENGTH_KEY } from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({
  editRoutineAction: vi.fn(async () => ({ ok: true, error: null })),
}));

import { ROUTINE_COPY } from '@/lib/constants';
import { routineCatalogItems } from '@/lib/routine/catalog';

import { RoutineEditor } from './routine-editor';

afterEach(cleanup);

const PRACTICE = makeRoutineKey('life', ACTIVITY_TYPE_KEYS.wrestling_practice);
const practiceLabel = routineCatalogItems()[0]!.label;

/** What Save would post: the hidden `routine` field, parsed. */
const posted = (container: HTMLElement) =>
  JSON.parse(
    (container.querySelector('input[name="routine"]') as HTMLInputElement).value,
  ) as unknown;

/**
 * FAM-1 12f PR 5: the editor lists Life items only and posts `savedOrder`'s result. The pure function
 * has its own tests (`lib/routine/catalog.test.ts`); these pin how the editor CALLS it: `initial` is the
 * whole resolved routine (so `strength` and its marker are carried), and `strength` is never a row.
 */
describe('RoutineEditor — what Save posts (12f PR 5)', () => {
  it('a day-conditional strength, never listed, is posted with its marker', () => {
    const { container } = render(
      <RoutineEditor
        profileId="p"
        initialOrder={[{ key: STRENGTH_KEY, conditional: true }]}
        catalog={routineCatalogItems()}
      />,
    );
    expect(screen.queryByText(STRENGTH_KEY)).toBeNull();
    expect(posted(container)).toEqual({
      version: 1,
      order: [{ key: STRENGTH_KEY, conditional: true }],
    });
  });

  it('adding practice appends it after strength, which keeps its marker', () => {
    const { container } = render(
      <RoutineEditor
        profileId="p"
        initialOrder={[{ key: STRENGTH_KEY, conditional: true }]}
        catalog={routineCatalogItems()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: `+ ${practiceLabel}` }));
    expect(posted(container)).toEqual({
      version: 1,
      order: [{ key: STRENGTH_KEY, conditional: true }, { key: PRACTICE }],
    });
  });

  it('removing the only listed item posts strength alone, and Save stays enabled', () => {
    const { container } = render(
      <RoutineEditor
        profileId="p"
        initialOrder={[{ key: STRENGTH_KEY }, { key: PRACTICE }]}
        catalog={routineCatalogItems()}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: `Remove ${practiceLabel} from the routine` }),
    );
    expect(posted(container)).toEqual({ version: 1, order: [{ key: STRENGTH_KEY }] });
    expect(
      (screen.getByRole('button', { name: ROUTINE_COPY.save }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('RoutineEditor — "Routine saved." is heard (day-page a11y)', () => {
  const editor = () =>
    render(
      <RoutineEditor
        profileId="p"
        initialOrder={[{ key: STRENGTH_KEY, conditional: true }]}
        catalog={routineCatalogItems()}
      />,
    );

  it('its status region is mounted, empty, before any save: a region that mounts full is silent', () => {
    editor();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('each save is a new node, so saving the same routine again is said again', async () => {
    editor();
    const save = screen.getByRole('button', { name: ROUTINE_COPY.save });
    await act(async () => fireEvent.click(save));
    const region = screen.getByRole('status');
    expect(region.textContent).toBe(ROUTINE_COPY.saved);
    const first = region.firstChild;
    await act(async () => fireEvent.click(save));
    expect(region.textContent).toBe(ROUTINE_COPY.saved);
    expect(region.firstChild).not.toBe(first);
  });
});
