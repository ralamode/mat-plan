import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import { LOCAL_DB_DIR } from './local-db';

/**
 * Wipe the PERSISTENT local-dev sandbox DB (chore/local-dev-db) so the next `pnpm dev`
 * starts from a fresh, freshly-seeded cluster. Only ever removes the fixed `.local-db`
 * data dir — it touches nothing else, and never Neon. Stop `pnpm dev` first (the
 * embedded Postgres holds the dir open while running).
 *
 * tsx/CJS caveat (docs/lessons.md): wrapped in `async function main()`.
 */
async function main(): Promise<void> {
  if (!existsSync(LOCAL_DB_DIR)) {
    console.log(`▸ nothing to reset — ${LOCAL_DB_DIR} does not exist.`);
    return;
  }
  await rm(LOCAL_DB_DIR, { recursive: true, force: true });
  console.log(`✓ wiped local dev DB (${LOCAL_DB_DIR}). Next \`pnpm dev\` starts fresh.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
