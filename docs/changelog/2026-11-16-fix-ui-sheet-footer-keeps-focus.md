# A sheet's footer keeps focus and the list keeps its place when the phone keyboard opens or closes

The shared `Sheet` (`apps/web/components/ui/sheet.tsx`) rendered its footer in one of two places: inside the scrolling body when the keyboard leaves little room (compact), or pinned below it otherwise. Each switch unmounted the footer and mounted a copy, so a focused footer button lost focus whenever the keyboard opened or closed. Lane B hit this in the item picker: a retry focuses Create, the keyboard closes, and focus drops.

Now one element always scrolls, and the footer is one element. Pinned, the footer is `sticky` at the bottom of that scroller; compact, it scrolls with the list. A switch re-mounts nothing and keeps the scroll offset.

Pinned looks the same as before. Compact changed slightly: the footer's side inset is 16px instead of 32px, so its buttons are wider at 360px. New unit tests cover focus and scroll offset surviving a switch. New browser tests audit the compact layout at 360×400 and 844×390 (axe, no sideways overflow, footer reachable), which nothing covered before.

Also removed: the `compactBelow` prop added earlier today (#464). Its only intended user, the item picker, kept the default 480px threshold and shortened its footer instead (#478), so the prop has no consumer.
