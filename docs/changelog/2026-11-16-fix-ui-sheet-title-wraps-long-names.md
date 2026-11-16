# A sheet's title wraps a long name instead of clipping it under Close

The shared `Sheet` (`apps/web/components/ui/sheet.tsx`) titled with `min-w-0 flex-1` but no wrap, so
a long unbroken name, such as a 40-character athlete or program name, ran under the header's Close
button and was clipped at the screen's edge (Close itself stayed put). Found in the review of FAM-1 step 13d (#433).

- The title now uses `NAME_WRAP_CLASS` (`min-w-0 wrap-anywhere`), the constant every other name
  renderer uses. The compact (keyboard-up) layout still truncates, on purpose.
- `sheet.test.tsx` asserts the title carries the class; it fails on the parent commit.
