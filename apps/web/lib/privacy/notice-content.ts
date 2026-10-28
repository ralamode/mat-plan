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
            "text": "Last updated: 2026-10-26. This is a beta."
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
                  "text": "How a session felt"
                }
              ]
            },
            {
              "k": "text",
              "text": " — a free-text box."
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
            "text": "Two text boxes have no filter."
          }
        ]
      },
      {
        "k": "text",
        "text": " \"How it felt\", and the box where a movement can be typed by name.\nWhatever goes in is stored exactly as typed and appears in your export. Worth knowing, because of who\nis usually typing."
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
        "text": ": a sign-in cookie, a cookie holding your timezone, your theme choice in the\nbrowser, and an identifier each device generates per logged item so the same entry is not saved twice."
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
            "text": "Signing in with Google is being rolled out and is "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "not switched on yet"
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
        "k": "text",
        "text": " When it is, here is what\nis honest about it, because the shorter version would not be:"
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
        "text": "See \"What is changing\"."
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
              "text": "The adult owns the account, and is the one who can export the data or have it deleted."
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
              "text": ", through the shared login."
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
                  "text": "Nobody else"
                }
              ]
            },
            {
              "k": "text",
              "text": " — no page shows your data to anyone outside your household, there is no advertising,\nno analytics about you, and your data is never sold or shared for anyone else's purposes. Three\npages can be opened without the code — the landing page, this notice, and the sign-in screen — and\nnone of the three reads your data."
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
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "One shared access code."
                }
              ]
            },
            {
              "k": "text",
              "text": " Everyone in the household uses the same code. There is no per-person\nlogin yet, and no way to revoke access for one person without changing the code for everyone."
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
                  "text": "Households are not yet separated by the code itself."
                }
              ]
            },
            {
              "k": "text",
              "text": " The work to guarantee that one family's\ndata is unreachable from another's is underway and not finished. "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "That is exactly why the beta\nstarts with a single invited family."
                }
              ]
            },
            {
              "k": "text",
              "text": " Until it is done, please treat the app as if anyone who was\ninvited could see anyone's log.\n"
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "One part of this is separate work:"
                }
              ]
            },
            {
              "k": "text",
              "text": " the list of exercise names is shared by every household (see\n\"Movement names\" below), and it has to be separated before a second family is invited."
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
                  "text": "Anyone with your access code can download any athlete's full history."
                }
              ]
            },
            {
              "k": "text",
              "text": " That follows from (1) and\n(2). Guard the code the way you would guard a password."
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
                "text": "Your IP address only"
              }
            ]
          },
          {
            "k": "text",
            "text": ", briefly, to stop someone guessing the access code."
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
            "text": "Runs the sign-in screen. "
          },
          {
            "k": "strong",
            "children": [
              {
                "k": "text",
                "text": "Its code ships with the app now, and sign-in is not switched on yet"
              }
            ]
          },
          {
            "k": "text",
            "text": " — nothing has been sent to Clerk. When it is switched on, Clerk holds your email address, your Google account identifier and your sign-in sessions, and sees your IP address and browser when the sign-in screen loads. Never any training or weigh-in data."
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
            "k": "em",
            "children": [
              {
                "k": "text",
                "text": "Only if you sign in with Google"
              }
            ]
          },
          {
            "k": "text",
            "text": ", and not yet. Google is told that you signed in to this app, and gives Clerk your email address, your name, your profile picture and your account identifier. Nothing about your athletes is ever sent to Google."
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
        "text": " No advertising network, no analytics product, no social buttons, no third-party\nfonts. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Today your browser talks to this app and nothing else"
          }
        ]
      },
      {
        "k": "text",
        "text": " — the code for the sign-in screen\nships with the app, but with sign-in switched off nothing of it runs and no request leaves for anyone\nelse. When sign-in is switched on, "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "one"
          }
        ]
      },
      {
        "k": "text",
        "text": " thing changes and it is not tracking: opening the sign-in\nscreen loads Clerk's code and talks to Clerk's servers, so Clerk sees your IP address and your browser\non "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "that screen"
          }
        ]
      },
      {
        "k": "text",
        "text": ". Nothing about your athletes, their training or their weight is ever involved, and\nClerk's own usage reporting is switched off in this app's code rather than left on by default."
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
            "text": "Access-code and timezone cookies"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "One year"
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
            "text": "The IP address used for rate limiting"
          }
        ],
        "desc": [
          {
            "k": "text",
            "text": "Minutes"
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
        "text": " The app has no Delete button yet. The only way anything comes\nout of the database today is deleting a whole athlete or household, and the one time a row has been\nremoved from view, it stayed in the database. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Nothing automatically clears it."
          }
        ]
      },
      {
        "k": "text",
        "text": " You should know that\nbefore you log something you might regret."
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
            "text": "What is being built, so you know what to expect."
          }
        ]
      },
      {
        "k": "text",
        "text": " A Delete button, per item, that works like this:\ndeleting something "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "hides it, and then actually removes it"
          }
        ]
      },
      {
        "k": "text",
        "text": " a set number of days later. Two things\nfollow that are worth saying plainly."
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
                  "text": "You can put it back"
                }
              ]
            },
            {
              "k": "text",
              "text": " during that window. A deleted item shows up as a small \"Hidden — Restore\" row\non the day it was logged, so a mis-tap is fixable, and fixable by a parent rather than only by whoever\ntapped it. Occasionally a restore will not be possible, because something else has since taken that\nitem's place in the day — when that happens the app will say so rather than fail quietly."
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
                  "text": "It hides from everyone in your household, not just from the person who deleted it."
                }
              ]
            },
            {
              "k": "text",
              "text": " The app does\nnot record who deleted what, and anyone with your access code can open any athlete. So a child can\ndelete a weigh-in and a parent will not see it either, until they use Restore. That is the honest\nshape of it today, and it is one of the things sign-in is meant to improve."
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
            "text": "no way to permanently remove one single item on demand"
          }
        ]
      },
      {
        "k": "text",
        "text": " — the finest grain for a\npermanent removal is an athlete. Ask, and that is done."
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
        "text": "Open an athlete's page and use the export. You get a zip of spreadsheet files, one per month: the\nstrength log and the bodyweight log. "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Your athletes' names are not in the files"
          }
        ]
      },
      {
        "k": "text",
        "text": " — the folders are\nnamed by an internal identifier, not by a person."
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
        "text": ", so you are not surprised: check-ins and other logged life\nactivities, the daily readiness colour, the \"how it felt\" notes, and the per-athlete prescribed\ntargets. The export covers your logged training; it is not yet a complete copy."
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
        "text": " and you will be sent a full copy — including, once sign-in is switched\non, what Clerk holds about your login: your email address, your Google account identifier, and when\nyou signed in. And "
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
        "text": " — once a profile is removed, its data can no\nlonger be exported, even though it is still in the database."
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
        "text": ", not hidden. Your\nsign-in accounts are deleted too, once sign-in exists."
      }
    ]
  },
  {
    "k": "p",
    "children": [
      {
        "k": "text",
        "text": "Because this cannot be undone and there is currently no per-person login to prove who is asking:"
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
              "text": " at Sentry, for their retention periods. Neither\nshould contain your data, but logs record that requests happened."
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
              "text": " If someone in your household types a movement that isn't already in the app's\ncatalogue, whatever they typed is stored as a movement "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "belonging to your household"
                }
              ]
            },
            {
              "k": "text",
              "text": ", and it "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "is\nremoved"
                }
              ]
            },
            {
              "k": "text",
              "text": " when you delete your household. Two things to know while the catalogue is still being\nseparated: a name that another household typed first is still shared with yours, so it can appear to\nboth of you; and a shared name like that stays in the catalogue when either household is deleted,\nuntil the separation is finished. Please type only the name of an exercise there — "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "never a\nperson's name or anything personal."
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
        "text": "What is changing"
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
            "text": "Sign-in with Google is being rolled out."
          }
        ]
      },
      {
        "k": "text",
        "text": " The code for it ships with the app today, which is why\n"
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Clerk is listed above as a processor from now on"
          }
        ]
      },
      {
        "k": "text",
        "text": " — and it is "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "not switched on"
          }
        ]
      },
      {
        "k": "text",
        "text": ": everyone still\ngets in with the shared household access code, nobody has an account, and nothing has been sent to\nClerk or to Google. When it is switched on you will have a personal login instead of the shared code,\nClerk and Google will handle your email address and your Google account identifier, and this notice\nwill say so in the present tense on that day."
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
        "text": " Signing up is by invitation only, so the record of who was asked,\nand when, is the invitation itself — this app does not store a separate consent timestamp. If you would\nrather not have an account, say so and the shared code keeps working for you."
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
            "text": "Reviewed against the code and signed off by the maintainer (the household operator), 2026-10-26."
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
