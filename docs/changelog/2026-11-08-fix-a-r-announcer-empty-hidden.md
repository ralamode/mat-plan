---
id: PROF-1 a-r
pr: pending
---

## The rename form's "Name saved." was not announced

`apps/web/components/ui/announcer.tsx` shipped at `PROF-1 a-r` with two rules, the first being
_"render it in BOTH states, mounted before the message exists — a screen reader announces **changes**
to a region that already existed; a region that mounts with its text is silent."_ Its first and only
consumer then passed `className="… empty:hidden"`.

`:empty` → `display: none` takes the element **out of the accessibility tree** while the message is
`''`. When the rename succeeds, the text and the un-hiding land in one commit — which is a region
that mounts with its text. Rule 1, defeated by a mechanism that does not look like mounting.

**What it cost.** On the path with no `?from` the form does not navigate, so that line is the only
confirmation a screen-reader user gets that the rename saved. (With `?from` the JS path calls
`router.back()` and Next's route announcer takes over, which is why it was not total.) Found by the
UX a11y lens reviewing `PROF-1 b`'s plan — b was about to copy this component's one example.

**The fix is `min-h-5`, not nothing.** The region stays in the tree and the empty line is reserved,
which also removes the layout shift the hidden version caused when the message appeared.

## And a scan, because the rule was already written down

Rule 3 is now explicit in the component ("never pass a class that HIDES it while empty"), but a third
sentence in a docblock is what already failed here. `announcer.test.tsx` now globs every `.tsx` under
`app/` and `components/`, finds each `<Announcer …>` and fails on `empty:hidden`, `hidden` or
`invisible` in its props — with an empty-glob assertion so the scan cannot pass by matching nothing.
**Probed red**: restoring `empty:hidden` fails the test and names the file.

A class scan is crude on purpose. The alternative is asserting computed styles in jsdom, which does
not apply Tailwind at all and would therefore pass on anything.
