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
            "text": "Last updated: 2026-11-08. This is a beta."
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
            "text": "Three text boxes have no filter."
          }
        ]
      },
      {
        "k": "text",
        "text": " \"How it felt\"; the box where a movement can be typed by name;\nand, since the rename screen, an "
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
        "text": ". Whatever goes in is stored exactly as typed.\nWorth knowing, because of who is usually typing. The first two also appear in your export; a name\ndoes not — the export is filed under an id, not a name."
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
              "text": " (new in\nthis version): who you are signed in as decides which household's data the app will show you, and\nthat is checked on every read and every write. "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "One part is still shared:"
                }
              ]
            },
            {
              "k": "text",
              "text": " the list of exercise\nnames is common to every household (see \"Movement names\" below), and it has to be separated before\na second family is invited. "
            },
            {
              "k": "strong",
              "children": [
                {
                  "k": "text",
                  "text": "The beta still starts with a single invited family"
                }
              ]
            },
            {
              "k": "text",
              "text": ", because that\nlast part is not finished."
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
                  "text": "Anyone signed in to your household can download any athlete's full history"
                }
              ]
            },
            {
              "k": "text",
              "text": " — including a\nchild tapping a sibling's tile. The tiles are a convenience, not a lock. What is new in this\nversion is that getting in takes "
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
              "text": " a membership is held by a PERSON, not by an athlete, so one\nmembership opens every athlete in the household — and the app does not record who did what. The\nlist of exercise names is also still common to every household (limitation 2). Guard your Google\naccount the way you would guard a password."
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
            "text": ". Clerk holds your email address, your name, your profile picture, your Google account identifier and your sign-in sessions, and sees your IP address and browser when the sign-in screen loads. ⚠️ "
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
            "text": "One"
          }
        ]
      },
      {
        "k": "text",
        "text": " thing is not this app, and it is not tracking: "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Clerk's code loads on every page,\nincluding this one"
          }
        ]
      },
      {
        "k": "text",
        "text": ", from clerk.mat-plan.dev — Clerk's own servers, under a name on this app's\ndomain — and opens a connection to them. So "
      },
      {
        "k": "strong",
        "children": [
          {
            "k": "text",
            "text": "Clerk sees your IP address and your browser on every\npage you open here"
          }
        ]
      },
      {
        "k": "text",
        "text": ", whether or not you sign in, and so does Cloudflare, which Clerk puts in front of\nthat address."
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
            "text": "This paragraph used to say your browser talked to this app and nothing else, and that the\nsign-in screen was the exception. That was wrong, and it was wrong on this very page"
          }
        ]
      },
      {
        "k": "text",
        "text": " — checked\nagainst the live site on 2026-11-03, not assumed. Scoping Clerk's code to the screens that need it is\nworth doing and is not done yet; until it is, the honest version is the one above."
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
              "text": " The app does\nnot record who deleted what, and anyone signed in to your household can open any athlete. So a child\ncan delete a weigh-in and a parent will not see it either, until they use Restore. ⚠️ That is still\nthe honest shape of it: per-person sign-in is now the only way in, but the app records no author on\nan entry, so sign-in alone did not fix this one."
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
            "text": "An archived athlete still exports."
          }
        ]
      },
      {
        "k": "text",
        "text": " Archiving hides an athlete from the picker; it does not hide\nor delete anything they logged. Their export is on the "
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
        "text": " screen, beside their\nname. ⚠️ If an athlete has logged nothing at all, the app says so rather than handing you an empty\nfile — an empty zip looks exactly like a download that failed."
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
        "text": " and you will be sent a full copy — including what Clerk holds about\nyour login: your email address, your name, your profile picture, your Google account identifier, and when\nyou signed in. And "
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
        "text": " who has the link or who looks in Household settings, and their export still works. "
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
        "text": " against the retirement of the shared access code, which changed\nwho can get in, what Upstash is sent, and what a refused sign-up leaves behind.\n"
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
