/** Max sets on one movement. Was an inline `.max(20)`; V1-19's scaffold has to clamp to the SAME
 *  number when it builds set rows from a prescription (`prescriptions_sets_check` allows any
 *  `sets > 0`), and two copies of that bound would drift into a form that cannot submit. The legacy
 *  session schema that first carried it was deleted by LEGACY-1; the program and day shapes read it. */
export const MAX_SETS_PER_MOVEMENT = 20;
