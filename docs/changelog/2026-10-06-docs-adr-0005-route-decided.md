- **2026-10-06** — **ADR 0005's open question 1 is answered: authoring is profile-scoped at
  `/p/<id>/program`, and the household library waits for TEN-1.** V1-22's panel had already reached
  this, for the reason that matters — every BOLA guarantee derives from a profile public id, and a
  top-level `/workouts/<id>` has no profile to scope by and no household scope either until TEN-1, so
  its only authorization would be that the id exists. The household library is sequenced, not
  cancelled: once TEN-1 can express ownership, lifting it up is a route change against a working
  surface rather than a guess.
