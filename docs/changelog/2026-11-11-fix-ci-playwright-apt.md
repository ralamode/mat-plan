---
id: CI
pr: pending
---

## The e2e job no longer installs OS packages, so an Ubuntu mirror cannot fail the build

`Install Chromium` ran `playwright install --with-deps chromium`. The `--with-deps` half shells out
to `apt-get`, and on 2026-11-11 it failed **five consecutive runs** with `Temporary failure
resolving 'archive.ubuntu.com'` — four on a feature branch and then the post-merge run on `main`,
which left the trunk red while `quality`, `gitleaks` and both migrate workflows were green.

🔴 **The job already cached `~/.cache/ms-playwright`, and that is exactly why this was easy to
miss.** The cache holds the browser binary; it does not hold OS packages. So a cache hit saved the
CDN download and left the Ubuntu-mirror call running on **every** job — the one network dependency
the cache could never cover was also the only one that could fail.

🔴 **What it was actually fetching, read from that run's own apt output.** Every one of the 21
shared libraries Chromium links against was `already the newest version` — `libnss3`, `libgbm1`,
`libasound2t64`, `libdrm2` — as were `xvfb` and the whole Latin text stack: `fonts-liberation`,
`fonts-noto-color-emoji`, `libfontconfig1`, `libfreetype6`. For two different reasons, worth keeping
straight: Chrome's own `Depends` accounts for the 21 libraries and `fonts-liberation` (the image —
`ubuntu-26.04`, `20261101.186.1` — preinstalls Chrome 156, Edge and ChromeDriver, and the package
cannot install without them), while `xvfb` and `fonts-noto-color-emoji` are in the image's own
package list and `libfontconfig1`/`libfreetype6` arrive transitively via `libcairo2`.

⚠️ **It was not a no-op, though.** In that run apt got as far as a _plan_ — `0 upgraded, 9 newly
installed`, 21.9 MB of archives — and then failed to fetch, so it installed nothing; the 9 are what
every green run before it installed. Seven are for scripts this app never renders
(`fonts-ipafont-gothic` Japanese, `fonts-wqy-zenhei` Chinese, `fonts-tlwg-loma-otf` Thai,
`xfonts-cyrillic`, `xfonts-scalable`, plus `xfonts-encodings` and `xfonts-utils`). **Two are not:**
`fonts-freefont-ttf` and `fonts-unifont` are pan-Unicode, and `←`/`→` fall outside Geist's `latin`
subset, so dropping them can change which font draws those two glyphs.

That still cannot move an assertion, for a geometric reason rather than a typographic one. Every
name-bearing arrow link — day page, edit page, routine editor — carries `NAV_LINK_CLASS`'s
`min-h-11` and `NAME_WRAP_CLASS`'s `wrap-anywhere`, and the tap-target checks measure
`boundingBox().height` only: a wider glyph makes a row **taller**, never shorter, and a wrapping
link cannot overflow. Width is measured by `athletes.spec.ts`'s 40-character-name test (picker, day
page, edit page, settings) and `a11y.spec.ts`'s per-screen 360px checks. ⚠️ The a11y `ROUTES` loop
runs at **390px with no overflow check** — an earlier draft of this fragment cited it as the proof,
which it is not.

⚠️ **If a future image drops those libraries this fails loudly**, with a Playwright error naming the
missing object — not silently. The fix would then be a _separate_ `playwright install-deps` step,
not restoring the flag: keeping the download and the OS packages apart is what lets the cache cover
the half that is cacheable.

`apps/web`'s `e2e:install` script keeps `--with-deps` deliberately. It sets up a developer's
machine, which is not a runner with Chrome preinstalled — the argument above does not transfer, and
one flag does not have to mean the same thing in both places.
