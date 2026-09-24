/**
 * The two presentation mappings between the app's vocabulary and the CSV's (V1-13).
 *
 * Both are the SAME trap, and the contract flags it for only one of them: **column names use
 * underscores, values use hyphens.** The draft plan dutifully handled `session_type` and missed the
 * identical problem on the column beside it — caught by the contract-fidelity panel.
 */

/**
 * `movements.slug` → the `movement` column.
 *
 * ⚠️ **This is the one that silently forks history.** Legacy bytes are kebab — `front-squat`,
 * `bulgarian-split-squat`, `ghd-back-extension` — while `movementSlug()` emits **underscores**
 * (`front_squat`). The downstream workflow groups by this exact string, so shipping the app's form
 * means *"what did he back-squat across the last four Tuesdays"* returns **nothing**, while every
 * file still looks well-formed.
 *
 * Source is the SLUG, never `movements.name`: `"Front Squat"` would be catastrophic — a space and
 * capitals in a grouping key.
 *
 * Already-hyphenated slugs exist in the catalog (`bent-over_rows`, `1-arm_db_row`), so this
 * normalises rather than assuming one separator.
 */
export function csvMovement(slug: string): string {
  return slug.replaceAll('_', '-');
}

/**
 * `sessions.day_role` (falling back to `session_type`) → the `session_type` column.
 *
 * ⚠️ **Read from `day_role`, not `session_type`.** `strength_a` is not a `SessionType` at all — the
 * CHECK on `sessions.session_type` is `strength|conditioning|skill|push|pull|legs|core`, and A/B/C
 * live only in `DAY_ROLES`. Reading the obviously-named column collapses every A/B/C day into
 * `strength` and destroys the distinction all 14 current legacy rows are built on.
 *
 * Both columns are nullable, and `entries.session_id` is nullable too — an entry logged outside a
 * session has no session type at all and emits an **empty field**, which the contract's
 * trailing-empty-fields rule already accommodates.
 */
export function csvSessionType(dayRole: string | null, sessionType: string | null): string {
  return (dayRole ?? sessionType ?? '').replaceAll('_', '-');
}
