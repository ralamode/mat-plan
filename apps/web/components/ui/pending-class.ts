/**
 * A pending button: `aria-disabled` (a disabled one drops focus to <body>), which `Button` does
 * not style, so it is dimmed here.
 *
 * A plain module, not `sheet-form-footer.tsx`: that file is `'use client'`, and a constant read
 * from it in a Server Component is a client reference, not the string.
 */
export const PENDING_CLASS = 'aria-disabled:opacity-60';
