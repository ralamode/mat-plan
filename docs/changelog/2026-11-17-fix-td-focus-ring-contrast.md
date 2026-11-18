- **2026-11-17** — **The keyboard focus ring is visible on every screen** (tech-debt entries paid off:
  three rows on the focus ring's contrast). The outline that shows which control has keyboard focus
  was drawn at half opacity in a light grey, about 1.5:1 against the page, so a keyboard or switch
  user could lose track of where they were. It is now drawn solid and darker in the light theme and
  lighter in the dark theme, at least 4.27:1 against every surface a control sits on in both. A test
  pins that, and fails if a translucent focus ring comes back. The destructive button's ring is
  solid too, and the nav rail's rows draw their ring inside the row, where the scrolling list can't
  clip it.
