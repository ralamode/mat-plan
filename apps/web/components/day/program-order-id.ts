/**
 * Program order's sheet id, in a module of its own so the button half (`program-order-button.tsx`)
 * and the tests can name it without importing the lazily loaded dialog. Its status region's id is
 * derived from it (`sheetStatusId`), and the sheet writes it into `history.state`.
 */
export const PROGRAM_ORDER_SHEET_ID = 'program-order';
