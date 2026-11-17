- **2026-11-16** — **FAM-1: a read-only day with no workouts says "No workouts logged"; the athlete switcher stays on an archived athlete's day**
  ([guide](../features/day-page.md)). On the day page, a day that shows only what was logged (an
  older day, or an archived athlete's today or yesterday) with no workouts now says "No workouts
  logged on Tue, Nov 10." ("No workouts logged today." on today) instead of an empty section. The
  athlete switcher now hides only when no other athlete is listed, so on an archived athlete's day
  the one live athlete is still a link to switch to (maintainer, 2026-11-17). On the preview route
  until 12c. No schema change, no new dependency.
