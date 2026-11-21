### Fixed

- **Day page (FAM-1), screen readers:** a tick here and another phone's change arriving in the
  same refresh are now both read. The page's announcer holds one node per sentence, and this
  phone's own quick taps still replace each other, so they never stack. (Checked in jsdom; how
  VoiceOver and TalkBack read an added node is owed a device pass.)
