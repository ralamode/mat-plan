import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config (tooling — reads process.env directly; this is not app
 * runtime, so it's outside the DAL rule). Migrations run against the DIRECT /
 * unpooled Neon string; GitHub Actions is the single migrator (never the Vercel
 * build). `generate` needs no DB; `migrate`/`check` use the credentials below.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '',
  },
});
