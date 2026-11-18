# The Programs list and a program's page have their data

FAM-1 step 6c-ii, lane P: the database side of the Programs list and the program page. Nothing in the
app calls them yet; step 7b puts them behind the DAL and mounts the pages.

- The Programs list reads each of the household's programs, in the order they were made, with the
  athletes on it now or starting later.
- A program's page reads:
  - who's on it, since when, their last day once taken off, and their other programs;
  - every athlete the "Put someone on" dialog offers, with the programs each keeps;
  - its workouts, each with its item count, its weekdays, and, for a copy, where it came from and the
    day it was copied;
  - its week, and the household's other programs for "Copy to…".
- Both use the day page's own rule for who is on what, so the two pages always agree. An archived
  athlete is on neither.
- A new read answers a program's live workout ids in one query, so the week's report of an id from
  another household no longer needs to stop after 50.
