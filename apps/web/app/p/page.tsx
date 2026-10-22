import { PickerEmptyState } from '@/components/onboarding/picker-empty-state';
import { ProfileTile } from '@/components/profiles/profile-tile';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { requireGatedPage } from '@/lib/dal/gate';
import { Button } from '@/components/ui/button';
import { GATE_COPY, PICKER_COPY, PICKER_EMPTY_COPY } from '@/lib/constants';
import { listProfiles } from '@/lib/dal/profiles';
import { lockDeviceAction } from './lock-device-action';

// Route-segment config must be a static inline literal (Next can't follow an
// imported const), so 'nodejs' stays here. pg → Node runtime, not Edge.
export const runtime = 'nodejs';

/**
 * The profile picker (V1-3), at `APP_HOME_PATH` since OSS-2 made `/` the public landing. A tile
 * links to that profile's scoped Today at `/p/[profileId]`. Profile tiles are a
 * UX switch, not a security boundary — the destination re-validates the id.
 *
 * UI-4 puts the THEME SWITCH here, and only here, after the panel priced the alternative. In the root
 * layout it would cost ~52px at the top of every screen — and on Today that is the screen with ~300px
 * of header before the first logging surface, on a phone, at 6:30pm. A theme is a settings-grade
 * preference set once per device; the picker is the app's front door past the gate (every "← All
 * profiles" tap returns here), it is not a task screen, so a mis-tap costs nothing, and at the bottom
 * of a short page it takes no attention from "who's logging today?". The provider still lives in the
 * root layout, so the choice applies everywhere and the gate and the landing still follow the device.
 */
export default async function ProfilePickerPage() {
  await requireGatedPage(); // SEC-1: the proxy is not the boundary
  const profiles = await listProfiles();
  const empty = profiles.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{PICKER_COPY.heading}</h1>
        {/* ONB-0: the subhead BRANCHES. `PICKER_COPY.subhead` ("Pick a profile to start logging.") is an
            imperative with no object when the list is empty — it tells the reader to pick from nothing,
            40px above the block that says there is nothing to pick, and a screen reader hears both with
            nothing to supersede the false one. The `<h1>` deliberately does NOT branch: `e2e/contexts.ts`
            resolves `pickerHeading` from `PICKER_COPY.heading`, and the gate helper plus four specs assert
            through it, so changing it would break the whole suite. */}
        <p className="text-muted-foreground">
          {empty ? PICKER_EMPTY_COPY.subhead : PICKER_COPY.subhead}
        </p>
      </header>

      {empty ? (
        <PickerEmptyState />
      ) : (
        <ul className="flex flex-col gap-3">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <ProfileTile profile={profile} />
            </li>
          ))}
        </ul>
      )}

      {/*
        `mt-auto`: device-grade controls sit at the BOTTOM of the page, below the thing the screen is
        for. UI-4 put the theme switch here and `docs/design.md` generalised the reason — "the control
        lives on the profile picker, and only there … a settings-grade preference set once per device".
        A device lock is the same category by the same argument, so it joins the theme rather than
        starting a second settings group somewhere else. **This IS the proto-settings area**, which is
        what makes "later move it into settings" a move of two JSX nodes in one file.
      */}
      <section aria-labelledby="this-device" className="mt-auto flex flex-col gap-3">
        <h2 id="this-device" className="text-muted-foreground text-xs font-medium tracking-wide">
          {PICKER_COPY.thisDevice}
        </h2>
        <ThemeToggle />

        {/*
          Two steps, server-rendered: the destructive tap is never the FIRST tap, and `<details>`
          needs no client JS (the `Today's program` card's idiom). A native `confirm()` was rejected —
          unstyled, unthemed, and it would make this a client component.

          The cost is stated in the second person BEFORE the tap, not after it, because the person most
          likely to mis-tap is a child who does not hold the code and so cannot undo it.

          ⚠️ The `<form>` carries NO accessible name on purpose: a named form maps to role `form`, a
          second landmark, and `landmark-unique` is a `best-practice` rule that this repo's axe scan
          (`wcag2a`/`wcag2aa`) would NOT catch. The button's text carries the meaning.
        */}
        <details className="group">
          {/*
            `list-none` + the webkit pseudo kills the default marker, the same way
            `program-reference.tsx` does — and like that card, this one then supplies its OWN
            affordance. Without the chevron this reads as muted body text sitting under a muted hint,
            which is exactly what the first screenshot showed. A BORDERED control in the
            `ThemeToggle`'s register, not `destructive`: the act is reversible (re-enter the code), and
            a red button for a reversible act is the confirm-fatigue problem one level up.
          */}
          <summary className="border-input hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-md border px-3 text-sm outline-none focus-visible:ring-3 [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="text-muted-foreground transition-transform group-open:rotate-90"
            >
              ›
            </span>
            {GATE_COPY.lock}
          </summary>
          <form action={lockDeviceAction} className="mt-2 flex flex-col items-start gap-2">
            <p className="text-muted-foreground text-sm">{GATE_COPY.lockHint}</p>
            <Button type="submit" variant="outline" size="sm">
              {GATE_COPY.lockConfirm}
            </Button>
          </form>
        </details>
      </section>
    </main>
  );
}
