import { cn } from '@/lib/utils';

/**
 * The mat-plan mark (OSS-2), converted from the design source `public/brand/mat-plan-mark.svg`.
 *
 * INLINE on purpose, never `<img src="/brand/…">`: a `public/` file is behind the access-gate matcher, so
 * an un-gated visitor would get a redirect, and `next/image` is no rescue (its optimizer re-enters the
 * proxy with no cookie → 400). Inline costs no request and no layout shift. The fill is `currentColor`,
 * set from the `--brand` token by the default class, so the hex lives in one place in the app.
 *
 * `aria-hidden`: it sits beside the `<h1>` that already says "mat-plan"; announced, it would be said twice.
 */
export function MatPlanMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="128 148 768 722"
      aria-hidden="true"
      focusable="false"
      className={cn('text-brand shrink-0', className)}
    >
      <g fill="currentColor">
        <path d="M150 155Q138 148 132 158Q128 164 128 176L128 760L265 860L265 405L512 590L759 405L759 860L896 760L896 176Q896 164 890 158Q884 148 872 155L512 370Z" />
        <path d="M292 718Q292 706 303 700L380 655Q394 647 394 663L394 858Q394 870 382 870L304 870Q292 870 292 858Z" />
        <path d="M420 605Q420 593 431 587L526 532Q540 524 540 540L540 858Q540 870 528 870L432 870Q420 870 420 858Z" />
        <path d="M566 492Q566 480 577 474L673 418Q687 410 687 426L687 858Q687 870 675 870L578 870Q566 870 566 858Z" />
      </g>
    </svg>
  );
}
