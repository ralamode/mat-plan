# OSS-1 follow-up — a scan of every ref for personal data

> Backlog: [plan.md](../plan.md) section `OSS-1`. Milestone:
> [beta-1.md](../milestones/beta-1.md), "The remaining path to Beta 0", row 10, and the first Beta 0
> exit criterion. Branch for this plan: `docs/oss-1-scan-every-ref-plan`.
>
> **Draft, not yet approved.** Drafted by the plan owner on 2026-11-20 from the docs and the refs on
> the remote that day. Not yet panelled. The maintainer approves it before its PR is built.

## Where this sits

- **Pillar:** Platform (privacy). It is the last Beta 0 item with no plan and no owner.
- **The exit criterion it serves** (`beta-1.md`, "Beta 0 exit criteria"): "No ref on the public
  remote — branches **and** PR refs — contains third-party or child PII, verified by a scan over
  every ref."
- **Waits for nothing.** It can be built and run before or after the fresh start.
- _Roadmap alignment (2026-11-20): Platform. It adds no feature, column, scope or authority.
  Checked against the private roadmap; nothing to add here._

## What is true today

Read from the remote on 2026-11-20, as counts only. No ref's content was fetched to write this.

- **Refs:** 24 branches, 780 pull-request head refs and 15 merge refs. No tags, releases or forks.
- **A third party's roster of minors** is still reachable from pull-request refs #152 to #167. All
  16 still resolve. Only GitHub Support can remove a pull-request ref or a cached commit view; no
  request is recorded as filed.
- **The household's own children's data in `main`'s history:** given names, ages and bodyweight
  values that were removed from the working tree on 2026-10-08 are still in earlier commits
  (data inventory §9, residual 1).
- **One given name in a comment** of an applied migration, which the forward-only guard does not
  allow anyone to edit (residual 2).
- **The `screenshots` branch:** about 1,050 commits of images. Pruning deletes files and does not
  rewrite the branch, so screenshots taken before the fixtures were renamed are still in its
  history (residual 3). A text scan cannot read an image.
- **No scan of every ref has ever run.** The secret scanner (gitleaks) checks each pull request's
  commits and each push to `main`. Its rules find secrets, not names, and it has never swept the
  past. The earlier "30 branches are clean" check left no command behind.

## What "clean" has to mean

The criterion's words cover two different things, and only one of them can be met by a scan.

1. **A third party's data.** Other people's children. It must be gone from every ref, with no
   exception. This plan gets it gone and proves it.
2. **The household's own children's data in history.** On 2026-10-08 the maintainer chose to rename
   the working tree and leave history alone ("The names question", option (c)), with a history
   rewrite "available and un-chosen". That decision named the given names. The ages and bodyweight
   values in history were never decided either way.

So the criterion cannot be ticked truthfully today whatever a scan says, unless history is
rewritten or the criterion says what is accepted. That is Q1.

## The PR

One small PR. It ships a scan that anyone with the term list can run, and the procedure around it.

1. **`.github/scripts/scan-refs.mjs`**, run as `pnpm scan:refs`.
   - It makes a mirror clone of the remote in a temporary folder, so it sees every branch and every
     pull-request ref, and never touches the working checkout.
   - It lists every blob reachable from any ref once, and tests each against a list of terms:
     fixed strings, case-insensitive.
   - **The term list is never in the repo.** It is read from `.local-secrets/pii-terms.txt`, which
     `.gitignore` already excludes, or from a path given on the command line. A term shorter than
     four characters is refused, so a stray short line cannot match half the repo.
   - **It prints no term and no matching line.** For each term it prints the term's line number in
     the list, and how many blobs match in each class of ref: branches, pull-request refs by number,
     and `main`'s history. That output is safe to paste into a pull request.
   - It exits non-zero when anything matches, so a later clean run is a real zero.
2. **It runs locally, not in CI.** Actions logs on this repo are public, and a job holding the term
   list could print a match by accident. A scheduled run can be reconsidered once the first clean
   run exists.
3. **A test** on a scratch repository with a planted made-up term on a branch, in a pull-request
   style ref and in an old commit: each is found, nothing of the term is printed, and a short term
   is refused. The test clears the `GIT_*` variables before it spawns git.
4. **A runbook entry**, "Scan every ref for personal data": who holds the term list; how to run
   the scan; how to ask GitHub Support to remove pull-request refs and cached views, with the text
   of the request and no personal data in it; and how to prove the removal (the refs no longer
   resolve, and the scan's count for the roster's terms is zero).
5. **The records.** The data inventory's §9 gains the first run's dated counts. The exit criterion
   is ticked, or reworded first, as Q1 is answered.

## The maintainer's steps

1. Write the term list into `.local-secrets/pii-terms.txt`: the given names, the roster's surnames,
   and any other string that identifies a child. It never leaves that machine.
2. File the request with GitHub Support to remove pull-request refs #152 to #167 and their cached
   views.
3. Run `pnpm scan:refs` before and after Support answers, and paste the counts.

## Acceptance

1. `pnpm scan:refs` over the remote finds the roster's terms in no ref.
2. The household's own terms are found only where Q1 accepts them, and the criterion's wording says
   so; or they are found nowhere, if Q1 chooses a rewrite.
3. The scan's test passes, and fails when the scan is made to skip pull-request refs.
4. No term, name or matching line is in the PR, its description, a commit message or a log.

## Risks

- **A scan proves the list, not the repo.** It finds only the terms it is given. The term list is
  the maintainer's, and a name missing from it is not found.
- **Support's answer takes time,** and is outside anyone's control here. The PR can merge first;
  the criterion waits for the clean run.
- **Old screenshots are not text.** Whatever Q2 decides, the scan says nothing about them.

## Not planned here

- A rewrite of `main`'s history. It is Q1's other answer, and would get a plan of its own: it
  changes every commit id, needs the branch rule's bypass for one force-push, makes every open pull
  request and worktree rebase, and leaves about forty commit ids quoted in the docs pointing at
  nothing.
- A scheduled scan in CI.

## Open questions for the maintainer

- **Q1. The household's own data in history.** Recommended for Beta 0: **accept it, in writing.**
  The criterion is reworded to "no third party's data on any ref; the household's own names, ages
  and bodyweight values in history before 2026-10-08 are an accepted residual, decided on this
  date", and the inventory says the same. The alternative is to rewrite history before Beta 0 ends.
  A rewrite is the only way to make the repo's own rule true ("deleting it from `HEAD` is not
  removing it"), and the quietest time for one is before the first outside invite, when few pull
  requests are open; it can be decided then without holding Beta 0.
- **Q2. The `screenshots` branch.** Recommended: **delete it and start it again empty**, and add its
  cached views to the Support request. Images posted on pull requests before that day stop
  loading. The alternative is to accept its old images as part of Q1's residual.
- **Q3. Who builds it.** Recommended: the Native Scaling thread, which owns `PRIV-3` and already
  works to the rule that nothing privileged is pasted into a pull request.

## Review-response log

_Not yet panelled._
