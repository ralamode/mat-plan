# Privacy notice — mat-plan

**Last updated: 2026-11-26. This is a beta.**

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
- **Wrestling practice** — how many minutes, and the day. Typed by whoever logs it (before 16
  November 2026 a tap always recorded 90 minutes).
- **Earlier check-ins and wake-up times** — whether a habit was done or a count, and the day, and
  the clock time a wake-up was tapped. These are still stored from before November 2026; the day page
  no longer records new ones.
- **How a session felt** — a note typed in a free-text box. Notes typed before November 2026 are
  still stored; the app no longer asks for one.
- **A daily readiness colour** (green, yellow, red), and the program your household is following,
  including any prescribed loads written for a specific athlete.
- **Programs you build yourself** (the **Programs** screen, opened from the home screen): anyone
  signed in to your household can create and rename a program, write and change its workouts, add
  a movement of your own, set its week and copy a workout, put an athlete on a program or take
  them off it, and, from an athlete's page, change the order their programs show in. What is
  stored: a program's name, its
  workouts' names and descriptions, the label you give a workout on a day of the week, and, when you
  copy a workout from another of your programs, that program's name as it was when you copied it.
  For each exercise in a workout: its instructions and rest note, the name you give a group of
  exercises done together, and the targets you set (sets, reps, and a weight, time, distance or
  count). These belong to the household, so removing one athlete does not
  remove them; deleting the household does. A movement name someone in your household types with "+ New item" is added to the list that anyone signed in to your household picks from, and it
  stays in that list whether or not any program still uses it. It can't be renamed or removed in the
  app. Please type only the name of an exercise, never a person's name or anything about a child.
  In the builder, a workout taken off a day of the week or moved to another day (with its label) is hidden, not erased, and so is an exercise you remove from a workout or swap for another, a target you clear and a workout you save with nothing in it. These pile up: nothing in the app can show,
  restore, export or erase them, and they stay until the program or the household is removed.
  **Who is on which program**: which athlete is on it, from which day and through which day, and on
  which days of the week. That belongs to the athlete, and goes with them if they are removed. Taking
  an athlete off a program keeps the record that they were on it. If they had not started yet, or the
  program only started that day and nothing was logged in it, the record is hidden rather than kept on the athlete's list; it is
  still held until the athlete or the household is erased.
  When an athlete logs a workout, its name as it was that day, and the name you gave a group of
  exercises done together, are kept with the session, so renaming or deleting the workout later
  does not change what was logged.

**The text boxes have no filter.** An **athlete's name**; and, in the program builder, a program's name, a workout's name and
description, each exercise's instructions and rest note, the name of a group of exercises, the label
of a workout on a day (in the week and when copying), and the name of a movement you add with
"+ New item". Whatever goes in is stored exactly as typed — and a name is now typed when an athlete is **created**, not only when one is renamed, so it
is the first thing the app asks for. A first name or a nickname is enough; the app never needs a legal
name, and does not ask for a birthdate.
Worth knowing, because of who is usually typing. A typed movement appears in your export only
through something logged with it, and a workout's name only once an athlete logs that workout; "How
it felt" does not, the athlete's name field does not (the export is filed under an id, not a name),
and nothing else typed into the program builder does.

**Technical bits**: a sign-in cookie, a cookie holding your timezone, your theme choice in the
browser, and an identifier each device generates per logged item, per athlete added, and, in the
program builder, per program, per workout, per copy and per exercise in a workout, so the same thing
is not saved twice. Each is a random-looking code that also shows when it was made.

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

- A household owner can export the data or have it deleted. Today every adult given a sign-in to
  the household is an owner, so a household can have more than one.
- The child types into the free-text boxes. Nothing filters what they write.
- **Please tell your athlete what is being recorded.** Their weight and their training are being kept,
  and they should know that.
- **The tiles are a convenience, not a lock.** A child who taps a sibling's tile can read that
  sibling's log, including their weigh-ins. If that matters in your household, it is the thing to know
  before you hand over the phone.

If you would rather a child's weight were not recorded at all, simply don't log it — everything else
still works.

## Who can see it

- **Your household**: anyone signed in to it, each with their own sign-in, sees every athlete's
  history in the app, weigh-ins included. Only a household owner can download an athlete's export.
- **The maintainer.** The person who runs the app has direct access to the database and can see
  everything in it. There is no technical barrier to that, and pretending otherwise would be false.
- **Everyone signed in to your household sees every program**: who is on each one, from which day
  and through which day, and, for each athlete, which programs they are on. That includes an adult
  athlete's own programs. It is the same group of people who can already open every athlete's page.
- **Nobody else** — no page shows your data to anyone outside your household, there is no advertising,
  no analytics about you, and your data is never sold or shared for anyone else's purposes. Three
  pages can be opened without signing in — the landing page, this notice, and the sign-in screen — and
  none of the three reads your data. ⚠️ The sign-in screen also links OUT to Clerk's waitlist page,
  which is not ours and is covered above.

**Honest limitations during the beta:**

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
   that is checked on every read and every write. ✅ **The list of exercise names is separated too**:
   every name the app supplies is written by the project, and the only other names in your list are
   ones your own household typed, which no other household sees (see "Movement names" below). **The
   beta still starts with a single invited family.**
3. **Anyone signed in to your household can see any athlete's full history in the app** — including
   a child tapping a sibling's tile — **and only a household owner can download it.** Today every
   adult given a sign-in to a household is its owner, so anyone signed in can still download; the
   limit applies once people can be invited as members. The tiles are a convenience, not a lock. What is new in this
   version is that getting in takes **your own sign-in and a membership in your household**, and
   nothing else opens the app.
   ⚠️ **Why that is still a limitation:** a membership is held by a PERSON, not by an athlete, so one
   membership opens every athlete in the household — and the app does not record who did what.
   Removing someone from the household is what closes it for them (limitation 1). Guard your Google
   account the way you would guard a password.

## Who else it passes through

Running the app means other companies handle some of your data. Each one, and what it gets:

| Who it reaches | What they get                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon**       | The database — **everything stored**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Vercel**     | Runs the app, so **everything you enter passes through it**. It also keeps request logs with your IP address, the time, and the page requested.                                                                                                                                                                                                                                                                                                                                                                              |
| **GitHub**     | Hosts the public source code, and its automation **holds the key to the live database** in order to apply updates.                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Sentry**     | Error reports when something breaks on the server. Deliberately built to carry none of your data — see below.                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Upstash**    | **The identifier of whoever is signed in**, briefly, to stop the app being hammered. A counter that expires in minutes. ✅ **It no longer receives your IP address at all** (new in this version): the IP was only ever used to stop someone guessing the shared access code, and there is no code to guess. No name, no email, and never any training or weigh-in data.                                                                                                                                                     |
| **Clerk**      | Runs the sign-in screen, and **sign-in is switched on**. Clerk holds your email address, your name, your profile picture, your Google account identifier and your sign-in sessions, and sees your IP address and browser on the sign-in screen and on every page once you are signed in (new in this version: no longer on the home page or this one, below). ⚠️ **And, if you join the waitlist, your email address — with no account attached to it**, submitted on Clerk's own page. Never any training or weigh-in data. |
| **Google**     | Provides the sign-in, and **it is the only sign-in method offered — so everyone who signs in goes through Google**. Google is told that you signed in to this app, and gives Clerk your email address, your name, your profile picture and your account identifier. Nothing about your athletes is ever sent to Google.                                                                                                                                                                                                      |
| **Anthropic**  | Only source code, and only when a code review is explicitly requested on a change. Never the database.                                                                                                                                                                                                                                                                                                                                                                                                                       |

**On error reports.** The app strips cookies, request bodies, form data, query strings and headers
before anything reaches Sentry, there is no error reporting in your browser at all, and no session
recording anywhere. The honest version is **"designed and tested to carry none of your data"**, not
"cannot" — an unexpected fragment in an error message is always possible.

One thing is sent on purpose: when a signed-in request asks for an athlete, a program, a workout or
a workout item that the app will not show it, the app sends Sentry a security event with that item's
id and whether it belongs to another household. The id is a random-looking code that also shows when
the item was created. The event carries no name and nothing that was logged. This is how an attempt
to reach another family's data gets noticed.

**No tracking.** No advertising network, no analytics product, no social buttons, no third-party
fonts. ✅ **New in this version: opened directly, before you sign in, the home page and this page
load no Clerk code.** Your browser talks to this app, which runs on Vercel (above), and nothing else.
**Clerk's code loads when you open the sign-in screen, and on every page once you are signed in**,
from clerk.mat-plan.dev — Clerk's own servers, under a name on this app's domain — and opens a
connection to them, so Clerk sees your IP address and your browser there, and so does Cloudflare,
which Clerk puts in front of that address. Two edges, so this is exact: if you reach this page from a
signed-in page, Clerk's code is already running in your browser; and **if you are signed in, opening
any page directly, this one included, usually sends your browser briefly to Clerk to refresh your
sign-in** (Clerk then sees the address of the page you asked for). The "before you sign in" above is
the part that holds for everyone.

⚠️ **Until 2026-11-18 Clerk's code loaded on every page, including this one**, and an earlier
version of this paragraph wrongly said the sign-in screen was the only exception (checked against the
live site on 2026-11-03). That is fixed, not just disclosed.

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

⚠️ **Right now, "delete" means "hidden".** The app has no Delete button yet. You can **clear a
weigh-in or a wrestling practice** on today or yesterday (tap Change, empty the field, tap its Clear button): that
hides it, and the app **does not offer to put a cleared one back**, so re-enter the right number
instead. Anyone signed in to your household can clear any athlete's weigh-in or practice, and the app
does not record who did. A cleared one is not removed from the database, and it is **not in the
export** (ask for a full copy, below, and it is included). The only ways anything comes out of the database today are deleting a whole athlete
or household, and asking for one program, workout or typed item to be removed. **Nothing automatically removes a hidden row.** You should know that before you log
something you might regret.

**Clear this day.** On **today's** page, **Clear this day** hides every entry logged for that
athlete on that day, at once, after you type a word to confirm. Nothing is erased. Unlike a cleared
weigh-in or practice, a cleared day can be **put back**: a banner offers **Restore all** while that
day is today or yesterday, so a day cleared today can be put back until the end of tomorrow. After
that the entries stay hidden and out of the export; a full copy on request includes them, and
nothing short of deleting the athlete or the household removes them (though a cleared workout row
ticked again is written over, below). The offer survives a reload,
because nothing about it is held on your phone. Things worth saying plainly:

- **It hides from everyone in your household, not just from the person who cleared it.** Anyone
  signed in to your household can clear any athlete's day, and restore it, unless that athlete is
  archived. The app does not record who did either. ⚠️ Per-person sign-in is now the only way in,
  but the app records no author on an entry, so sign-in alone did not fix this.
- **A restore sometimes cannot bring an entry back**, when something has since been logged in its
  place; the app says so rather than failing quietly. And ticking a cleared workout row again writes
  the new numbers over the cleared ones.
- **Workout names, and any notes written with them, stay.** Clearing hides the day's entries, an
  entry's own note included. The workout's name, its group names and any "how it felt" note stay
  with the day until the athlete or household is deleted.
- **Nothing is erased yet.** A cleared entry stays in the database, out of sight and out of the
  export, until a removal that runs a set number of days later is built.

There is still **no way to permanently remove one single logged item on demand**: the finest grain for
removing logs is an athlete. Ask, and that is done. (One program, workout or typed item can be removed
on request.) If a person's name was typed as a movement and your logs hold it, ask, and it can
be replaced with a neutral name on that movement and on your household's logs; the logs themselves stay.
It is not done, and we tell you why, if the same words were also typed into a note or label on those
logs, or if the new name is already in use.

## Getting your data out

Open an athlete's page and use the export. **Only a household owner can download an export.** Today
every adult given a sign-in to a household is an owner, so this changes nothing for anyone yet; it
applies once people can be invited as members. Then an adult who is not an owner can ask for a copy of
**their own** data (below); a child's copy goes only to an owner. Anyone signed in to the household
still sees weigh-ins and every other entry in the app. You get a zip of spreadsheet files, one per month: the
strength log, the bodyweight log and the check-ins: each practice's minutes, and the older check-ins
(habits, counts and any wake-up time, written as a time of day). A workout an
athlete logs from a program has one row per exercise in the strength log, with the **workout's name as
it was that day** and its targets. **The athlete's name field is never written into the files**, and
the folders are named by an internal identifier, not by a person. A workout's name goes out exactly as
typed, and a typed movement name and a note on a logged entry or weigh-in go out in the file too, so a
name typed into any of them goes with it. One change is made on the way out: a value that starts with
=, +, -, @ or a tab gets a leading apostrophe, so a spreadsheet shows it as text instead of running it
as a formula.

**What the export does not yet include**, so you are not surprised: the daily readiness colour, the "how it felt" notes, the per-athlete prescribed
targets, the programs you build and who is on which program (only a workout's name and the targets of
an exercise an athlete logged, in the "prescribed" column, go out). The export covers your logged training; it is not yet a complete copy.

**An archived athlete still exports.** Archiving hides an athlete from the picker; it does not hide
or delete anything they logged. A household owner finds their export on the **Household settings**
screen, beside their name. ⚠️ If an athlete has logged nothing at all, the app says so rather than handing you an empty
file — an empty zip looks exactly like a download that failed.

**If you want everything, ask** and you will be sent a full copy — including anything you have
cleared or hidden, which the export leaves out, and what Clerk holds about
your login: your email address, your name, your profile picture, your Google account identifier, and when
you signed in. And **export before you delete anything**: a hidden profile can no longer be exported
even though it is still in the database, and once an athlete is erased there is nothing left to export.

## Deleting your data

**Archiving an athlete is not deleting them.** It takes them off the picker so nobody taps their name
by mistake, and that is all it does: everything they logged is kept, their page still opens for anyone
**in your household** who has the link or who looks in Household settings, and the owner can still export them. **The household
owner archives an athlete; any member of the household can rename and restore one.** An archived
athlete is kept in full until you restore them, or until you ask us to delete them.

**Ask, and one athlete is erased.** Their profile, every session and set they logged, their weigh-ins,
readiness, the targets set for them, and which programs they were on and when are **permanently removed
from the database**. The household owner asks; or an adult athlete may ask about their own profile, in
which case the owner is told first but **cannot cancel it**: only the adult can, because it is their
data. The same confirmation, 7-day pause and restore point as a household deletion apply (an adult is
confirmed on their own invitation channel, and their full copy goes to them), and "What remains
afterwards" below applies too. What stays is the household's: the programs you built, any name typed into a program, workout or
movement, including copies of that text kept on other athletes' logs, and every sign-in account; an
adult athlete can ask for their own account to be deleted as well. Before anything is removed we ask
you about three things, and remove each only if you say so: a program only that athlete was ever on;
a workout copied out of such a program into another of your programs, which keeps its own copy of the
instructions and targets and the name of the program it came from, so you can keep it or have the
program it was copied into removed too; and a movement your household typed that only that athlete's
log, or a program you chose to remove, used. A program another athlete has trained on is not
removed, and we will tell you. For an athlete,
the record of the deletion holds the athlete's internal identifier and no login ids unless their
account went too. Any athlete can be erased on request: every athlete in the app was added through
it.

**A program, a workout or a movement you typed can't be deleted in the app, but the household owner
can ask and it is removed.** First we tell you which athletes it affects, and offer a change that
touches nobody's data instead: a rename where one is possible; for a program, taking everyone off it; for a workout, taking
it off the week. If an adult athlete is affected, they are told first, can't cancel it, and are sent their own copy of their record of being on it and their targets; the removal waits until they confirm they have it, for at most 3 days. Otherwise it is removed with no waiting period. A restore point is held for 3 days afterwards. What athletes logged keeps its names: a workout's name as it was on the day, the movement
names, the targets as they were prescribed and the name of a group of exercises stay on their logs,
so a movement something logged still uses is not removed. The athletes' record of being on a removed
program, and the targets set for them on it, are deleted with it, and their logs no longer count toward that program or workout in a per-program report. How it is done is in the public
runbook, "Remove one program, workout or typed item on request".

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
  should contain your data, but logs record that requests happened, and Vercel's request logs keep the
  address of an athlete's page (it carries their internal identifier, not a name) for 24 hours.
- **Movement names.** Every name the app supplies is written by the project. The only other names in
  your list are ones your own household typed: a name that is not already in the list is stored as
  your household's own, no other household sees it, and it is deleted with your household. Please type only the name of an exercise there, **never a person's name or
  anything personal.**
- **Any export you downloaded.** That copy is yours and outside our reach.
- **The public source code.** The project is open source. Some early test data — including two
  children's first names — was committed to it before this review, and **removing a name from the
  current code does not remove it from the history**. That is being worked on, and it is a permanent
  limitation of having built this in the open.

## What changed on 26 November 2026

**The app was started fresh.** On the maintainer's decision, the household the app started with, and
everything logged in it, was erased; the adults' sign-in accounts were kept and joined to a new, empty
household, so nobody had to sign up again. Before that, each athlete's data was offered as an export.
The app was not paused, so anything logged after that export and before the erasure was erased too,
and for that time a signed-in adult had no household to open; the restore point holds it. That restore
point, from just before, is held for 7 days and then deleted. The old list of movement names went
with it: every name the app supplies is now written by the project, and the only other names in a
household's list are ones it typed itself. So the two limitations about shared
names are gone, and the athletes the app started with are no longer an exception to erasure.

## What changed on 20 November 2026

_(This section describes what was true on 20 November 2026. The notes and names it mentions were
erased with the starting household on 26 November 2026.)_

**"How it felt" and the box for typing a movement's name are no longer listed as text boxes.** No
page shows either any more. A note or a movement name typed there before is still kept with its
workout, as "How long we keep it" says. A movement you add in the program builder is still named by
what you type, and is still in that list.

## What changed on 19 November 2026

**Clear this day is in the app.** On today's page, it hides every entry logged for an athlete that
day, after you type a word to confirm, and **Restore all** puts them back while the day is today or
yesterday. Anyone signed in to the household can do either. Nothing is erased; see "How long we
keep it" above.

**Removed two notes that said no page logged a workout yet.** The day page has logged workouts since
an athlete could be put on a program, so a workout logged there is kept and exported as this notice
describes.

**Only a household owner can download an athlete's export.** Any other sign-in is refused the
download, and the export link is not shown to it. Everyone signed in to the household still sees
every athlete's history in the app, weigh-ins included. Today every adult given a sign-in to a
household is its owner, so nobody's access changes yet: this is a rule that now exists, for when
people can be invited as members. An adult member exporting their own data is planned for later.
**The export is also rate-limited per signed-in person**, with room to export every athlete of a full
household before deleting anything.

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
who can get in, what Upstash is sent, and what a refused sign-up leaves behind. **Re-reviewed
2026-11-19** against the export becoming the household owners' and its rate limit, and against
Clear this day _(both accepted with the 2026-11-26 sign-off)_. **2026-11-20:** "How it felt" removed from
the text-box list, which no page renders any more _(the maintainer approved it)_, and so was the old box for typing a movement's name. The Clear this day bullet's heading now says "workout names, and any notes written with them" _(the maintainer approved it)_.
**2026-11-26:** re-reviewed against the fresh start: the starting household's erasure, the separated list
of movement names, and the athletes and household that are no longer an exception _(the maintainer
read and approved it)_.
**Signed off for Beta 0 by the maintainer (the household operator), 2026-11-26**, after
the fresh start, covering every re-review above.
**Previously re-reviewed 2026-11-03** against the sign-in claims, after sign-in went live on
1 November 2026 — one of the triggers this notice sets for itself below, which had fired and not been
answered. **Re-reviewed again 2026-11-04** against the household-scope change: the app now works out
whose data you get from who you are, which made three of the limitations below out of date in the
direction of understating what the app protects.

**This notice must be reviewed again when** a new company starts receiving data, a retention period
changes, a new kind of information starts being stored, sign-in goes live, or anything is made
publicly visible. The engineering triggers are in [data-inventory.md](./data-inventory.md).
