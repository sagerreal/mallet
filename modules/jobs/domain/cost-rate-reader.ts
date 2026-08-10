import type { UserId } from "@mallet/shared/types";

/**
 * modules/jobs/domain/cost-rate-reader.ts
 * What an hour of somebody's time costs the shop — as a PORT, not a table read.
 *
 * `SetVisitStatusUseCase` needs this to stamp a completing visit, and a use-case in the jobs
 * module has no business selecting from `users`: that is the identity module's table, and reaching
 * across for one column is how a hexagonal boundary quietly stops existing. One method, one
 * question, and the jobs module stays ignorant of where the answer lives.
 *
 * It is also what makes the stamp testable without a database — the unit tests hand over a map.
 *
 * NULL IS AN ANSWER, and it is the common one early on: the shop has not worked out what anybody
 * costs. A null stamp is preserved as null rather than coerced to zero, because a visit costed at
 * $0 reads as work that was free to perform.
 */
export interface CostRateReader {
  /** Burdened cents per hour for this person, or null when the shop has set none. */
  rateFor(userId: UserId): Promise<number | null>;
}

/**
 * The reader used when a caller has no rates to offer — every visit stamps null and costing falls
 * back to reading the person's current rate, which is exactly the pre-snapshot behaviour.
 *
 * Exists so the ~dozen call sites that construct this use-case for reasons unrelated to money
 * (tests, the office dispatch surface) are not forced to wire a database reader to move a visit.
 */
export const NO_COST_RATES: CostRateReader = {
  rateFor: async () => null,
};
