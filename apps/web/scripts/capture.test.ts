import { describe, expect, it } from 'vitest';

import { consoleFailure } from './capture';

describe('consoleFailure', () => {
  it('passes a clean console', () => {
    expect(consoleFailure('/p', [])).toBeNull();
  });

  it('names the route, every problem and its viewport, and the escape hatch', () => {
    const msg = consoleFailure('/p', [
      { viewport: 'mobile', type: 'error', text: 'Hydration failed' },
      { viewport: 'desktop', type: 'pageerror', text: 'boom' },
    ]);
    expect(msg).toContain('capture of /p logged 2 console error(s)/warning(s)');
    expect(msg).toContain('[mobile] error: Hydration failed');
    expect(msg).toContain('[desktop] pageerror: boom');
    expect(msg).toContain('--allow-console');
  });
});
