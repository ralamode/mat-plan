- **2026-11-21** — **The Permissions-Policy header no longer names `browsing-topics`.** Chrome
  deprecated the Topics API in M144, removed the API in M153 and the header name in M159, so a
  current Chromium logged "Unrecognized feature" on every page. That also failed every local
  screenshot capture, because a capture fails on any console warning. No script on these pages
  could call the API, so the opt-out guarded nothing. Camera, microphone and geolocation stay off.
