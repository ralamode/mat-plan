- **2026-11-16** — **FAM-1 step 13d: the day page names the athlete's programs, lets the order of
  their programs be changed, switches between athletes, and says when there is no program or a
  program rests** ([plan](../plans/fam-1-family-program.md) §5's 13d row, D8, D17;
  [guide](../features/day-page.md)). Built and tested as components; 12c places these parts on the real
  page. Three of them sit above Bodyweight in the v12 prototype, so they are their own components
  that the page places (maintainer, 2026-11-16): the athlete switcher (first-name pills under the
  name; a switch opens that athlete's today), the program line ("Programs: A, B") with a Program
  order dialog (↑ ↓, each tap saves the whole order), and "Not on a program yet / on this day",
  which offers no link until the Programs page exists. The rest-day line ("Rest day on Family
  program.", or "Rest day. Nothing is scheduled on Sundays.") is inside the day screen, and shows only
  on today, yesterday and look-ahead days. The preview route shows them once the contract owner wires its day case to mount them. No schema change, no new dependency, no change to
  production behaviour.
