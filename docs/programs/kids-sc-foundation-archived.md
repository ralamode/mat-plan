---
feature: Archived program — Kids S&C Foundation
owns: []
---

# Kids S&C Foundation — archived reference

> **Not seeded any more.** Replaced in the database by the youth daily A/B program
> (2026-09-24, Ray) so the kids can log the program they are actually running.
> Kept here so the block's **structure** is not lost and it can be re-seeded when the S&C block returns.

- **slug:** `kids_s&c_foundation`
- **notes:** Green / no-practice baseline. Loads are a Week-1 starting point — confirm against each athlete’s last logged working set (a load that runs clean for all sets is too light).

> 🔴 **The per-athlete load and rep columns were REMOVED (`OSS-1`, 2026-10-08), not renamed.** This file
> used to carry four columns — a load and a rep target for each of two named children — across all 21
> rows. That is a minor's prescribed training programme, and a rename only de-labels it; the numbers
> themselves were the exposure. What is kept is the part a re-seed actually needs: the day split, the
> order, the movements and the **shared** prescription. What is dropped is per-athlete numbers that this
> file's own note already said must be re-confirmed against logged working sets before use — so they had
> no forward value to trade against. If the block returns, its loads are authored the same way every load
> in this app is: by a human, from what the athlete last lifted. The shipped `PROGRAM_SEED`
> (`packages/shared/src/programming.ts`) already seeds every per-athlete load as `null`, so this matches
> how a program is seeded today. Reasoning recorded in
> [docs/privacy/data-inventory.md](../privacy/data-inventory.md) §9.

| day_role   | idx | movement                  | sets | target_reps                      |
| ---------- | --- | ------------------------- | ---- | -------------------------------- |
| strength_a | 0   | `box_jump`                | 4    | 3                                |
| strength_a | 1   | `front_squat`             | 5    | 5                                |
| strength_a | 2   | `back_squat`              | 3    | 5                                |
| strength_a | 3   | `pull-up`                 | 4    | 4-5                              |
| strength_a | 4   | `bb_bench`                | 4    | 6                                |
| strength_a | 5   | `nordic_ham_curl`         | 4    | 5, last set to failure           |
| strength_a | 6   | `pallof_press`            | 3    | 12/side                          |
| strength_b | 0   | `med-ball_slam`           | 4    | 5                                |
| strength_b | 1   | `trap-bar_deadlift`       | 4    | 3 (top triple, then 2 back-offs) |
| strength_b | 2   | `overhead_shoulder_press` | 4    | 6                                |
| strength_b | 3   | `1-arm_db_row`            | 4    | 8/side                           |
| strength_b | 4   | `pull-up`                 | 3    | 5                                |
| strength_b | 5   | `bulgarian_split_squat`   | 3    | 8/leg                            |
| strength_b | 6   | `ab_rollout`              | 3    | 8-10, last set to failure        |
| strength_c | 0   | `broad_jump`              | 4    | 3                                |
| strength_c | 1   | `barbell_hip_thrust`      | 4    | 6                                |
| strength_c | 2   | `romanian_deadlift`       | 4    | 8                                |
| strength_c | 3   | `dips`                    | 3    | 6-8, last set to failure         |
| strength_c | 4   | `pull-up`                 | 4    | 4-5                              |
| strength_c | 5   | `farmer_carry`            | 4    | 40 yd, to grip failure           |
| strength_c | 6   | `hollow-body_hold`        | 3    | 30-40 s                          |
