# The design-token contrast check measures translucent colour the way a browser draws it

Tech debt, lane P. `apps/web/app/design/tokens/contrast.ts` composited a translucent colour in linear
light, while a browser composites in gamma-encoded sRGB, so a translucent ratio was not the one on
screen, and not in a safe direction: it read a 28% foreground mix as about 6:1 on the dark theme
where a browser draws 2.35:1. It now composites as a browser does, and reproduces the browser figures
the add-athlete tile's review measured (1.93:1 light, 2.35:1 dark).

- The light-mode red-on-red-tint failure is re-pinned at 3.99:1 (it read 4.39:1). Still under AA.
- The dark-mode "red on a 20% tint" failure was an artefact of the old blend: drawn as a browser draws
  it, it clears AA at 4.63:1, so that row of known failures is removed.
- The dark hairline's figure is corrected to 1.32:1 (it read 2.69:1). Still under SC 1.4.11.
- A new `contrast.test.ts` pins the model directly, and fails on the old helper.
- The tech-debt row is paid and deleted.
