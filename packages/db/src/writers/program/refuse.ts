import type { ProgramRefusal } from '@mat-plan/shared';

/** A program writer's typed refusal (`ProgramResult`'s `ok: false` arm). Never thrown. */
export const refuse = (reason: ProgramRefusal) => ({ ok: false as const, reason });
