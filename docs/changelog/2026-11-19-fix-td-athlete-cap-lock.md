- **2026-11-19** — **A household can no longer pass the 25-athlete limit by adding several athletes at
  once** ([plan](../plans/td-athlete-cap-lock.md); tech-debt entry paid off). Adding an athlete
  counted the household's athletes and then inserted, so several adds arriving together could all see
  room and all insert. The add now takes a per-household lock first, the way adding a program item
  already does, so simultaneous adds are handled one at a time and the limit holds. The duplicate-name check also compares device ids in one letter case, as hardening: through the add itself this case was already handled.
