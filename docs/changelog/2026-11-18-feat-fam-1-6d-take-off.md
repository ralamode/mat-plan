# An athlete can be taken off a program

FAM-1 step 6d-i, lane P: the database side of "Take off". Nothing in the app calls it yet; step 15
wires it.

- Taken off a program they have been on, an athlete stays on it through today, and today is their
  last day.
- Taken off a program they have not started, or started today with nothing logged under it, the start
  is removed: they were never on it. A row ticked and then un-ticked does not count as logged.
- Tapping Take off twice gives the same answer the second time and changes nothing.
- An archived athlete cannot be taken off; their assignment stays as it is.
