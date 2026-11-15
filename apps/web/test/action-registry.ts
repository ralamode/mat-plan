import { existsSync, globSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { ActionRegistry } from '@/app/p/[profileId]/mutating-actions';

import { serverActionModules, WEB_DIR } from './source-scan';

/**
 * **The action registry, composed from one file per Server Action module** (FAM-1 step 0b).
 *
 * `MUTATING_ACTIONS` used to be one literal that every new action extended. It is now the merge of
 * each module's own `ACTION_REGISTRY`, found by NAME rather than listed: for a module `x-actions.ts`
 * the entries are in `x-actions.registry.ts` beside it. So a new module adds files and edits none,
 * and two lanes adding modules cannot collide here. The rule, and the three files a module adds, are
 * in `app/p/[profileId]/mutating-actions.ts`.
 *
 * ⚠️ **TEST SUPPORT, and that is why discovery is allowed to live here.** It reads the filesystem
 * and imports by a computed path, which no module under `app/` should do. Nothing in the app imports
 * the merged registry: its consumers are `actions.test.ts` (the on-disk cross-check),
 * `mutating-actions.test.ts` (the pins) and `test/action-matrix.ts` (the per-module matrices).
 *
 * ⚠️ **Discovery starts from the MODULES, not from a glob of registry files.** A glob would report
 * only the registries that exist, so a module with none would simply be absent and the merged
 * registry would look complete. Starting from `serverActionModules()` makes the missing file a named
 * `null`, which `actions.test.ts` turns into a failure that says which file to add.
 */

/** The one export every `*.registry.ts` carries. */
export const REGISTRY_EXPORT = 'ACTION_REGISTRY';

const SOURCE_EXT = /\.[cm]?[jt]sx?$/;

/** `x-actions.ts` → `x-actions.registry.ts`: where that module's registry entries live. */
export const registryFileFor = (moduleFile: string): string =>
  moduleFile.replace(SOURCE_EXT, '.registry.ts');

/** `x-actions.ts` → `x-actions.test.ts`: the test that runs the matrices over them. */
export const matrixTestFileFor = (moduleFile: string): string =>
  moduleFile.replace(SOURCE_EXT, '.test.ts');

/** A module's registry, or `null` when the file or its export is missing. Absolute path in. */
export async function loadActionRegistry(registryFile: string): Promise<ActionRegistry | null> {
  if (!existsSync(registryFile)) return null;
  const mod: Record<string, unknown> = await import(/* @vite-ignore */ registryFile);
  return (mod[REGISTRY_EXPORT] as ActionRegistry | undefined) ?? null;
}

/** One Server Action module and the registry beside it. Paths are relative to `apps/web`. */
export type RegistryShard = {
  readonly module: string;
  readonly registryFile: string;
  readonly testFile: string;
  /** `null` when the module has no registry file, or the file lacks `ACTION_REGISTRY`. */
  readonly registry: ActionRegistry | null;
};

/** Every Server Action module under `apps/web`, each with its registry (or the lack of one). */
export const REGISTRY_SHARDS: readonly RegistryShard[] = await Promise.all(
  serverActionModules().map(async (moduleFile) => ({
    module: relative(WEB_DIR, moduleFile),
    registryFile: relative(WEB_DIR, registryFileFor(moduleFile)),
    testFile: relative(WEB_DIR, matrixTestFileFor(moduleFile)),
    registry: await loadActionRegistry(registryFileFor(moduleFile)),
  })),
);

/**
 * **Every action this app exposes, in or out of the matrices**: all the modules' entries in one
 * object. The name is the one the old literal had, because it is still the answer to the same
 * question.
 *
 * ⚠️ A plain merge, so a name registered by two modules would silently collapse to one entry.
 * `actions.test.ts` pins that the merged size equals the sum of the parts.
 */
export const MUTATING_ACTIONS: ActionRegistry = Object.assign(
  {},
  ...REGISTRY_SHARDS.map((shard) => shard.registry ?? {}),
);

/** Every `*.registry.ts` on disk, relative to `apps/web` — to catch one that no module owns. */
export const registryFilesOnDisk = (): string[] =>
  globSync('**/*.registry.ts', { cwd: WEB_DIR })
    .filter((f) => !/(^|\/)(node_modules|\.next)\//.test(f))
    .map((f) => relative(WEB_DIR, join(WEB_DIR, f)))
    .sort();
