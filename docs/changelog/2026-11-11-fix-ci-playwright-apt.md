---
id: CI
pr: pending
---

## The e2e job no longer installs OS packages, so an Ubuntu mirror cannot fail the build

`Install Chromium` ran `playwright install --with-deps chromium`. The `--with-deps` half shells out
to `apt-get`, and on 2026-11-11 it failed **four consecutive runs** with `Temporary failure
resolving 'archive.ubuntu.com'` while every other check on the same commit was green.

🔴 **The job already cached `~/.cache/ms-playwright`, and that is exactly why this was easy to
miss.** The cache holds the browser binary; it does not hold OS packages. So a cache hit saved the
CDN download and left the Ubuntu-mirror call running on **every** job — the one network dependency
the cache could never cover was also the only one that could fail.

🔴 **What it was actually fetching, read from that run's own apt output.** Every one of the 21
shared libraries Chromium links against was `already the newest version` — `libnss3`, `libgbm1`,
`libasound2t64`, `libdrm2` — as were `xvfb` and the whole Latin text stack: `fonts-liberation`,
`fonts-noto-color-emoji`, `libfontconfig1`, `libfreetype6`. The image (`ubuntu-26.04`,
`20261101.186.1`) preinstalls Google Chrome 156, Edge and ChromeDriver, and a Chrome package cannot
be installed without them.

⚠️ **It was not a no-op, though** — apt installed 9 packages, 21.9 MB: `fonts-freefont-ttf`,
`fonts-ipafont-gothic` (Japanese), `fonts-wqy-zenhei` (Chinese), `fonts-tlwg-loma-otf` (Thai),
`fonts-unifont`, `xfonts-cyrillic`, `xfonts-scalable` and two X11 font helpers. This app renders
none of those scripts. The honest residual is that `←` and `→` fall outside Geist's `latin` subset
and are drawn by a fallback, so dropping FreeFont and unifont could in principle change which font
supplies them — but it cannot move an assertion: the tap-target checks are on `min-h-11` controls,
where a wider glyph only makes a row **taller**, and the one near-budget link wraps with
`wrap-anywhere`. The 360px overflow scan on the real routes proves it every run.

⚠️ **If a future image drops those libraries this fails loudly**, with a Playwright error naming the
missing object — not silently. The fix would then be a _separate_ `playwright install-deps` step,
not restoring the flag: keeping the download and the OS packages apart is what lets the cache cover
the half that is cacheable.

`apps/web`'s `e2e:install` script keeps `--with-deps` deliberately. It sets up a developer's
machine, which is not a runner with Chrome preinstalled — the argument above does not transfer, and
one flag does not have to mean the same thing in both places.
