# Privacy notice — mat-plan

**Last updated: 2026-11-08. This is a beta.**

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

### About the people in your household

- A **name** for each athlete and for the household itself. Whatever you type — a first name, a
  nickname, "Kid 1". It is up to you how identifying that is.
- Whether each profile is **an adult or a child**. That is all; there is no age and no date of birth.
  _(The database has an unused column for a date of birth. Nothing writes to it and the app never asks
  for one. It is listed here because the schema is public and you would otherwise find it.)_

### What gets logged

- **Bodyweight** — a number, a unit, a date, and whether it was morning or another time.
- **Training** — the movements, how many sets, how many reps, the weight on the bar, whether the set
  was bodyweight or banded, and what day of the program it was.
- **How a session felt** — a free-text box.
- **A daily readiness colour** (green, yellow, red), and the program your household is following,
  including any prescribed loads written for a specific athlete.

**Three text boxes have no filter.** "How it felt"; the box where a movement can be typed by name;
and, since the rename screen, an **athlete's name**. Whatever goes in is stored exactly as typed.
Worth knowing, because of who is usually typing. The first two also appear in your export; a name
does not — the export is filed under an id, not a name.

**Technical bits**: a sign-in cookie, a cookie holding your timezone, your theme choice in the
browser, and an identifier each device generates per logged item so the same entry is not saved twice.

**What we never ask for**: no phone number, no address, no payment details, no location, and no date
of birth. **This app never asks you to type an email address, and no athlete's record contains one.**

_Signing in with Google is **how you get in**, since 1 November 2026._ Here is what
is honest about it, because the shorter version would not be:

- **Google tells Clerk your email address, your name and your profile picture** — that set comes with
  Google's basic sign-in and **cannot be narrowed**; it is the minimum Google issues to sign someone
  in, not a choice this app made.
- **This app reads none of it except to know which account signed in.** Your name and picture are
  **never read and never stored** by this app, no athlete's record contains them, and nothing here can
  display a photo. What the database keeps is an opaque account identifier and nothing else.
- **A child is never asked to sign in**, and never asked for an email address. Sign-in is for the
  adult who runs the household.

See "What changed on 1 November 2026".

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
- **Nobody else** — no page shows your data to anyone outside your household, there is no advertising,
  no analytics about you, and your data is never sold or shared for anyone else's purposes. Three
  pages can be opened without signing in — the landing page, this notice, and the sign-in screen — and
  none of the three reads your data. ⚠️ The sign-in screen also links OUT to Clerk's waitlist page,
  which is not ours and is covered above.

**Three honest limitations during the beta:**

1. ✅ **The shared access code is gone** (new in this version). Until now getting in took a code that
   everyone in the household typed, with no way to withdraw it from one person — rotating it meant
   everyone had to learn a new one. **Signing in with your own Google account is now the only way in**,
   so access is per-person for the first time. **Removing someone from the household stops them**: the
   app works out whose data you get from who you are. Deleting their sign-in account at Clerk also
   works. Ask for either. ⚠️ **Removing someone hides their membership record rather than erasing it,
   so it keeps their account identifier until the whole household is deleted** — deleting their Clerk
   account is the lever that leaves nothing behind. And signing in still does not mean the app records
   **who** did what. See the limitation below.
2. **Separating one family's data from another's is done in the parts that read your log** (new in
   this version): who you are signed in as decides which household's data the app will show you, and
   that is checked on every read and every write. **One part is still shared:** the list of exercise
   names is common to every household (see "Movement names" below), and it has to be separated before
   a second family is invited. **The beta still starts with a single invited family**, because that
   last part is not finished.
3. **Anyone signed in to your household can download any athlete's full history** — including a
   child tapping a sibling's tile. The tiles are a convenience, not a lock. What is new in this
   version is that getting in takes **your own sign-in and a membership in your household**, and
   nothing else opens the app.
   ⚠️ **Why that is still a limitation:** a membership is held by a PERSON, not by an athlete, so one
   membership opens every athlete in the household — and the app does not record who did what. The
   list of exercise names is also still common to every household (limitation 2). Guard your Google
   account the way you would guard a password.

## Who else it passes through

Running the app means other companies handle some of your data. Each one, and what it gets:

| Who it reaches | What they get                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon**       | The database — **everything stored**.                                                                                                                                                                                                                                                                                                                                                                                  |
| **Vercel**     | Runs the app, so **everything you enter passes through it**. It also keeps request logs with your IP address, the time, and the page requested.                                                                                                                                                                                                                                                                        |
| **GitHub**     | Hosts the public source code, and its automation **holds the key to the live database** in order to apply updates.                                                                                                                                                                                                                                                                                                     |
| **Sentry**     | Error reports when something breaks on the server. Deliberately built to carry none of your data — see below.                                                                                                                                                                                                                                                                                                          |
| **Upstash**    | **The identifier of whoever is signed in**, briefly, to stop the app being hammered. A counter that expires in minutes. ✅ **It no longer receives your IP address at all** (new in this version): the IP was only ever used to stop someone guessing the shared access code, and there is no code to guess. No name, no email, and never any training or weigh-in data.                                               |
| **Clerk**      | Runs the sign-in screen, and **sign-in is switched on**. Clerk holds your email address, your name, your profile picture, your Google account identifier and your sign-in sessions, and sees your IP address and browser when the sign-in screen loads. ⚠️ **And, if you join the waitlist, your email address — with no account attached to it**, submitted on Clerk's own page. Never any training or weigh-in data. |
| **Google**     | Provides the sign-in, and **it is the only sign-in method offered — so everyone who signs in goes through Google**. Google is told that you signed in to this app, and gives Clerk your email address, your name, your profile picture and your account identifier. Nothing about your athletes is ever sent to Google.                                                                                                |
| **Anthropic**  | Only source code, and only when a code review is explicitly requested on a change. Never the database.                                                                                                                                                                                                                                                                                                                 |

**On error reports.** The app strips cookies, request bodies, form data, query strings and headers
before anything reaches Sentry, there is no error reporting in your browser at all, and no session
recording anywhere. The honest version is **"designed and tested to carry none of your data"**, not
"cannot" — an unexpected fragment in an error message is always possible.

**No tracking.** No advertising network, no analytics product, no social buttons, no third-party
fonts. **One** thing is not this app, and it is not tracking: **Clerk's code loads on every page,
including this one**, from clerk.mat-plan.dev — Clerk's own servers, under a name on this app's
domain — and opens a connection to them. So **Clerk sees your IP address and your browser on every
page you open here**, whether or not you sign in, and so does Cloudflare, which Clerk puts in front of
that address.

⚠️ **This paragraph used to say your browser talked to this app and nothing else, and that the
sign-in screen was the exception. That was wrong, and it was wrong on this very page** — checked
against the live site on 2026-11-03, not assumed. Scoping Clerk's code to the screens that need it is
worth doing and is not done yet; until it is, the honest version is the one above.

Tapping **Continue with Google** then sends you to Google, which sees your IP address and browser
too. Nothing about your athletes, their training or their weight is ever involved in any of it, and
Clerk's own usage reporting is switched off in this app's code rather than left on by default.

## How long we keep it

| What                                                         | How long                                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your training data                                           | While you are using the app. Deleted when you ask, and we will ask you once when the beta ends.                                                                        |
| **Something you "delete" in the app**                        | ⚠️ **Hidden, not erased.** See below.                                                                                                                                  |
| The timezone cookie                                          | One year. ⚠️ The access-code cookie listed here previously no longer exists; a browser still holding one is cleared on its next visit.                                 |
| **Your sign-in session** (a cookie, and the record at Clerk) | Held by Clerk, not by this app. Its exact length is Clerk's setting and this notice does not yet state it — ask and you will be told. Signing out ends it immediately. |
| **A waitlist entry** (your email address, no account)        | Held by Clerk. Its length is Clerk's setting and this notice does not yet state it — ask and you will be told. Ask to be removed at any time and you will be.          |
| Your theme choice                                            | In your browser, until you clear it                                                                                                                                    |
| The signed-in account identifier, used for rate limiting     | Minutes. ⚠️ No IP address is used for this any more.                                                                                                                   |
| Server error reports                                         | 30 days                                                                                                                                                                |
| Server request logs                                          | 24 hours                                                                                                                                                               |
| Database backups                                             | Point-in-time recovery: 6 hours. See below for the separate 7-day restore point.                                                                                       |
| An export you have downloaded                                | Yours — we cannot keep or delete it                                                                                                                                    |
| The public source code                                       | Permanently, including its history                                                                                                                                     |

⚠️ **Right now, "delete" means "hidden".** The app has no Delete button yet. The only way anything comes
out of the database today is deleting a whole athlete or household, and the one time a row has been
removed from view, it stayed in the database. **Nothing automatically clears it.** You should know that
before you log something you might regret.

**What is being built, so you know what to expect.** A Delete button, per item, that works like this:
deleting something **hides it, and then actually removes it** a set number of days later. Two things
follow that are worth saying plainly.

- **You can put it back** during that window. A deleted item shows up as a small "Hidden — Restore" row
  on the day it was logged, so a mis-tap is fixable, and fixable by a parent rather than only by whoever
  tapped it. Occasionally a restore will not be possible, because something else has since taken that
  item's place in the day — when that happens the app will say so rather than fail quietly.
- **It hides from everyone in your household, not just from the person who deleted it.** The app does
  not record who deleted what, and anyone signed in to your household can open any athlete. So a child
  can delete a weigh-in and a parent will not see it either, until they use Restore. ⚠️ That is still
  the honest shape of it: per-person sign-in is now the only way in, but the app records no author on
  an entry, so sign-in alone did not fix this one.

There is still **no way to permanently remove one single item on demand** — the finest grain for a
permanent removal is an athlete. Ask, and that is done.

## Getting your data out

Open an athlete's page and use the export. You get a zip of spreadsheet files, one per month: the
strength log and the bodyweight log. **Your athletes' names are not in the files** — the folders are
named by an internal identifier, not by a person.

**What the export does not yet include**, so you are not surprised: check-ins and other logged life
activities, the daily readiness colour, the "how it felt" notes, and the per-athlete prescribed
targets. The export covers your logged training; it is not yet a complete copy.

**An archived athlete still exports.** Archiving hides an athlete from the picker; it does not hide
or delete anything they logged. Their export is on the **Household settings** screen, beside their
name. ⚠️ If an athlete has logged nothing at all, the app says so rather than handing you an empty
file — an empty zip looks exactly like a download that failed.

**If you want everything, ask** and you will be sent a full copy — including what Clerk holds about
your login: your email address, your name, your profile picture, your Google account identifier, and when
you signed in. And **export before you delete anything** — once a profile is removed, its data can no
longer be exported, even though it is still in the database.

## Deleting your data

**Archiving an athlete is not deleting them.** It takes them off the picker so nobody taps their name
by mistake, and that is all it does: everything they logged is kept, their page still opens for anyone
**in your household** who has the link or who looks in Household settings, and their export still works. **The household
owner archives an athlete; any member of the household can rename and restore one.** An archived
athlete is kept in full until you restore them, or until you ask us to delete them.

Ask, and your household is deleted: every profile, every logged session, every set, every weigh-in,
every readiness note and your program — **permanently removed from the database**, not hidden. Your
sign-in accounts are deleted too.

Because this cannot be undone, both of the steps below stay in place:

- **We will confirm the request through the channel your invitation came through** — not simply by
  replying to whatever message arrives. This is to stop someone else having your family's data deleted.
- **There is a 7-day pause** between confirming and deleting, so you can cancel. Nothing is removed
  during that window. A restore point is cut immediately **before** the deletion and held for **7 days
  after** it — see "What remains afterwards".

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
  catalogue, whatever they typed is stored as a movement **belonging to your household**, and it **is
  removed** when you delete your household. Two things to know while the catalogue is still being
  separated: a name that another household typed first is still shared with yours, so it can appear to
  both of you; and a shared name like that stays in the catalogue when either household is deleted,
  until the separation is finished. Please type only the name of an exercise there — **never a
  person's name or anything personal.**
- **Any export you downloaded.** That copy is yours and outside our reach.
- **The public source code.** The project is open source. Some early test data — including two
  children's first names — was committed to it before this review, and **removing a name from the
  current code does not remove it from the history**. That is being worked on, and it is a permanent
  limitation of having built this in the open.

## What changed on 5 November 2026

**The shared access code is retired.** Until now getting into the app took two things: this
household's access code AND a sign-in. The code is gone, and **signing in with your own Google
account is the only way in**. Nothing else opens the app. This supersedes the paragraph below, which
said both were required "until the code is retired in a later release" — this is that release.

**Upstash stops receiving your IP address.** It was only ever used to count failed guesses at the
shared code, briefly, and there is no code to guess. Upstash now sees only the identifier of whoever
is signed in, for the same few minutes, to stop the app being hammered. That is a reduction in what
one of our processors is given, so it is recorded here rather than only in the source.

**There is now a waitlist, and joining it stores your email address.** The sign-in screen offers
_"Want early access? Join waitlist"_. ⚠️ **That link leaves this app.** It opens a page at
accounts.mat-plan.dev, run by **Clerk** — it is on a sub-domain of this app's
address, so it looks like us, but it is theirs, and it does not carry a link to this notice. If you
submit your address there, **Clerk stores it**, and we can see it. Nothing else is asked for and no
account is created.
**How long Clerk keeps a waitlist entry is Clerk's setting, and this notice does not yet state it —
ask and you will be told.** It is not guessed at here. **You can ask to be taken off the list at any
time**, whether or not you were ever invited: write to the address under "Asking for anything".

**Signing IN still needs an invitation, and Google's consent screen comes first.** Google's screen
appears **before** this app checks whether your address was invited — so an address that is then
refused has already passed its email address, name and profile picture to Clerk. That part is
certain: it follows from the order the two screens run in. ⚠️ **What we do not yet know is whether
Clerk keeps a record of a refusal**, and this notice will not guess. If it does, you can ask for it
to be deleted, and we will tell you what was found either way.

## What changed on 1 November 2026

_(This section describes what was true on 1 November 2026. The access-code half of it was superseded
on 5 November 2026 — see the section above. The text is left as published rather than rewritten.)_

**Sign-in with Google is switched on.** You sign in with your Google account, and you **also** need
this household's access code — both are required until the code is retired in a later release. Clerk
holds your account and your sign-in sessions; Google tells Clerk your email address, your name, your
profile picture and your Google account identifier. What each of them holds is listed in the table
above. Nothing about your athletes is sent to either of them.

**How your agreement is recorded.** Getting an account is still by invitation, so the record of who
was asked, and when, is the invitation itself — this app does not store a separate consent timestamp.
⚠️ **Joining the waitlist is not that**: it is you asking us, not us asking you, and the only record
of it is the address Clerk holds.
⚠️ **This paragraph used to end _"if you would rather not have an account, say so and the shared code
keeps working for you"_, and that stopped being true on 1 November 2026.** An adult now needs a Google
account to get in; there is no longer a way in with the access code alone. (A child still never signs
in — they use a device an adult has already unlocked.) If you would
rather not have one, the honest answer is that the app cannot be used without it — which is a
limitation you should hear before you start, not at the door.

## Asking for anything

To get a full copy of your data, delete your household, correct something, or ask a question:
**write to matplandev@gmail.com.** If you were invited, the channel your invitation came through
works too. Please **do not**
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

**Reviewed in full against the code and signed off by the maintainer (the household operator),
2026-10-26. Re-reviewed 2026-11-05** against the retirement of the shared access code, which changed
who can get in, what Upstash is sent, and what a refused sign-up leaves behind.
**Previously re-reviewed 2026-11-03** against the sign-in claims, after sign-in went live on
1 November 2026 — one of the triggers this notice sets for itself below, which had fired and not been
answered. **Re-reviewed again 2026-11-04** against the household-scope change: the app now works out
whose data you get from who you are, which made three of the limitations below out of date in the
direction of understating what the app protects.

**This notice must be reviewed again when** a new company starts receiving data, a retention period
changes, a new kind of information starts being stored, sign-in goes live, or anything is made
publicly visible. The engineering triggers are in [data-inventory.md](./data-inventory.md).
