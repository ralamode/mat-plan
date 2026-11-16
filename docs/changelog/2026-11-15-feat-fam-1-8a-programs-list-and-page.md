- **2026-11-15** — **FAM-1 step 8a: the Programs list and a program's page, built on the preview
  route** ([plan](../plans/fam-1-family-program.md) §5 "Lane B", §8). The Programs list links each
  program to its page and names who is on it; "+ Create a program" names a new one in place and
  opens its page (open from the start when there are none). A program's page has its name with
  Rename (a counter to 60), the prototype's "Used by … Changes apply to …" line, "Who's on it" with
  "since", "starts", "last day" and "also on", and Take off where the route supplies it; its
  workouts, each a link to its editor with its item count, its days and, for a copy, where it came
  from; "+ New workout"; and the week, Monday first, read-only until step 10. Both screens carry
  their own way back. The screens link through `components/program-builder/routes.ts`, the paths
  step 7b builds its pages at, so on the preview route those links lead nowhere yet. "Copy to…" and
  "Put someone on this program…" arrive with their dialogs at 10b. Nothing is mounted outside
  `/design/program`; no schema change, no new dependency.
