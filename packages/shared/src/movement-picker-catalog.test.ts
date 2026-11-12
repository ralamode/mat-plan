import { describe, expect, it } from 'vitest';

import { MOVEMENT_SEED_ROWS } from './catalog-movements';
import {
  MOVEMENT_PICKER_ALIASES,
  MOVEMENT_PICKER_ENTRIES,
  MOVEMENT_PICKER_GROUP_LABELS,
  MOVEMENT_PICKER_GROUPS,
  movementPickerSlugsByGroup,
  movementPickerGroupSchema,
  RECENT_MOVEMENTS_LIMIT,
} from './movement-picker-catalog';
import { movementNameKey } from './movement-search';

describe('MOVEMENT_PICKER_ENTRIES (PICK-1 Decision 3)', () => {
  it('🔴 covers EXACTLY the seeded slugs — no extras, no gaps', () => {
    // This is the assertion that makes "no `other` group" true by construction. A `CAT-2` row added
    // without a group fails here rather than quietly disappearing from the browse list, and an entry
    // for a slug the seed dropped fails too — an allowlist that cannot go stale.
    expect(Object.keys(MOVEMENT_PICKER_ENTRIES).sort()).toEqual(
      MOVEMENT_SEED_ROWS.map((row) => row.slug).sort(),
    );
  });

  it('puts every entry in a declared group', () => {
    for (const [slug, entry] of Object.entries(MOVEMENT_PICKER_ENTRIES)) {
      expect(movementPickerGroupSchema.safeParse(entry.group).success, slug).toBe(true);
    }
  });

  it('labels every group', () => {
    expect(Object.keys(MOVEMENT_PICKER_GROUP_LABELS).sort()).toEqual(
      [...MOVEMENT_PICKER_GROUPS].sort(),
    );
  });

  it('matches the prototype the maintainer approved: Push 7, Pull 7, Legs 14, Core 7', () => {
    // The shape chunk 0 confirms. Asserted as counts because that is what was approved with v8/v9;
    // a regroup is a decision, and it should have to change this line.
    expect({
      push: movementPickerSlugsByGroup('push').length,
      pull: movementPickerSlugsByGroup('pull').length,
      legs: movementPickerSlugsByGroup('legs').length,
      core: movementPickerSlugsByGroup('core').length,
      wrestling: movementPickerSlugsByGroup('wrestling').length,
    }).toEqual({ push: 7, pull: 7, legs: 14, core: 7, wrestling: 0 });
  });

  it('declares `wrestling` and leaves it empty until C3', () => {
    expect(MOVEMENT_PICKER_GROUPS).toContain('wrestling');
    expect(movementPickerSlugsByGroup('wrestling')).toEqual([]);
  });

  it('every slug lands in exactly one group, and the groups partition the seed', () => {
    const grouped = MOVEMENT_PICKER_GROUPS.flatMap((g) => movementPickerSlugsByGroup(g));
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped.length).toBe(MOVEMENT_SEED_ROWS.length);
  });

  it('keeps each group in MOVEMENT_SEED_ROWS order', () => {
    // Deterministic rendering: the browse list must not depend on object key order.
    for (const group of MOVEMENT_PICKER_GROUPS) {
      const slugs = movementPickerSlugsByGroup(group);
      const seedOrder = MOVEMENT_SEED_ROWS.map((r) => r.slug).filter((s) => slugs.includes(s));
      expect(slugs).toEqual(seedOrder);
    }
  });
});

describe('the aliases', () => {
  it("ships the prototype's six", () => {
    expect(MOVEMENT_PICKER_ALIASES.map((a) => a.alias).sort()).toEqual(
      ['BSS', 'DB bench', 'KB', 'OHP', 'RDL', 'hip thrust'].sort(),
    );
  });

  it('points every alias at a seeded slug', () => {
    const slugs = new Set(MOVEMENT_SEED_ROWS.map((r) => r.slug));
    for (const { alias, slug } of MOVEMENT_PICKER_ALIASES)
      expect(slugs.has(slug), alias).toBe(true);
  });

  it("🔴 no alias key collides with another alias, or with any movement's own key", () => {
    // An alias that folds to a movement's key would make the picker claim a movement is "also called"
    // its own name; two aliases sharing a key would make one of them unreachable. Both are silent.
    const aliasKeys = MOVEMENT_PICKER_ALIASES.map((a) => movementNameKey(a.alias));
    expect(new Set(aliasKeys).size).toBe(aliasKeys.length);
    const nameKeys = new Set(MOVEMENT_SEED_ROWS.map((r) => movementNameKey(r.name)));
    for (const key of aliasKeys) expect(nameKeys.has(key), key).toBe(false);
  });
});

describe('RECENT_MOVEMENTS_LIMIT', () => {
  // The contract test that pins the value, exactly once (AGENTS.md → constants).
  it('is 5', () => {
    expect(RECENT_MOVEMENTS_LIMIT).toBe(5);
  });
});
