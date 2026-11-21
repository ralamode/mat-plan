- **2026-11-21** — **The Permissions-Policy header no longer names `browsing-topics`.** Chrome
  removed the Topics API, so a current Chromium logged "Unrecognized feature" on every page. That
  also failed every local screenshot capture, because a capture fails on any console warning. No
  browser still has the API to opt out of. Camera, microphone and geolocation stay off.
