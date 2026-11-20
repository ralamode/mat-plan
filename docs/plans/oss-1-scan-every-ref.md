# OSS-1 follow-up — a scan of every ref for personal data

> Backlog: [plan.md](../plan.md) section `OSS-1`. Milestone:
> [beta-1.md](../milestones/beta-1.md), "The remaining path to Beta 0", row 10, and the first Beta 0
> exit criterion. Branch for this plan: `docs/oss-1-scan-every-ref-plan`.
>
> **Draft 3, not yet approved.** Drafted by the plan owner on 2026-11-20 from the docs and the refs
> on the remote that day. Three panel rounds (the privacy lens) are applied; the log is at the end. The
> maintainer approves it before its PR is built.

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

- **Refs, on 2026-11-20:** about 25 branches, 780 pull-request head refs and 15 merge refs. No tags,
  releases or forks. The wiki and Pages are off.
- **A third party's roster of minors** is still reachable from pull-request refs #152 to #167, as
  the data inventory already records. All 16 still resolve. Only GitHub Support can remove a
  pull-request ref or a cached commit view; no request is recorded as filed.
- **The household's own children's data in `main`'s history:** given names, ages and bodyweight
  values that were removed from the working tree on 2026-10-08 are still in earlier commits
  (data inventory §9, residual 1).
- **One given name in a comment** of an applied migration, which is in the working tree today and
  which the forward-only guard does not allow anyone to edit (residual 2).
- **The `screenshots` branch:** about 1,050 commits of images. Pruning deletes files and does not
  rewrite the branch (residual 3).
- **No scan of every ref has ever run.** The secret scanner (gitleaks) checks each pull request's
  commits and each push to `main`. Its rules find secrets, not names, and it has never swept the
  past. The earlier "30 branches are clean" check left no command behind.

## What "clean" has to mean

1. **A third party's data.** Other people's children, and any other person outside the household:
   a coach, another parent, a club or a tournament that identifies them. It must be gone from every
   public surface of the repo, with no exception. This plan gets it gone and proves it.
2. **The household's own data.** On 2026-10-08 the maintainer chose to rename the working tree and
   leave history alone ("The names question", option (c)), with a history rewrite "available and
   un-chosen". That decision named the given names. The ages and bodyweight values in history were
   never decided either way.

So the criterion cannot be ticked truthfully today whatever a scan says, unless history is
rewritten or the criterion says what is accepted. That is Q1.

**A removed ref is not removed data.** When a ref goes, a clone no longer receives its commits,
but GitHub can still serve them by their id until Support clears them. A scan that reads refs
would then report zero while the data is still served. So proof of removal is by commit id, not by
a clean scan (step 4 below).

**"Ref" is read widely here.** The data can also sit in places that are not file contents: commit
messages, author names and emails, branch names and file paths; the titles, descriptions, comments
and review comments of pull requests, which quote changed lines and outlive a ref; the logs of
workflow runs; and preview deployments built from old commits. The scan and the manual steps cover
each of these.

## The PR

One small PR. It ships a scan that the holder of the term list can run, and the procedure around it.

1. **`.github/scripts/scan-refs.mjs`**, run as `pnpm scan:refs`.
   - **What it reads.** A mirror clone of the remote, which includes every branch and every
     pull-request ref, in a private temporary folder (mode 0700). The folder is removed when the
     scan ends, fails or is interrupted, because the clone itself holds the data. With the same
     terms it also reads: every commit's message, author name and email; every file path; and, through
     the API with a signed-in token (about 2,500 calls), every pull request's title, description,
     comments, reviews and review comments with the lines they quote, every issue and its comments,
     every commit comment, and each of those texts' edit history. The calls send no term: the text
     is fetched and matched locally. A quote is removed by deleting the comment or its edit
     revision, not by editing it.
   - **The term list is never in the repo.** It is read from `.local-secrets/pii-terms.txt`, which
     `.gitignore` already excludes. The script refuses a term file that git would track: one inside
     a work tree that `git check-ignore` does not ignore.
   - **Two classes of term.** Third-party terms must match nowhere. Household terms may match only
     in what Q1 accepts: objects reachable from the refs as they stood at the sign-off, author
     fields, and pull-request text written before the sign-off date. The sign-off records that
     snapshot of refs locally (commit ids are not personal data) and its date in the inventory. Any later match fails. A household match in a commit, message or pull-request text dated after 2026-10-08, when the working tree was renamed, is shown at the sign-off as its own line: the only accepted carry-forward is the applied migration's comment, and any other such match is fixed, not accepted. The scan exits zero only when both classes hold.
   - **Matching.** Fixed strings, case-insensitive. A term under four characters is matched on word
     boundaries. A term may carry a local list of blob ids it is allowed to match, for a name that
     is also a common word.
   - **What it cannot see, and says so.** Numbers: an age or a bodyweight is not a term. Images.
     Binary and compressed files, and text that is encoded or split across lines. The local output
     counts the binary blobs in each class of ref, so the reader knows how much went unread.
   - **Its output stays in the terminal.** Per-term and per-ref detail points at where the data is
     while it is still there, and a count is a fact about a family. Nothing of it is pasted
     anywhere. An error names a term only by its line number.
   - **Before any removal it writes, locally under `.local-secrets/`, the commit and blob ids of
     every match**, for the Support request and for the proof.
   - Counts by class of ref need one walk per ref class, not one walk of all objects.
2. **It runs locally, not in CI.** Actions logs on this repo are public, and a job cannot hold the
   terms: even hashed, names can be guessed. The repo's `pre-push` hook (`.husky/pre-push`) gains the
   term scan over the commits being pushed. It looks for the term file under the main checkout, not
   the worktree it runs in, or at a path in `MAT_PLAN_PII_TERMS`, and passes with one line, "no term
   list here", when there is none. So it checks every push from the machine that holds the list,
   worktrees included, and never blocks another machine. It covers `git push` only: screenshots published through the API, edits made on the site and pull-request text are covered by running the full scan again before each invite.
3. **A test**, which also covers a push from a worktree, on a scratch repository with a planted made-up term on a branch, in a pull-request
   style ref, in an old commit, in a commit message and in a path. Each is found. Nothing of the
   term appears in any output, error output included. A term file in a tracked path is refused. The
   temporary folder is gone after a forced failure. The test clears the `GIT_*` variables before it
   spawns git.
4. **A runbook entry**, "Scan every ref for personal data":
   - who holds the term list and what goes in it;
   - how to run the scan;
   - **the Support request:** the pull-request refs, the recorded commit ids, the last commit of
     each deleted branch, the cached views, and the pull requests' own conversations where they
     quote the data. Its text carries no personal data;
   - **what the owner removes without Support:** the workflow runs of the affected pull requests,
     whose logs are public for 90 days, and their preview deployments;
   - **before filing:** for each recorded commit, the refs that still contain it are listed in the
     mirror. A commit that a surviving ref still reaches cannot be cleared, so that ref is named in
     the request too;
   - **the proof, checked signed out:** each recorded commit id answers "not found" from the API
     and from the site's commit, patch and diff addresses; each recorded blob id answers "not found"
     from the API; each affected pull request's patch and diff answer "not found" and its file list
     shows no changed lines; and the scan's third-party class is zero.
5. **The records.** The data inventory gains the term file as a place personal data is held, with
   how long it is kept, and `.local-secrets/README.md` lists it. §9 records the outcome as a dated
   pass or fail for each class, written after the removal, with no counts. The exit criterion is
   ticked with a date, or reworded first, as Q1 is answered.

## The maintainer's steps

1. Write the term list into `.local-secrets/pii-terms.txt`, in its two classes. Third party: the
   roster's names, and any coach, parent, other child, club or tournament that identifies someone.
   Household: the given names. It never leaves that machine.
2. Run `pnpm scan:refs`. Read the result in the terminal.
3. **Check that nothing accepted under Q1 names a person outside the household.** If the scan's
   household class or a read of the old notes shows one, it moves to the third-party class. **Look
   at the `screenshots` branch's images from the weeks of the roster pull requests**, locally: if one shows a third party, the branch is deleted and its last commit id goes into the Support request, with the same proof.
4. File the Support request, and remove the workflow runs and preview deployments.
5. Run the scan and the proof again after Support answers. Record the dated outcome.
6. Run it again before each new family is invited.

## Acceptance

1. The proof above holds for every recorded id of third-party data, and the scan's third-party
   class is zero across refs, commit messages, paths and every public text of pull requests, issues
   and commits.
2. Household terms are found only where Q1 accepts them, and the criterion's wording says so; or
   they are found nowhere, if Q1 chooses a rewrite.
3. The scan's test passes, and fails when the scan is made to skip pull-request refs.
4. No term, name, count or matching line is in the PR, its description, a commit message or a log.

## Risks

- **A scan proves the list, not the repo.** It finds only the terms it is given. A name missing
  from the list is not found, and a roster that arrived as an image or a spreadsheet is not read.
- **Copies made by others** before the removal are out of anyone's reach here.
- **Support's answer takes time,** and is outside anyone's control here. The PR can merge first;
  the criterion waits for the proof.
- **The term file is the most concentrated copy of the data.** It is one git-ignored file on one
  machine, listed in the inventory.

## Not planned here

- A rewrite of `main`'s history. It is Q1's other answer, and would get a plan of its own: it
  changes every commit id, needs the branch rule's bypass for one force-push, makes every open pull
  request and worktree rebase, and leaves about forty commit ids quoted in the docs pointing at
  nothing.
- A scan in CI.

## Open questions for the maintainer

- **Q1. The household's own data.** Recommended for Beta 0: **accept it, in writing, signed and
  dated by the maintainer as the accountable role.** The criterion is reworded to: "no third
  party's data on any public surface of the repo, proved by commit id; the household's own given
  names, ages and bodyweight values in any commit, pull-request ref, commit message or pull-request
  text before the sign-off date, one given name in an applied migration's
  comment, the maintainer's commit author and email, and the `screenshots` branch's images, once checked to show no third party, are accepted residuals; numbers and images are not scannable." This is an exception to AGENTS.md's
  rule that a real value committed anywhere is a P0 and that deleting it from `HEAD` is not removing
  it; the same PR names the exception there. The history rewrite stays available. The alternative is
  to rewrite history before Beta 0 ends. A rewrite is the only way to make that rule true without
  an exception, and the quietest time for one is before the first outside invite, when few pull
  requests are open.
- **Q2. The `screenshots` branch.** Recommended: **accept its old images under Q1 for now, once
  step 3's look finds no third party in them.**
  Deleting the branch breaks the images on every open pull request, and its old commits stay served
  by id until Support clears them, so deleting alone removes nothing. If it is deleted later, its
  last commit id is recorded first and goes into a Support request, with the same proof.
- **Q3. Who builds it.** Recommended: the Native Scaling thread, which owns `PRIV-3` and already
  works to the rule that nothing privileged is pasted into a pull request.

## Review-response log

**Round 1, 2026-11-20.** One lens: privacy, and whether the plan achieves what it claims. Every
finding is accepted.

| #   | Severity | Finding                                                                                                            | Response                                                           |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | P0       | A clean scan after the refs are removed proves nothing: the commits can still be served by id                      | Ids are recorded before removal; the proof is by id                |
| 2   | P0       | Commit messages, authors, paths, pull-request text, workflow logs and preview deployments were not checked         | The scan reads the first four; the runbook removes the last two    |
| 3   | P1       | Pasting counts breaks the rule that a count is a fact about a family, and points at where the data is              | Output stays in the terminal; the record is a dated pass or fail   |
| 4   | P1       | With an accepted residual the scan could never exit zero; "before 2026-10-08" was false; numbers cannot be scanned | Two classes of term; Q1's wording lists each residual              |
| 5   | P1       | Accepting is a rule change and needs a dated sign-off; "third party" includes adults and clubs                     | Q1; the term list's contents; maintainer's step 3                  |
| 6   | P1       | The term file and the mirror clone are the most concentrated copies                                                | The refusals, the temporary folder's handling, the inventory entry |
| 7   | P1       | What fixed-string matching misses                                                                                  | Stated, with a count of unread binary blobs                        |
| 8   | P2       | A four-character floor leaves short names unscannable                                                              | Word boundaries, and a local allow-list per term                   |
| 9   | P2       | Deleting the `screenshots` branch breaks open pull requests' images and removes nothing by itself                  | Q2's recommendation is reversed                                    |
| 10  | P2       | Running once enforces nothing afterwards                                                                           | A local pre-push hook; re-run before each invite                   |
| 11  | P2       | Counts per class need a walk per class; the ref counts were already stale                                          | Said; counts dated                                                 |

**Round 2, 2026-11-20.** The same lens, on draft 2. It confirmed all eleven fixes. Every new finding is
accepted.

| #   | Severity | Finding                                                                                                       | Response                                                               |
| --- | -------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 12  | P1       | The proof by id missed a commit that a surviving ref still reaches, and the patch and diff addresses          | "Before filing"; the proof's list of addresses                         |
| 13  | P1       | Public text is wider: reviews, issues, commit comments and edit history                                       | The scan reads them; a quote is deleted, not edited                    |
| 14  | P1       | The accepted places were undefined, and left out old pull-request refs, commit messages and pull-request text | A dated snapshot of refs at the sign-off; Q1's wording                 |
| 15  | P1       | Accepting the `screenshots` branch could sweep in a third party's image                                       | The maintainer's step 3; Q2 depends on it                              |
| 16  | P1       | A hook that reads a path relative to a worktree would silently skip most pushes                               | It finds the list under the main checkout, and says when there is none |

**Round 3, 2026-11-20.** A final check: SHIP, with three non-blocking points, all applied: a household
match dated after the 2026-10-08 rename is fixed and not accepted; the `screenshots` branch's images
are accepted only once checked; and what the push hook does not cover.
