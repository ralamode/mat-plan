// Stub for `import 'server-only'` under Vitest (Node). The real package throws
// when imported outside a React Server Component bundle; in tests, server-only
// modules (env, the DAL, Server Actions) are exercised as plain async functions.
// See AGENTS.md → Server Actions testing gotcha.
export {};
