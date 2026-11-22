/**
 * GENERATED — DO NOT EDIT.
 *
 * Source:     docs/privacy/notice.md  (the reviewed artifact; PRIV-1)
 * Generator:  apps/web/scripts/generate-privacy-notice.ts
 * Regenerate: pnpm privacy:generate
 *
 * The reviewable diff is the SOURCE, not this file: this is the same words, in the same order, as
 * data. `generate-privacy-notice.test.ts` fails byte-exactly when the two disagree, so editing
 * this file by hand only reddens `pnpm test`.
 *
 * Ignored by Prettier (.prettierignore) and ESLint (eslint.config.mjs) — a formatter rewriting it on
 * commit would fail the drift test on a fix nobody made.
 */

import type { Block } from '@/lib/privacy/notice-model';

export const NOTICE_SOURCE_PATH = "docs/privacy/notice.md";

export const NOTICE_TITLE = "Privacy notice — mat-plan";

export const NOTICE_BLOCKS: readonly Block[] = [
  {
    "k": "h1",
    "children": [
      {
        "k": "text",
        "text": "Privacy notice — mat-plan"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Last updated: [R2 date]. This is a beta."
          }
        ]
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "mat-plan is a training log for young athletes. It records what a child did in a session — the\nmovements, the sets and reps, the weight lifted, and their bodyweight when they weigh in. That is\nhealth information about a child, so this notice tries to be straight with you about all of it:\nwhat is stored, who can see it, who else it passes through, how long it is kept, and how to get it\nback or get rid of it."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "It is written by the person who built and runs the app. It is a side project, maintained a few hours\na week, and the source code is public. Where something is not yet as good as it should be, this notice\nsays so rather than leaving you to find out."
      }
    ]
  },
  {
    "k": "hr"
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "What we store"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "Everything here is entered by you or by your athlete. Nothing is bought, imported or inferred."
      }
    ]
  },
  {
    "k": "h3",
    "children": [
      {
        "k": "text",
        "text": "About the people in your household"
      }
    ]
  },
  {
    "k": "ul",
    "items": [
      [
        {
          "k": "p",
          "children": [
            {
              "k": "text",
              "text": "A "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "name"
                }
              ]
            },
            {
              "k": "text",
              "text": " for each athlete and for the household itself. Whatever you type — a first name, a\nnickname, \"Kid 1\". It is up to you how identifying that is."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "text",
              "text": "Whether each profile is "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "an adult or a child"
                }
              ]
            },
            {
              "k": "text",
              "text": ". That is all; there is no age and no date of birth.\n"
            },
            {
              "k": "em",
              "children": [
                {
                  "k": "text",
                  "text": "(The database has an unused column for a date of birth. Nothing writes to it and the app never asks\nfor one. It is listed here because the schema is public and you would otherwise find it.)"
                }
              ]
            }
          ]
        }
      ]
    ]
  },
  {
    "k": "h3",
    "children": [
      {
        "k": "text",
        "text": "What gets logged"
      }
    ]
  },
  {
    "k": "ul",
    "items": [
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Bodyweight"
                }
              ]
            },
            {
              "k": "text",
              "text": " — a number, a unit, a date, and whether it was morning or another time."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Training"
                }
              ]
            },
            {
              "k": "text",
              "text": " — the movements, how many sets, how many reps, the weight on the bar, whether the set\nwas bodyweight or banded, and what day of the program it was."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Wrestling practice"
                }
              ]
            },
            {
              "k": "text",
              "text": " — how many minutes, and the day. Typed by whoever logs it (before 16\nNovember 2026 a tap always recorded 90 minutes)."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Earlier check-ins and wake-up times"
                }
              ]
            },
            {
              "k": "text",
              "text": " — whether a habit was done or a count, and the day, and\nthe clock time a wake-up was tapped. These are still stored from before November 2026; the day page\nno longer records new ones."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "How a session felt"
                }
              ]
            },
            {
              "k": "text",
              "text": " — a note typed in a free-text box. Notes typed before November 2026 are\nstill stored; the app no longer asks for one."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "A daily readiness colour"
                }
              ]
            },
            {
              "k": "text",
              "text": " (green, yellow, red), and the program your household is following,\nincluding any prescribed loads written for a specific athlete."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Programs you build yourself"
                }
              ]
            },
            {
              "k": "text",
              "text": " (the "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Programs"
                }
              ]
            },
            {
              "k": "text",
              "text": " screen, opened from the home screen): anyone\nsigned in to your household can create and rename a program, write and change its workouts, add\na movement of your own, set its week and copy a workout, put an athlete on a program or take\nthem off it, and, from an athlete's page, change the order their programs show in. What is\nstored: a program's name, its\nworkouts' names and descriptions, the label you give a workout on a day of the week, and, when you\ncopy a workout from another of your programs, that program's name as it was when you copied it.\nFor each exercise in a workout: its instructions and rest note, the name you give a group of\nexercises done together, and the targets you set (sets, reps, and a weight, time, distance or\ncount). These belong to the household, so removing one athlete does not\nremove them; deleting the household does. A movement name someone in your household types with \"+ New item\" is added to the list that anyone signed in to your household picks from, and it\nstays in that list whether or not any program still uses it. It can't be renamed or removed in the\napp. Please type only the name of an exercise, never a person's name or anything about a child.\nIn the builder, a workout taken off a day of the week or moved to another day (with its label) is hidden, not erased, and so is an exercise you remove from a workout or swap for another, a target you clear and a workout you save with nothing in it. These pile up: nothing in the app can show,\nrestore, export or erase them, and they stay until the program or the household is removed.\n"
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Who is on which program"
                }
              ]
            },
            {
              "k": "text",
              "text": ": which athlete is on it, from which day and through which day, and on\nwhich days of the week. That belongs to the athlete, and goes with them if they are removed. Taking\nan athlete off a program keeps the record that they were on it. If they had not started yet, or the\nprogram only started that day and nothing was logged in it, the record is hidden rather than kept on the athlete's list; it is\nstill held until the athlete or the household is erased.\nWhen an athlete logs a workout, its name as it was that day, and the name you gave a group of\nexercises done together, are kept with the session, so renaming or deleting the workout later\ndoes not change what was logged."
            }
          ]
        }
      ]
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "The text boxes have no filter."
          }
        ]
      },
      {
        "k": "text",
        "text": " An "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "athlete's name"
          }
        ]
      },
      {
        "k": "text",
        "text": "; and, in the program builder, a program's name, a workout's name and\ndescription, each exercise's instructions and rest note, the name of a group of exercises, the label\nof a workout on a day (in the week and when copying), and the name of a movement you add with\n\"+ New item\". Whatever goes in is stored exactly as typed — and a name is now typed when an athlete is "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "created"
          }
        ]
      },
      {
        "k": "text",
        "text": ", not only when one is renamed, so it\nis the first thing the app asks for. A first name or a nickname is enough; the app never needs a legal\nname, and does not ask for a birthdate.\nWorth knowing, because of who is usually typing. A typed movement appears in your export only\nthrough something logged with it, and a workout's name only once an athlete logs that workout; \"How\nit felt\" does not, the athlete's name field does not (the export is filed under an id, not a name),\nand nothing else typed into the program builder does."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Technical bits"
          }
        ]
      },
      {
        "k": "text",
        "text": ": a sign-in cookie, a cookie holding your timezone, your theme choice in the\nbrowser, and an identifier each device generates per logged item, per athlete added, and, in the\nprogram builder, per program, per workout, per copy and per exercise in a workout, so the same thing\nis not saved twice. Each is a random-looking code that also shows when it was made."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "What we never ask for"
          }
        ]
      },
      {
        "k": "text",
        "text": ": no phone number, no address, no payment details, no location, and no date\nof birth. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "This app never asks you to type an email address, and no athlete's record contains one."
          }
        ]
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "em",
        "children": [
          {
            "k": "text",
            "text": "Signing in with Google is "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "how you get in"
              }
            ]
          },
          {
            "k": "text",
            "text": ", since 1 November 2026."
          }
        ]
      },
      {
        "k": "text",
        "text": " Here is what\nis honest about it, because the shorter version would not be:"
      }
    ]
  },
  {
    "k": "ul",
    "items": [
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Google tells Clerk your email address, your name and your profile picture"
                }
              ]
            },
            {
              "k": "text",
              "text": " — that set comes with\nGoogle's basic sign-in and "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "cannot be narrowed"
                }
              ]
            },
            {
              "k": "text",
              "text": "; it is the minimum Google issues to sign someone\nin, not a choice this app made."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "This app reads none of it except to know which account signed in."
                }
              ]
            },
            {
              "k": "text",
              "text": " Your name and picture are\n"
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "never read and never stored"
                }
              ]
            },
            {
              "k": "text",
              "text": " by this app, no athlete's record contains them, and nothing here can\ndisplay a photo. What the database keeps is an opaque account identifier and nothing else."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "A child is never asked to sign in"
                }
              ]
            },
            {
              "k": "text",
              "text": ", and never asked for an email address. Sign-in is for the\nadult who runs the household."
            }
          ]
        }
      ]
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "See \"What changed on 1 November 2026\"."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "Children"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Children do not have accounts."
          }
        ]
      },
      {
        "k": "text",
        "text": " An adult holds the login, and the profile tiles inside the app are\nhow you switch between athletes."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "But a child tapping a tile is a child using this app"
          }
        ]
      },
      {
        "k": "text",
        "text": ", and in practice the child is usually the one\ndoing the logging — that is what it was built for. So:"
      }
    ]
  },
  {
    "k": "ul",
    "items": [
      [
        {
          "k": "p",
          "children": [
            {
              "k": "text",
              "text": "A household owner can export the data or have it deleted. Today every adult given a sign-in to\nthe household is an owner, so a household can have more than one."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "text",
              "text": "The child types into the free-text boxes. Nothing filters what they write."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Please tell your athlete what is being recorded."
                }
              ]
            },
            {
              "k": "text",
              "text": " Their weight and their training are being kept,\nand they should know that."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "The tiles are a convenience, not a lock."
                }
              ]
            },
            {
              "k": "text",
              "text": " A child who taps a sibling's tile can read that\nsibling's log, including their weigh-ins. If that matters in your household, it is the thing to know\nbefore you hand over the phone."
            }
          ]
        }
      ]
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "If you would rather a child's weight were not recorded at all, simply don't log it — everything else\nstill works."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "Who can see it"
      }
    ]
  },
  {
    "k": "ul",
    "items": [
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Your household"
                }
              ]
            },
            {
              "k": "text",
              "text": ": anyone signed in to it, each with their own sign-in, sees every athlete's\nhistory in the app, weigh-ins included. Only a household owner can download an athlete's export."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "The maintainer."
                }
              ]
            },
            {
              "k": "text",
              "text": " The person who runs the app has direct access to the database and can see\neverything in it. There is no technical barrier to that, and pretending otherwise would be false."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Everyone signed in to your household sees every program"
                }
              ]
            },
            {
              "k": "text",
              "text": ": who is on each one, from which day\nand through which day, and, for each athlete, which programs they are on. That includes an adult\nathlete's own programs. It is the same group of people who can already open every athlete's page."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Nobody else"
                }
              ]
            },
            {
              "k": "text",
              "text": " — no page shows your data to anyone outside your household, there is no advertising,\nno analytics about you, and your data is never sold or shared for anyone else's purposes. Three\npages can be opened without signing in — the landing page, this notice, and the sign-in screen — and\nnone of the three reads your data. ⚠️ The sign-in screen also links OUT to Clerk's waitlist page,\nwhich is not ours and is covered above."
            }
          ]
        }
      ]
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Three honest limitations during the beta:"
          }
        ]
      }
    ]
  },
  {
    "k": "ol",
    "items": [
      [
        {
          "k": "p",
          "children": [
            {
              "k": "text",
              "text": "✅ "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "The shared access code is gone"
                }
              ]
            },
            {
              "k": "text",
              "text": " (new in this version). Until now getting in took a code that\neveryone in the household typed, with no way to withdraw it from one person — rotating it meant\neveryone had to learn a new one. "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Signing in with your own Google account is now the only way in"
                }
              ]
            },
            {
              "k": "text",
              "text": ",\nso access is per-person for the first time. "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Removing someone from the household stops them"
                }
              ]
            },
            {
              "k": "text",
              "text": ": the\napp works out whose data you get from who you are. Deleting their sign-in account at Clerk also\nworks. Ask for either. ⚠️ "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Removing someone hides their membership record rather than erasing it,\nso it keeps their account identifier until the whole household is deleted"
                }
              ]
            },
            {
              "k": "text",
              "text": " — deleting their Clerk\naccount is the lever that leaves nothing behind. And signing in still does not mean the app records\n"
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "who"
                }
              ]
            },
            {
              "k": "text",
              "text": " did what. See the limitation below."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Separating one family's data from another's is done in the parts that read your log"
                }
              ]
            },
            {
              "k": "text",
              "text": " (new in\nthis version): who you are signed in as decides which household's data the app will show you, and\nthat is checked on every read and every write. ✅ "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "The list of exercise names is separated too"
                }
              ]
            },
            {
              "k": "text",
              "text": "\n(new in this version): every name in the app's own list is written by the project, and a name your\nhousehold types is your household's own (see \"Movement names\" below). "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "The beta still starts with\na single invited family."
                }
              ]
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Anyone signed in to your household can see any athlete's full history in the app"
                }
              ]
            },
            {
              "k": "text",
              "text": " — including\na child tapping a sibling's tile — "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "and only a household owner can download it."
                }
              ]
            },
            {
              "k": "text",
              "text": " Today every\nadult given a sign-in to a household is its owner, so anyone signed in can still download; the\nlimit applies once people can be invited as members. The tiles are a convenience, not a lock. What is new in this\nversion is that getting in takes "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "your own sign-in and a membership in your household"
                }
              ]
            },
            {
              "k": "text",
              "text": ", and\nnothing else opens the app.\n⚠️ "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Why that is still a limitation:"
                }
              ]
            },
            {
              "k": "text",
              "text": " a membership is held by a PERSON, not by an athlete, so one\nmembership opens every athlete in the household — and the app does not record who did what.\nRemoving someone from the household is what closes it for them (limitation 1). Guard your Google\naccount the way you would guard a password."
            }
          ]
        }
      ]
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "Who else it passes through"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "Running the app means other companies handle some of your data. Each one, and what it gets:"
      }
    ]
  },
  {
    "k": "dl",
    "head": {
      "term": [
        {
          "k": "text",
          "text": "Who it reaches"
        }
      ],
      "desc": [
        {
          "k": "text",
          "text": "What they get"
        }
      ]
    },
    "rows": [
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Neon"
              }
            ]
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "The database — "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "everything stored"
              }
            ]
          },
          {
            "k": "text",
            "text": "."
          }
        ]
      },
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Vercel"
              }
            ]
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Runs the app, so "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "everything you enter passes through it"
              }
            ]
          },
          {
            "k": "text",
            "text": ". It also keeps request logs with your IP address, the time, and the page requested."
          }
        ]
      },
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "GitHub"
              }
            ]
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Hosts the public source code, and its automation "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "holds the key to the live database"
              }
            ]
          },
          {
            "k": "text",
            "text": " in order to apply updates."
          }
        ]
      },
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Sentry"
              }
            ]
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Error reports when something breaks on the server. Deliberately built to carry none of your data — see below."
          }
        ]
      },
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Upstash"
              }
            ]
          }
        ],
        "desc": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "The identifier of whoever is signed in"
              }
            ]
          },
          {
            "k": "text",
            "text": ", briefly, to stop the app being hammered. A counter that expires in minutes. ✅ "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "It no longer receives your IP address at all"
              }
            ]
          },
          {
            "k": "text",
            "text": " (new in this version): the IP was only ever used to stop someone guessing the shared access code, and there is no code to guess. No name, no email, and never any training or weigh-in data."
          }
        ]
      },
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Clerk"
              }
            ]
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Runs the sign-in screen, and "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "sign-in is switched on"
              }
            ]
          },
          {
            "k": "text",
            "text": ". Clerk holds your email address, your name, your profile picture, your Google account identifier and your sign-in sessions, and sees your IP address and browser on the sign-in screen and on every page once you are signed in (new in this version: no longer on the home page or this one, below). ⚠️ "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "And, if you join the waitlist, your email address — with no account attached to it"
              }
            ]
          },
          {
            "k": "text",
            "text": ", submitted on Clerk's own page. Never any training or weigh-in data."
          }
        ]
      },
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Google"
              }
            ]
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Provides the sign-in, and "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "it is the only sign-in method offered — so everyone who signs in goes through Google"
              }
            ]
          },
          {
            "k": "text",
            "text": ". Google is told that you signed in to this app, and gives Clerk your email address, your name, your profile picture and your account identifier. Nothing about your athletes is ever sent to Google."
          }
        ]
      },
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Anthropic"
              }
            ]
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Only source code, and only when a code review is explicitly requested on a change. Never the database."
          }
        ]
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "On error reports."
          }
        ]
      },
      {
        "k": "text",
        "text": " The app strips cookies, request bodies, form data, query strings and headers\nbefore anything reaches Sentry, there is no error reporting in your browser at all, and no session\nrecording anywhere. The honest version is "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "\"designed and tested to carry none of your data\""
          }
        ]
      },
      {
        "k": "text",
        "text": ", not\n\"cannot\" — an unexpected fragment in an error message is always possible."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "One thing is sent on purpose: when a signed-in request asks for an athlete, a program, a workout or\na workout item that the app will not show it, the app sends Sentry a security event with that item's\nid and whether it belongs to another household. The id is a random-looking code that also shows when\nthe item was created. The event carries no name and nothing that was logged. This is how an attempt\nto reach another family's data gets noticed."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "No tracking."
          }
        ]
      },
      {
        "k": "text",
        "text": " No advertising network, no analytics product, no social buttons, no third-party\nfonts. ✅ "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "New in this version: opened directly, before you sign in, the home page and this page\nload no Clerk code."
          }
        ]
      },
      {
        "k": "text",
        "text": " Your browser talks to this app, which runs on Vercel (above), and nothing else.\n"
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Clerk's code loads when you open the sign-in screen, and on every page once you are signed in"
          }
        ]
      },
      {
        "k": "text",
        "text": ",\nfrom clerk.mat-plan.dev — Clerk's own servers, under a name on this app's domain — and opens a\nconnection to them, so Clerk sees your IP address and your browser there, and so does Cloudflare,\nwhich Clerk puts in front of that address. Two edges, so this is exact: if you reach this page from a\nsigned-in page, Clerk's code is already running in your browser; and "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "if you are signed in, opening\nany page directly, this one included, usually sends your browser briefly to Clerk to refresh your\nsign-in"
          }
        ]
      },
      {
        "k": "text",
        "text": " (Clerk then sees the address of the page you asked for). The \"before you sign in\" above is\nthe part that holds for everyone."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "⚠️ "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Until 2026-11-18 Clerk's code loaded on every page, including this one"
          }
        ]
      },
      {
        "k": "text",
        "text": ", and an earlier\nversion of this paragraph wrongly said the sign-in screen was the only exception (checked against the\nlive site on 2026-11-03). That is fixed, not just disclosed."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "Tapping "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Continue with Google"
          }
        ]
      },
      {
        "k": "text",
        "text": " then sends you to Google, which sees your IP address and browser\ntoo. Nothing about your athletes, their training or their weight is ever involved in any of it, and\nClerk's own usage reporting is switched off in this app's code rather than left on by default."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "How long we keep it"
      }
    ]
  },
  {
    "k": "dl",
    "head": {
      "term": [
        {
          "k": "text",
          "text": "What"
        }
      ],
      "desc": [
        {
          "k": "text",
          "text": "How long"
        }
      ]
    },
    "rows": [
      {
        "term": [
          {
            "k": "text",
            "text": "Your training data"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "While you are using the app. Deleted when you ask, and we will ask you once when the beta ends."
          }
        ]
      },
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Something you \"delete\" in the app"
              }
            ]
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "⚠️ "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Hidden, not erased."
              }
            ]
          },
          {
            "k": "text",
            "text": " See below."
          }
        ]
      },
      {
        "term": [
          {
            "k": "text",
            "text": "The timezone cookie"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "One year. ⚠️ The access-code cookie listed here previously no longer exists; a browser still holding one is cleared on its next visit."
          }
        ]
      },
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Your sign-in session"
              }
            ]
          },
          {
            "k": "text",
            "text": " (a cookie, and the record at Clerk)"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Held by Clerk, not by this app. Its exact length is Clerk's setting and this notice does not yet state it — ask and you will be told. Signing out ends it immediately."
          }
        ]
      },
      {
        "term": [
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "A waitlist entry"
              }
            ]
          },
          {
            "k": "text",
            "text": " (your email address, no account)"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Held by Clerk. Its length is Clerk's setting and this notice does not yet state it — ask and you will be told. Ask to be removed at any time and you will be."
          }
        ]
      },
      {
        "term": [
          {
            "k": "text",
            "text": "Your theme choice"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "In your browser, until you clear it"
          }
        ]
      },
      {
        "term": [
          {
            "k": "text",
            "text": "The signed-in account identifier, used for rate limiting"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Minutes. ⚠️ No IP address is used for this any more."
          }
        ]
      },
      {
        "term": [
          {
            "k": "text",
            "text": "Server error reports"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "30 days"
          }
        ]
      },
      {
        "term": [
          {
            "k": "text",
            "text": "Server request logs"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "24 hours"
          }
        ]
      },
      {
        "term": [
          {
            "k": "text",
            "text": "Database backups"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Point-in-time recovery: 6 hours. See below for the separate 7-day restore point."
          }
        ]
      },
      {
        "term": [
          {
            "k": "text",
            "text": "An export you have downloaded"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Yours — we cannot keep or delete it"
          }
        ]
      },
      {
        "term": [
          {
            "k": "text",
            "text": "The public source code"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Permanently, including its history"
          }
        ]
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "⚠️ "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Right now, \"delete\" means \"hidden\"."
          }
        ]
      },
      {
        "k": "text",
        "text": " The app has no Delete button yet. You can "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "clear a\nweigh-in or a wrestling practice"
          }
        ]
      },
      {
        "k": "text",
        "text": " on today or yesterday (tap Change, empty the field, tap its Clear button): that\nhides it, and the app "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "does not offer to put a cleared one back"
          }
        ]
      },
      {
        "k": "text",
        "text": ", so re-enter the right number\ninstead. Anyone signed in to your household can clear any athlete's weigh-in or practice, and the app\ndoes not record who did. A cleared one is not removed from the database, and it is "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "not in the\nexport"
          }
        ]
      },
      {
        "k": "text",
        "text": " (ask for a full copy, below, and it is included). The only ways anything comes out of the database today are deleting a whole athlete\nor household, and asking for one program, workout or typed item to be removed. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Nothing automatically removes a hidden row."
          }
        ]
      },
      {
        "k": "text",
        "text": " You should know that before you log\nsomething you might regret."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Clear this day."
          }
        ]
      },
      {
        "k": "text",
        "text": " On "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "today's"
          }
        ]
      },
      {
        "k": "text",
        "text": " page, "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Clear this day"
          }
        ]
      },
      {
        "k": "text",
        "text": " hides every entry logged for that\nathlete on that day, at once, after you type a word to confirm. Nothing is erased. Unlike a cleared\nweigh-in or practice, a cleared day can be "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "put back"
          }
        ]
      },
      {
        "k": "text",
        "text": ": a banner offers "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Restore all"
          }
        ]
      },
      {
        "k": "text",
        "text": " while that\nday is today or yesterday, so a day cleared today can be put back until the end of tomorrow. After\nthat the entries stay hidden and out of the export; a full copy on request includes them, and\nnothing short of deleting the athlete or the household removes them (though a cleared workout row\nticked again is written over, below). The offer survives a reload,\nbecause nothing about it is held on your phone. Things worth saying plainly:"
      }
    ]
  },
  {
    "k": "ul",
    "items": [
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "It hides from everyone in your household, not just from the person who cleared it."
                }
              ]
            },
            {
              "k": "text",
              "text": " Anyone\nsigned in to your household can clear any athlete's day, and restore it, unless that athlete is\narchived. The app does not record who did either. ⚠️ Per-person sign-in is now the only way in,\nbut the app records no author on an entry, so sign-in alone did not fix this."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "A restore sometimes cannot bring an entry back"
                }
              ]
            },
            {
              "k": "text",
              "text": ", when something has since been logged in its\nplace; the app says so rather than failing quietly. And ticking a cleared workout row again writes\nthe new numbers over the cleared ones."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Workout names, and any notes written with them, stay."
                }
              ]
            },
            {
              "k": "text",
              "text": " Clearing hides the day's entries, an\nentry's own note included. The workout's name, its group names and any \"how it felt\" note stay\nwith the day until the athlete or household is deleted."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Nothing is erased yet."
                }
              ]
            },
            {
              "k": "text",
              "text": " A cleared entry stays in the database, out of sight and out of the\nexport, until a removal that runs a set number of days later is built."
            }
          ]
        }
      ]
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "There is still "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "no way to permanently remove one single logged item on demand"
          }
        ]
      },
      {
        "k": "text",
        "text": ": the finest grain for\nremoving logs is an athlete. Ask, and that is done. (One program, workout or typed item can be removed\non request.) If a person's name was typed as a movement and your logs hold it, ask, and it can\nbe replaced with a neutral name on that movement and on your household's logs; the logs themselves stay.\nIt is not done, and we tell you why, if the same words were also typed into a note or label on those\nlogs, or if the new name is already in use."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "Getting your data out"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "Open an athlete's page and use the export. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Only a household owner can download an export."
          }
        ]
      },
      {
        "k": "text",
        "text": " Today\nevery adult given a sign-in to a household is an owner, so this changes nothing for anyone yet; it\napplies once people can be invited as members. Then an adult who is not an owner can ask for a copy of\n"
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "their own"
          }
        ]
      },
      {
        "k": "text",
        "text": " data (below); a child's copy goes only to an owner. Anyone signed in to the household\nstill sees weigh-ins and every other entry in the app. You get a zip of spreadsheet files, one per month: the\nstrength log, the bodyweight log and the check-ins: each practice's minutes, and the older check-ins\n(habits, counts and any wake-up time, written as a time of day). A workout an\nathlete logs from a program has one row per exercise in the strength log, with the "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "workout's name as\nit was that day"
          }
        ]
      },
      {
        "k": "text",
        "text": " and its targets. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "The athlete's name field is never written into the files"
          }
        ]
      },
      {
        "k": "text",
        "text": ", and\nthe folders are named by an internal identifier, not by a person. A workout's name goes out exactly as\ntyped, and a typed movement name and a note on a logged entry or weigh-in go out in the file too, so a\nname typed into any of them goes with it. One change is made on the way out: a value that starts with\n=, +, -, @ or a tab gets a leading apostrophe, so a spreadsheet shows it as text instead of running it\nas a formula."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "What the export does not yet include"
          }
        ]
      },
      {
        "k": "text",
        "text": ", so you are not surprised: the daily readiness colour, the \"how it felt\" notes, the per-athlete prescribed\ntargets, the programs you build and who is on which program (only a workout's name and the targets of\nan exercise an athlete logged, in the \"prescribed\" column, go out). The export covers your logged training; it is not yet a complete copy."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "An archived athlete still exports."
          }
        ]
      },
      {
        "k": "text",
        "text": " Archiving hides an athlete from the picker; it does not hide\nor delete anything they logged. A household owner finds their export on the "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Household settings"
          }
        ]
      },
      {
        "k": "text",
        "text": "\nscreen, beside their name. ⚠️ If an athlete has logged nothing at all, the app says so rather than handing you an empty\nfile — an empty zip looks exactly like a download that failed."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "If you want everything, ask"
          }
        ]
      },
      {
        "k": "text",
        "text": " and you will be sent a full copy — including anything you have\ncleared or hidden, which the export leaves out, and what Clerk holds about\nyour login: your email address, your name, your profile picture, your Google account identifier, and when\nyou signed in. And "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "export before you delete anything"
          }
        ]
      },
      {
        "k": "text",
        "text": ": a hidden profile can no longer be exported\neven though it is still in the database, and once an athlete is erased there is nothing left to export."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "Deleting your data"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Archiving an athlete is not deleting them."
          }
        ]
      },
      {
        "k": "text",
        "text": " It takes them off the picker so nobody taps their name\nby mistake, and that is all it does: everything they logged is kept, their page still opens for anyone\n"
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "in your household"
          }
        ]
      },
      {
        "k": "text",
        "text": " who has the link or who looks in Household settings, and the owner can still export them. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "The household\nowner archives an athlete; any member of the household can rename and restore one."
          }
        ]
      },
      {
        "k": "text",
        "text": " An archived\nathlete is kept in full until you restore them, or until you ask us to delete them."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Ask, and one athlete is erased."
          }
        ]
      },
      {
        "k": "text",
        "text": " Their profile, every session and set they logged, their weigh-ins,\nreadiness, the targets set for them, and which programs they were on and when are "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "permanently removed\nfrom the database"
          }
        ]
      },
      {
        "k": "text",
        "text": ". The household owner asks; or an adult athlete may ask about their own profile, in\nwhich case the owner is told first but "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "cannot cancel it"
          }
        ]
      },
      {
        "k": "text",
        "text": ": only the adult can, because it is their\ndata. The same confirmation, 7-day pause and restore point as a household deletion apply (an adult is\nconfirmed on their own invitation channel, and their full copy goes to them), and \"What remains\nafterwards\" below applies too. What stays is the household's: the programs you built, any name typed into a program, workout or\nmovement, including copies of that text kept on other athletes' logs, and every sign-in account; an\nadult athlete can ask for their own account to be deleted as well. Before anything is removed we ask\nyou about three things, and remove each only if you say so: a program only that athlete was ever on;\na workout copied out of such a program into another of your programs, which keeps its own copy of the\ninstructions and targets and the name of the program it came from, so you can keep it or have the\nprogram it was copied into removed too; and a movement your household typed that only that athlete's\nlog, or a program you chose to remove, used. A program another athlete has trained on is not\nremoved, and we will tell you. For an athlete,\nthe record of the deletion holds the athlete's internal identifier and no login ids unless their\naccount went too. Any athlete can be erased on request: every athlete in the app was added through\nit."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "A program, a workout or a movement you typed can't be deleted in the app, but the household owner\ncan ask and it is removed."
          }
        ]
      },
      {
        "k": "text",
        "text": " First we tell you which athletes it affects, and offer a change that\ntouches nobody's data instead: a rename where one is possible; for a program, taking everyone off it; for a workout, taking\nit off the week. If an adult athlete is affected, they are told first, can't cancel it, and are sent their own copy of their record of being on it and their targets; the removal waits until they confirm they have it, for at most 3 days. Otherwise it is removed with no waiting period. A restore point is held for 3 days afterwards. What athletes logged keeps its names: a workout's name as it was on the day, the movement\nnames, the targets as they were prescribed and the name of a group of exercises stay on their logs,\nso a movement something logged still uses is not removed. The athletes' record of being on a removed\nprogram, and the targets set for them on it, are deleted with it, and their logs no longer count toward that program or workout in a per-program report. How it is done is in the public\nrunbook, \"Remove one program, workout or typed item on request\"."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "Ask, and your household is deleted: every profile, every logged session, every set, every weigh-in,\nevery readiness note and your program — "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "permanently removed from the database"
          }
        ]
      },
      {
        "k": "text",
        "text": ", not hidden. Your\nsign-in accounts are deleted too."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "Because this cannot be undone, both of the steps below stay in place:"
      }
    ]
  },
  {
    "k": "ul",
    "items": [
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "We will confirm the request through the channel your invitation came through"
                }
              ]
            },
            {
              "k": "text",
              "text": " — not simply by\nreplying to whatever message arrives. This is to stop someone else having your family's data deleted."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "There is a 7-day pause"
                }
              ]
            },
            {
              "k": "text",
              "text": " between confirming and deleting, so you can cancel. Nothing is removed\nduring that window. A restore point is cut immediately "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "before"
                }
              ]
            },
            {
              "k": "text",
              "text": " the deletion and held for "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "7 days\nafter"
                }
              ]
            },
            {
              "k": "text",
              "text": " it — see \"What remains afterwards\"."
            }
          ]
        }
      ]
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "What remains afterwards, honestly:"
          }
        ]
      }
    ]
  },
  {
    "k": "ul",
    "items": [
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Database backups."
                }
              ]
            },
            {
              "k": "text",
              "text": " A point-in-time copy made before the deletion still contains the data until\nthat window expires. We also deliberately hold a restore point for "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "7 days after"
                }
              ]
            },
            {
              "k": "text",
              "text": " deleting, as the\nonly protection against someone having your data destroyed fraudulently; then it is deleted too."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "A short record of the deletion itself."
                }
              ]
            },
            {
              "k": "text",
              "text": " So that if a backup ever has to be restored, your\ndeletion is applied again rather than quietly undone. It holds an internal identifier for your\nhousehold, your login ids, and how we confirmed the request — "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "no names"
                }
              ]
            },
            {
              "k": "text",
              "text": " — it is kept outside the\nsource code and the database, and it is deleted once the restore windows above have passed."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Server logs"
                }
              ]
            },
            {
              "k": "text",
              "text": " at Vercel, and "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "error reports"
                }
              ]
            },
            {
              "k": "text",
              "text": " at Sentry, for their retention periods. Neither\nshould contain your data, but logs record that requests happened, and Vercel's request logs keep the\naddress of an athlete's page (it carries their internal identifier, not a name) for 24 hours."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Movement names."
                }
              ]
            },
            {
              "k": "text",
              "text": " Every name in the app's own list is written by the project. A name your\nhousehold types that is not already in the list is stored as your household's own, and is deleted\nwith your household. Please type only the name of an exercise there, "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "never a person's name or\nanything personal."
                }
              ]
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "Any export you downloaded."
                }
              ]
            },
            {
              "k": "text",
              "text": " That copy is yours and outside our reach."
            }
          ]
        }
      ],
      [
        {
          "k": "p",
          "children": [
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "The public source code."
                }
              ]
            },
            {
              "k": "text",
              "text": " The project is open source. Some early test data — including two\nchildren's first names — was committed to it before this review, and "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "removing a name from the\ncurrent code does not remove it from the history"
                }
              ]
            },
            {
              "k": "text",
              "text": ". That is being worked on, and it is a permanent\nlimitation of having built this in the open."
            }
          ]
        }
      ]
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "What changed on [R2 date]"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "The app was started fresh."
          }
        ]
      },
      {
        "k": "text",
        "text": " On the maintainer's decision, the household the app started with, and\neverything logged in it, was erased; the adults' sign-in accounts were kept and joined to a new, empty\nhousehold, so nobody had to sign up again. Before that, each athlete's data was offered as an export.\nThe app was not paused. A restore point from just before is held for 7 days and then deleted.\nThe old list of movement names went with it: every name in the app's list is now written by the\nproject, and a name a household typed is that household's own. So the two limitations about shared\nnames are gone, and the athletes the app started with are no longer an exception to erasure."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "What changed on 20 November 2026"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "\"How it felt\" and the box for typing a movement's name are no longer listed as text boxes."
          }
        ]
      },
      {
        "k": "text",
        "text": " No\npage shows either any more. A note or a movement name typed there before is still kept with its\nworkout, as \"How long we keep it\" says. A movement you add in the program builder is still named by\nwhat you type, and is still in that list."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "What changed on 19 November 2026"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Clear this day is in the app."
          }
        ]
      },
      {
        "k": "text",
        "text": " On today's page, it hides every entry logged for an athlete that\nday, after you type a word to confirm, and "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Restore all"
          }
        ]
      },
      {
        "k": "text",
        "text": " puts them back while the day is today or\nyesterday. Anyone signed in to the household can do either. Nothing is erased; see \"How long we\nkeep it\" above."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Removed two notes that said no page logged a workout yet."
          }
        ]
      },
      {
        "k": "text",
        "text": " The day page has logged workouts since\nan athlete could be put on a program, so a workout logged there is kept and exported as this notice\ndescribes."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Only a household owner can download an athlete's export."
          }
        ]
      },
      {
        "k": "text",
        "text": " Any other sign-in is refused the\ndownload, and the export link is not shown to it. Everyone signed in to the household still sees\nevery athlete's history in the app, weigh-ins included. Today every adult given a sign-in to a\nhousehold is its owner, so nobody's access changes yet: this is a rule that now exists, for when\npeople can be invited as members. An adult member exporting their own data is planned for later.\n"
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "The export is also rate-limited per signed-in person"
          }
        ]
      },
      {
        "k": "text",
        "text": ", with room to export every athlete of a full\nhousehold before deleting anything."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "What changed on 5 November 2026"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "The shared access code is retired."
          }
        ]
      },
      {
        "k": "text",
        "text": " Until now getting into the app took two things: this\nhousehold's access code AND a sign-in. The code is gone, and "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "signing in with your own Google\naccount is the only way in"
          }
        ]
      },
      {
        "k": "text",
        "text": ". Nothing else opens the app. This supersedes the paragraph below, which\nsaid both were required \"until the code is retired in a later release\" — this is that release."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Upstash stops receiving your IP address."
          }
        ]
      },
      {
        "k": "text",
        "text": " It was only ever used to count failed guesses at the\nshared code, briefly, and there is no code to guess. Upstash now sees only the identifier of whoever\nis signed in, for the same few minutes, to stop the app being hammered. That is a reduction in what\none of our processors is given, so it is recorded here rather than only in the source."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "There is now a waitlist, and joining it stores your email address."
          }
        ]
      },
      {
        "k": "text",
        "text": " The sign-in screen offers\n"
      },
      {
        "k": "em",
        "children": [
          {
            "k": "text",
            "text": "\"Want early access? Join waitlist\""
          }
        ]
      },
      {
        "k": "text",
        "text": ". ⚠️ "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "That link leaves this app."
          }
        ]
      },
      {
        "k": "text",
        "text": " It opens a page at\naccounts.mat-plan.dev, run by "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Clerk"
          }
        ]
      },
      {
        "k": "text",
        "text": " — it is on a sub-domain of this app's\naddress, so it looks like us, but it is theirs, and it does not carry a link to this notice. If you\nsubmit your address there, "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Clerk stores it"
          }
        ]
      },
      {
        "k": "text",
        "text": ", and we can see it. Nothing else is asked for and no\naccount is created.\n"
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "How long Clerk keeps a waitlist entry is Clerk's setting, and this notice does not yet state it —\nask and you will be told."
          }
        ]
      },
      {
        "k": "text",
        "text": " It is not guessed at here. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "You can ask to be taken off the list at any\ntime"
          }
        ]
      },
      {
        "k": "text",
        "text": ", whether or not you were ever invited: write to the address under \"Asking for anything\"."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Signing IN still needs an invitation, and Google's consent screen comes first."
          }
        ]
      },
      {
        "k": "text",
        "text": " Google's screen\nappears "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "before"
          }
        ]
      },
      {
        "k": "text",
        "text": " this app checks whether your address was invited — so an address that is then\nrefused has already passed its email address, name and profile picture to Clerk. That part is\ncertain: it follows from the order the two screens run in. ⚠️ "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "What we do not yet know is whether\nClerk keeps a record of a refusal"
          }
        ]
      },
      {
        "k": "text",
        "text": ", and this notice will not guess. If it does, you can ask for it\nto be deleted, and we will tell you what was found either way."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "What changed on 1 November 2026"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "em",
        "children": [
          {
            "k": "text",
            "text": "(This section describes what was true on 1 November 2026. The access-code half of it was superseded\non 5 November 2026 — see the section above. The text is left as published rather than rewritten.)"
          }
        ]
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Sign-in with Google is switched on."
          }
        ]
      },
      {
        "k": "text",
        "text": " You sign in with your Google account, and you "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "also"
          }
        ]
      },
      {
        "k": "text",
        "text": " need\nthis household's access code — both are required until the code is retired in a later release. Clerk\nholds your account and your sign-in sessions; Google tells Clerk your email address, your name, your\nprofile picture and your Google account identifier. What each of them holds is listed in the table\nabove. Nothing about your athletes is sent to either of them."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "How your agreement is recorded."
          }
        ]
      },
      {
        "k": "text",
        "text": " Getting an account is still by invitation, so the record of who\nwas asked, and when, is the invitation itself — this app does not store a separate consent timestamp.\n⚠️ "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Joining the waitlist is not that"
          }
        ]
      },
      {
        "k": "text",
        "text": ": it is you asking us, not us asking you, and the only record\nof it is the address Clerk holds.\n⚠️ "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "This paragraph used to end "
          },
          {
            "k": "em",
            "children": [
              {
                "k": "text",
                "text": "\"if you would rather not have an account, say so and the shared code\nkeeps working for you\""
              }
            ]
          },
          {
            "k": "text",
            "text": ", and that stopped being true on 1 November 2026."
          }
        ]
      },
      {
        "k": "text",
        "text": " An adult now needs a Google\naccount to get in; there is no longer a way in with the access code alone. (A child still never signs\nin — they use a device an adult has already unlocked.) If you would\nrather not have one, the honest answer is that the app cannot be used without it — which is a\nlimitation you should hear before you start, not at the door."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "Asking for anything"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "To get a full copy of your data, delete your household, correct something, or ask a question:\n"
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "write to matplandev@gmail.com."
          }
        ]
      },
      {
        "k": "text",
        "text": " If you were invited, the channel your invitation came through\nworks too. Please "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "do not"
          }
        ]
      },
      {
        "k": "text",
        "text": "\npost a request publicly — not in a GitHub issue or anywhere else on the open internet — because it\nwould put your household's details on a permanently archived, searchable page."
      }
    ]
  },
  {
    "k": "h2",
    "children": [
      {
        "k": "text",
        "text": "About this notice"
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "This is not legal advice"
          }
        ]
      },
      {
        "k": "text",
        "text": ", and it is not a lawyer's document. It is an honest description of how\nthis app handles data, written by the person who runs it, reviewed against the actual code rather than\nfrom memory. Every factual claim here traces to a cite in\n"
      },
      {
        "k": "link",
        "href": "https://github.com/ralamode/mat-plan/blob/main/docs/privacy/data-inventory.md",
        "children": [
          {
            "k": "text",
            "text": "data-inventory.md"
          }
        ]
      },
      {
        "k": "text",
        "text": " in the public source."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "Bodily measurements of a child may count as health data under some laws, with obligations this notice\ndoes not attempt to describe. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "If you need that answered, it needs a lawyer, and this document is not\none."
          }
        ]
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Reviewed in full against the code and signed off by the maintainer (the household operator),\n2026-10-26. Re-reviewed 2026-11-05"
          }
        ]
      },
      {
        "k": "text",
        "text": " against the retirement of the shared access code, which changed\nwho can get in, what Upstash is sent, and what a refused sign-up leaves behind. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Re-reviewed\n2026-11-19"
          }
        ]
      },
      {
        "k": "text",
        "text": " against the export becoming the household owners' and its rate limit, and against\nClear this day "
      },
      {
        "k": "em",
        "children": [
          {
            "k": "text",
            "text": "(both pending the maintainer's re-read)"
          }
        ]
      },
      {
        "k": "text",
        "text": ". "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "2026-11-20:"
          }
        ]
      },
      {
        "k": "text",
        "text": " \"How it felt\" removed from\nthe text-box list, which no page renders any more "
      },
      {
        "k": "em",
        "children": [
          {
            "k": "text",
            "text": "(the maintainer approved it)"
          }
        ]
      },
      {
        "k": "text",
        "text": ", and so was the old box for typing a movement's name. The Clear this day bullet's heading now says \"workout names, and any notes written with them\" "
      },
      {
        "k": "em",
        "children": [
          {
            "k": "text",
            "text": "(the maintainer approved it)"
          }
        ]
      },
      {
        "k": "text",
        "text": ".\n"
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "[R2 date]:"
          }
        ]
      },
      {
        "k": "text",
        "text": " re-reviewed against the fresh start: the starting household's erasure, the separated list\nof movement names, and the athletes and household that are no longer an exception "
      },
      {
        "k": "em",
        "children": [
          {
            "k": "text",
            "text": "(pending the\nmaintainer's re-read)"
          }
        ]
      },
      {
        "k": "text",
        "text": ".\n"
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Previously re-reviewed 2026-11-03"
          }
        ]
      },
      {
        "k": "text",
        "text": " against the sign-in claims, after sign-in went live on\n1 November 2026 — one of the triggers this notice sets for itself below, which had fired and not been\nanswered. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Re-reviewed again 2026-11-04"
          }
        ]
      },
      {
        "k": "text",
        "text": " against the household-scope change: the app now works out\nwhose data you get from who you are, which made three of the limitations below out of date in the\ndirection of understating what the app protects."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "This notice must be reviewed again when"
          }
        ]
      },
      {
        "k": "text",
        "text": " a new company starts receiving data, a retention period\nchanges, a new kind of information starts being stored, sign-in goes live, or anything is made\npublicly visible. The engineering triggers are in "
      },
      {
        "k": "link",
        "href": "https://github.com/ralamode/mat-plan/blob/main/docs/privacy/data-inventory.md",
        "children": [
          {
            "k": "text",
            "text": "data-inventory.md"
          }
        ]
      },
      {
        "k": "text",
        "text": "."
      }
    ]
  }
] as const;
