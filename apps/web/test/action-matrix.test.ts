import { describe, expect, it } from 'vitest';

import { ACTION_SCOPE, type ActionRegistry } from '@/app/p/[profileId]/mutating-actions';

// Type-only, on purpose: importing the suite for real would load the DAL modules it drives, and this
// file mocks none of them. Everything pinned here is a claim about TYPES.
import type {
  ActionBindings,
  ActionFn,
  ValidBodies,
  Writer,
  describeActionMatrices,
} from './action-matrix';

/**
 * 🔴 **The compile-time guarantees of the action matrices, pinned** (FAM-1 step 0b).
 *
 * `docs/features/write-path.md` says a registry entry without a binding is a type error, and that a
 * household-addressed action without a `scopeMiss` is one too. Both were true of one literal typed
 * against one `as const` registry. Step 0b made the binding types generic over each module's own
 * registry, and a generic that quietly widens (to `Record<string, …>`, say) would keep every test
 * green while both sentences stopped being true. WP-1 shipped exactly that kind of claim once
 * (`mutating-actions.test.ts` tells the story), so the claims are probes here, made permanent.
 *
 * **Where this is enforced: `pnpm typecheck`, not `vitest run`.** Each `@ts-expect-error` asserts
 * the line beneath it does NOT compile. If the types loosen, the line starts compiling, the
 * directive goes unused, and `tsc` fails with TS2578. The runtime `describe` at the end is only
 * there so the accepted shapes are exercised and the file is a test.
 */

/** A module's registry in miniature: one action of each addressing, and one excluded. */
const REGISTRY = {
  profileAction: { refusal: 'x', scope: ACTION_SCOPE.profile },
  householdAction: { refusal: 'y', scope: ACTION_SCOPE.household },
  excludedAction: { excluded: { reason: 'r', provenBy: 'p' } },
} as const satisfies ActionRegistry;

type Bindings = ActionBindings<typeof REGISTRY>;
type Bodies = ValidBodies<typeof REGISTRY>;

const fn: ActionFn = async (state) => state;
const write: Writer = () => undefined;
const scopeMiss = { scopeMiss: () => undefined };
const body = () => new FormData();

/** The shapes that MUST be accepted — so the pins below cannot pass by rejecting everything. */
const accepted: Bindings = {
  profileAction: { fn, writers: [write] },
  householdAction: { fn, writers: [write], ...scopeMiss },
};
const acceptedBodies: Bodies = { profileAction: body, householdAction: body };

// @ts-expect-error — a matrix action with no binding (`householdAction` is missing)
const _missingBinding: Bindings = { profileAction: accepted.profileAction };
void _missingBinding;

// @ts-expect-error — a household-addressed action must say how its scope is made to miss
const _householdWithoutMiss: Bindings['householdAction'] = { fn, writers: [write] };
void _householdWithoutMiss;

// @ts-expect-error — and a profile-addressed one may not carry a `scopeMiss` it would never use
const _profileWithMiss: Bindings['profileAction'] = { fn, writers: [write], ...scopeMiss };
void _profileWithMiss;

// @ts-expect-error — `writers` is a non-empty tuple: a binding cannot claim an action writes nothing
const _noWriters: Bindings['profileAction'] = { fn, writers: [] };
void _noWriters;

// @ts-expect-error — a matrix action with no valid body (`householdAction` is missing)
const _missingBody: Bodies = { profileAction: body };
void _missingBody;

/**
 * An EXCLUDED action has no slot in either table, so it cannot be given a binding. Stated as a type
 * that is `true` only while the key is absent, rather than as a sixth directive: an excess property
 * in a literal is reported on the property's own line, which a formatter is free to move.
 */
const excludedHasNoBinding: 'excludedAction' extends keyof Bindings ? never : true = true;
const excludedHasNoBody: 'excludedAction' extends keyof Bodies ? never : true = true;

/**
 * The same requirement at the CALL, which is where a module's test meets it. `NoInfer` on the two
 * tables is what keeps the registry the only thing `R` is inferred from; without it a thin
 * `bindings` literal could narrow `R` to fit itself and compile.
 */
type CallOptions = Parameters<typeof describeActionMatrices<typeof REGISTRY>>[0];

// @ts-expect-error — the call refuses a bindings table that skips a registry entry
const _callMissingBinding: CallOptions['bindings'] = { profileAction: accepted.profileAction };
void _callMissingBinding;

const callAccepted: CallOptions['bindings'] = accepted;

describe('the action-matrix types hold a module to its registry', () => {
  it('accepts a binding and a body for each matrix action, and nothing for an excluded one', () => {
    const matrixNames = ['profileAction', 'householdAction'];
    expect(Object.keys(accepted)).toEqual(matrixNames);
    expect(Object.keys(acceptedBodies)).toEqual(matrixNames);
    expect(Object.keys(callAccepted)).toEqual(matrixNames);
    expect(Object.keys(REGISTRY)).toContain('excludedAction');
    expect([excludedHasNoBinding, excludedHasNoBody]).toEqual([true, true]);
  });
});
