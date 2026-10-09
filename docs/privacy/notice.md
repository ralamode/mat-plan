# Privacy notice — mat-plan

**Last updated: 2026-10-07. This is a beta.**

mat-plan is a training log for young athletes. It records what a child did in a session — the
movements, the sets and reps, the weight lifted, and their bodyweight when they weigh in. That is
health information about a child, so this notice tries to be straight with you about all of it:
what is stored, who can see it, who else it passes through, how long it is kept, and how to get it
back or get rid of it.

It is written by the person who built and runs the app. It is a side project, maintained a few hours
a week, and the source code is public. Where something is not yet as good as it should be, this notice
says so rather than leaving you to find out.

---

## What we store

Everything here is entered by you or by your athlete. Nothing is bought, imported or inferred.

**About the people in your household**

- A **name** for each athlete and for the household itself. Whatever you type — a first name, a
  nickname, "Kid 1". It is up to you how identifying that is.
- Whether each profile is **an adult or a child**. That is all; there is no age and no date of birth.
  _(The database has an unused column for a date of birth. Nothing writes to it and the app never asks
  for one. It is listed here because the schema is public and you would otherwise find it.)_

**What gets logged**

- **Bodyweight** — a number, a unit, a date, and whether it was morning or another time.
- **Training** — the movements, how many sets, how many reps, the weight on the bar, whether the set
  was bodyweight or banded, and what day of the program it was.
- **How a session felt** — a free-text box.
- **A daily readiness colour** (green, yellow, red), and the program your household is following,
  including any prescribed loads written for a specific athlete.

**Two text boxes have no filter.** "How it felt", and the box where a movement can be typed by name.
Whatever goes in is stored exactly as typed and appears in your export. Worth knowing, because of who
is usually typing.

**Technical bits**: a sign-in cookie, a cookie holding your timezone, your theme choice in the
browser, and an identifier each device generates per logged item so the same entry is not saved twice.

**What we never ask for**: no email address _(until sign-in arrives — see "What is changing")_, no
phone number, no address, no payment details, no photos, no location, and no date of birth.

## Children

**Children do not have accounts.** An adult holds the login, and the profile tiles inside the app are
how you switch between athletes.

**But a child tapping a tile is a child using this app**, and in practice the child is usually the one
doing the logging — that is what it was built for. So:

- The adult owns the account, and is the one who can export the data or have it deleted.
- The child types into the free-text boxes. Nothing filters what they write.
- **Please tell your athlete what is being recorded.** Their weight and their training are being kept,
  and they should know that.
- **The tiles are a convenience, not a lock.** A child who taps a sibling's tile can read that
  sibling's log, including their weigh-ins. If that matters in your household, it is the thing to know
  before you hand over the phone.

If you would rather a child's weight were not recorded at all, simply don't log it — everything else
still works.

## Who can see it

- **Your household**, through the shared login.
- **The maintainer.** The person who runs the app has direct access to the database and can see
  everything in it. There is no technical barrier to that, and pretending otherwise would be false.
- **Nobody else** — there are no public pages, no advertising, no analytics about you, and your data
  is never sold or shared for anyone else's purposes.

**Three honest limitations during the beta:**

1. **One shared access code.** Everyone in the household uses the same code. There is no per-person
   login yet, and no way to revoke access for one person without changing the code for everyone.
2. **Households are not yet separated by the code itself.** The work to guarantee that one family's
   data is unreachable from another's is underway and not finished. **That is exactly why the beta
   starts with a single invited family.** Until it is done, please treat the app as if anyone who was
   invited could see anyone's log.
   **One part of this is separate work:** the list of exercise names is shared by every household (see
   "Movement names" below), and it has to be separated before a second family is invited.
3. **Anyone with your access code can download any athlete's full history.** That follows from (1) and
   (2). Guard the code the way you would guard a password.

## Who else it passes through

Running the app means other companies handle some of your data. Each one, and what it gets:

| Who it reaches           | What they get                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon**                 | The database — **everything stored**.                                                                                                           |
| **Vercel**               | Runs the app, so **everything you enter passes through it**. It also keeps request logs with your IP address, the time, and the page requested. |
| **GitHub**               | Hosts the public source code, and its automation **holds the key to the live database** in order to apply updates.                              |
| **Sentry**               | Error reports when something breaks on the server. Deliberately built to carry none of your data — see below.                                   |
| **Upstash**              | **Your IP address only**, briefly, to stop someone guessing the access code.                                                                    |
| **Clerk** and **Google** | _Not yet._ When sign-in arrives they will handle your email address and Google account — see "What is changing".                                |
| **Anthropic**            | Only source code, and only when a code review is explicitly requested on a change. Never the database.                                          |

**On error reports.** The app strips cookies, request bodies, form data, query strings and headers
before anything reaches Sentry, there is no error reporting in your browser at all, and no session
recording anywhere. The honest version is **"designed and tested to carry none of your data"**, not
"cannot" — an unexpected fragment in an error message is always possible.

**No tracking.** No advertising network, no analytics product, no social buttons, no third-party fonts.
Your browser talks to this app and nothing else.

## How long we keep it

| What                                  | How long                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Your training data                    | While you are using the app. Deleted when you ask, and we will ask you once when the beta ends. |
| **Something you "delete" in the app** | ⚠️ **Hidden, not erased.** See below.                                                           |
| Sign-in and timezone cookies          | One year                                                                                        |
| Your theme choice                     | In your browser, until you clear it                                                             |
| The IP address used for rate limiting | Minutes                                                                                         |
| Server error reports                  | ⏳ _Being confirmed_                                                                            |
| Server request logs                   | ⏳ _Being confirmed_                                                                            |
| Database backups                      | ⏳ _Being confirmed_                                                                            |
| An export you have downloaded         | Yours — we cannot keep or delete it                                                             |
| The public source code                | Permanently, including its history                                                              |

⚠️ **"Delete" currently means "hidden".** The app has no way to permanently remove a single logged item
yet. Removing something takes it out of your view, but the row stays in the database until your whole
household is deleted. **Nothing automatically clears it.** Per-item deletion is being built; until then,
this is how it works, and you should know that before you log something you might regret.

⏳ **Three numbers are still being confirmed** with the companies above. They are marked rather than
guessed, and this notice will be updated with the real figures before any family is invited. A made-up
number in a privacy notice is worse than an admitted gap.

## Getting your data out

Open an athlete's page and use the export. You get a zip of spreadsheet files, one per month: the
strength log and the bodyweight log. **Your athletes' names are not in the files** — the folders are
named by an internal identifier, not by a person.

**What the export does not yet include**, so you are not surprised: check-ins and other logged life
activities, the daily readiness colour, the "how it felt" notes, and the per-athlete prescribed
targets. The export covers your logged training; it is not yet a complete copy.

**If you want everything, ask** and you will be sent a full copy. And **export before you delete
anything** — once a profile is removed, its data can no longer be exported, even though it is still in
the database.

## Deleting your data

Ask, and your household is deleted: every profile, every logged session, every set, every weigh-in,
every readiness note and your program — **permanently removed from the database**, not hidden. Your
sign-in accounts are deleted too, once sign-in exists.

Because this cannot be undone and there is currently no per-person login to prove who is asking:

- **We will confirm the request through the channel your invitation came through** — not simply by
  replying to whatever message arrives. This is to stop someone else having your family's data deleted.
- **There is a 7-day pause** between confirming and deleting, and a restore point is held for that
  window. After that it is gone.

**What remains afterwards, honestly:**

- **Database backups.** A point-in-time copy made before the deletion still contains the data until
  that window expires. We also deliberately hold a restore point for **7 days after** deleting, as the
  only protection against someone having your data destroyed fraudulently; then it is deleted too.
- **A short record of the deletion itself.** So that if a backup ever has to be restored, your
  deletion is applied again rather than quietly undone. It holds an internal identifier for your
  household, your login ids, and how we confirmed the request — **no names** — it is kept outside the
  source code and the database, and it is deleted once the restore windows above have passed.
- **Server logs** at Vercel, and **error reports** at Sentry, for their retention periods. Neither
  should contain your data, but logs record that requests happened.
- **Movement names.** If someone in your household types a movement that isn't already in the app's
  catalogue, whatever they typed is stored in a catalogue **shared by every household**. Until that
  catalogue is separated per household, it can appear to another household, and it is **not removed** when
  you delete your household. So please type only the name of an exercise there — **never a person's
  name or anything personal.**
- **Any export you downloaded.** That copy is yours and outside our reach.
- **The public source code.** The project is open source. Some early test data — including two
  children's first names — was committed to it before this review, and **removing a name from the
  current code does not remove it from the history**. That is being worked on, and it is a permanent
  limitation of having built this in the open.

## What is changing

Sign-in with Google is being added. When it arrives you will have a personal login instead of a shared
code, this notice will be updated before it goes live, and you will be asked to agree to it as part of
signing up. At that point Clerk and Google will handle your email address and Google account
identifier.

## Asking for anything

To get a full copy of your data, delete your household, correct something, or ask a question: **use
the contact route given in your invitation.**

⏳ _A permanent contact address will be published here before any family is invited._ Please **do not**
post a request publicly — not in a GitHub issue or anywhere else on the open internet — because it
would put your household's details on a permanently archived, searchable page.

## About this notice

**This is not legal advice**, and it is not a lawyer's document. It is an honest description of how
this app handles data, written by the person who runs it, reviewed against the actual code rather than
from memory. Every factual claim here traces to a cite in
[data-inventory.md](./data-inventory.md) in the public source.

Bodily measurements of a child may count as health data under some laws, with obligations this notice
does not attempt to describe. **If you need that answered, it needs a lawyer, and this document is not
one.**

**Reviewed and signed off:**

> Role: ______________________ Date: ____________
>
> _(Per this project's convention, sign-off is recorded by role and date rather than by name — the
> repository is public, and a name is personal data like any other.)_

**This notice must be reviewed again when** a new company starts receiving data, a retention period
changes, a new kind of information starts being stored, sign-in goes live, or anything is made
publicly visible. The engineering triggers are in [data-inventory.md](./data-inventory.md).
