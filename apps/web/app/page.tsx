import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">mat-plan</h1>
        <p className="text-muted-foreground">
          Design-system smoke test (V0-1b) — shadcn/ui + Radix on Tailwind v4 CSS-variable tokens.
        </p>
      </header>

      <section aria-labelledby="components-heading">
        <Card>
          <CardHeader>
            <CardTitle id="components-heading">Themed component check</CardTitle>
            <CardDescription>
              Buttons and this card render entirely from semantic color tokens, so they adapt to
              light and dark automatically. Token reference lives in <code>docs/design.md</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </CardContent>
          <CardFooter>
            <p className="text-muted-foreground text-sm">
              Adult-first and clean — the kid ergonomics (≥44px tap targets, high contrast, numeric
              keypads) come from good defaults, not a cartoon skin.
            </p>
          </CardFooter>
        </Card>
      </section>
    </main>
  );
}
