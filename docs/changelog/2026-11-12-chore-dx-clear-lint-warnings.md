- **2026-11-12** — **`pnpm lint` is silent: all eight `no-unused-vars` warnings are gone, and not one
  was suppressed.** Half were genuine dead code — `undo-line.tsx` imported `ANNOUNCE_AFTER_FOCUS_MS`
  and never used it (a leftover from when the focus-then-announce delay moved to `athlete-list.tsx`,
  its one real consumer, which is also where this component's docblock says the live region lives);
  `proxy.ts` still destructured `{ pathname, search }` from the request four lines above its own
  comment saying _"nothing is enforced here any more (AUTH-1 1d)"_; and the snapshot-containment test
  imported `relative` without calling it. The other half were **mock signatures**, which is why they
  could not simply be deleted: the bodyweight DAL test's assertions read `mock.calls[0][1]`, so its
  `(_exec, _args)` were typing a two-argument call — that one became a `vi.fn<…>` generic, and the
  middleware mock's two params were genuinely reachable-but-unread and went. ⚠️ **Deliberately NOT
  done: `argsIgnorePattern: '^_'` in the eslint config.** Four of the eight were underscore-prefixed
  on purpose, so the convention clearly has adherents here — but turning it on is a decision about the
  repo's bar, applying to every unused argument from here on, and it belongs to the maintainer rather
  than to a cleanup PR. _(The four `react-hooks/exhaustive-deps` warnings in `sheet.tsx` were the
  other half of the same lint output and shipped with `PICK-1` PR 3.)_
