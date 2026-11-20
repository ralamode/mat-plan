// @vitest-environment jsdom
import type { DayPlan } from '@mat-plan/shared';
import { todayTwoPrograms } from '@mat-plan/shared/program/fixtures';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDayActions } from '@/app/design/program/fakes';

import { PROGRAM_COPY } from './day-copy';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const DIALOG_MODULE = './program-order-dialog';

/**
 * The lazy half of Program order (15c follow-up): the dialog's module is imported on first open, or
 * by a prefetch, and never eagerly. Every case resets the module registry and imports the line
 * fresh, because the loader caches the chunk per module instance, as a browser does per document.
 */
let imports = 0;
let mounts = 0;
let idle: Array<() => void> = [];

/** The real dialog, counted: imported once per fresh registry, mounted once per latch. */
function mockDialog() {
  vi.doMock(DIALOG_MODULE, async (importOriginal) => {
    imports += 1;
    const real = await importOriginal<typeof import('./program-order-dialog')>();
    function ProgramOrderDialog(props: ComponentProps<typeof real.ProgramOrderDialog>) {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <real.ProgramOrderDialog {...props} />;
    }
    return { ProgramOrderDialog };
  });
}

async function freshLine() {
  vi.resetModules();
  return (await import('./program-line')).ProgramLine;
}

function mount(ProgramLine: Awaited<ReturnType<typeof freshLine>>, plan: DayPlan) {
  return render(<ProgramLine plan={plan} actions={createFakeDayActions(plan).actions} />);
}

const orderButton = () => screen.getByRole('button', { name: PROGRAM_COPY.order });

beforeEach(() => {
  imports = 0;
  mounts = 0;
  idle = [];
  // Captured, not run: a case decides when the browser is idle.
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => idle.push(cb));
  vi.stubGlobal('cancelIdleCallback', () => {});
});

afterEach(() => {
  cleanup();
  vi.doUnmock(DIALOG_MODULE);
  vi.unstubAllGlobals();
  window.history.replaceState(null, '');
});

describe('Program order loads its dialog on demand', () => {
  it('the dialog module is not imported until the first open', async () => {
    mockDialog();
    const ProgramLine = await freshLine();
    mount(ProgramLine, todayTwoPrograms);
    expect(orderButton()).toBeTruthy();
    // Let any import started on mount settle, so an eager one would be counted.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(imports).toBe(0);
    fireEvent.click(orderButton());
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(imports).toBe(1);
  });

  it('a failed load keeps the page and the button, and says so under it; a tap retries', async () => {
    vi.doMock(DIALOG_MODULE, () => {
      throw new Error('ChunkLoadError');
    });
    const ProgramLine = await freshLine();
    mount(ProgramLine, todayTwoPrograms);
    fireEvent.click(orderButton());
    const line = await screen.findByText(PROGRAM_COPY.orderOpenFailed);
    expect(line.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(orderButton().getAttribute('aria-describedby')).toBe(
      line.closest('[role="status"]')!.id,
    );
    // The chunk is reachable again: the next tap opens, and the line goes.
    vi.doUnmock(DIALOG_MODULE);
    mockDialog();
    fireEvent.click(orderButton());
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByText(PROGRAM_COPY.orderOpenFailed)).toBeNull();
  });

  it('once opened it stays mounted: through a close, a hidden button and a reopen', async () => {
    // A Back steps off the dialog's entry, as the browser's does, so nothing restores it.
    vi.spyOn(window.history, 'back').mockImplementation(() =>
      window.history.replaceState(null, ''),
    );
    mockDialog();
    const ProgramLine = await freshLine();
    const view = mount(ProgramLine, todayTwoPrograms);
    fireEvent.click(orderButton());
    await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: PROGRAM_COPY.done }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // The latch does not follow `canOrder`: hidden and shown again, the dialog is the same one.
    const hidden = { ...todayTwoPrograms, writable: false };
    view.rerender(<ProgramLine plan={hidden} actions={createFakeDayActions(hidden).actions} />);
    view.rerender(
      <ProgramLine
        plan={todayTwoPrograms}
        actions={createFakeDayActions(todayTwoPrograms).actions}
      />,
    );
    fireEvent.click(orderButton());
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(mounts).toBe(1);
    expect(imports).toBe(1);
    vi.restoreAllMocks();
  });

  it('prefetches on idle only while it can be used, and on focus', async () => {
    mockDialog();
    const ProgramLine = await freshLine();
    const view = mount(ProgramLine, { ...todayTwoPrograms, writable: false });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(idle).toHaveLength(0);
    expect(imports).toBe(0);
    view.unmount();
    mount(ProgramLine, todayTwoPrograms);
    expect(idle).toHaveLength(1);
    await act(async () => idle[0]!());
    expect(imports).toBe(1);
    // Prefetched, not mounted: the dialog mounts on the tap.
    expect(mounts).toBe(0);

    cleanup();
    idle = [];
    mockDialog();
    const Fresh = await freshLine();
    mount(Fresh, todayTwoPrograms);
    await act(async () => {
      fireEvent.focus(orderButton());
    });
    expect(imports).toBe(2);
  });

  it('mounting onto its own history entry loads the dialog, so the sheet can restore it', async () => {
    mockDialog();
    const ProgramLine = await freshLine();
    mount(ProgramLine, todayTwoPrograms);
    fireEvent.click(orderButton());
    await screen.findByRole('dialog');
    const entry = window.history.state;
    // A Back across routes unmounts the line while the browser keeps the entry; Forward remounts it.
    cleanup();
    window.history.replaceState(entry, '');
    mount(ProgramLine, todayTwoPrograms);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
