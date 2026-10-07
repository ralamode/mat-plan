- **2026-10-07** — **UI-4: dark mode is reachable, and reskin candidates are reviewable**
  ([plan](../plans/ui-4-theme-switch.md)). `globals.css` has carried a 33-line `.dark` palette since
  the scaffold that **nothing ever set** — no provider, no toggle, no `prefers-color-scheme`
  fallback — so it had never rendered for anyone. Now: Auto / Light / Dark, **Auto by default**,
  stored per device, with a nonced pre-paint script so there is no flash. The control sits on the
  **profile picker only** — the panel priced a root-layout bar at ~52px on every screen, and Today
  already spends ~300px above the first logging surface at 390px. "No flash" is asserted by
  mechanism rather than end state (the rendered script's nonce must match the response's CSP header;
  the first class mutation must land while `readyState === 'loading'`), because the obvious version
  of that test passes whether or not the script ran — and a negative control with the nonce removed
  was run to prove both assertions go red. Ships `/design/tokens` (gated, `noindex`, deleted by the
  PR that picks a set): four candidate token sets against the app's **real** components, with WCAG
  ratios computed from the OKLCH values and printed beside them. **Both themes now pass the a11y
  scan on all four routes** — the dark palette's first audit, and it is clean. Three sub-AA pairs in
  the **light** palette were found on the way and are pinned with their measured values rather than
  quietly fixed, because fixing them changes what ships: `muted-foreground` on `muted` (4.34:1), the
  zero-call-site `destructive` button variant (4.39:1), and hairlines at 1.26:1 against SC 1.4.11.
