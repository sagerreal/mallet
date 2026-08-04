/**
 * The shop's visit/diagnostic fee, in CENTS.
 *
 * A port so the fee use-case stays decoupled from the settings module; the Drizzle adapter bridges
 * to `@mallet/settings`'s repository seam, exactly as ConnectTargetReader and JobReader do.
 *
 * The amount is ALWAYS read from the shop's own configuration and NEVER accepted from the caller.
 * A technician who could name the number is a technician who could charge the customer anything.
 * Zero means the shop has not configured a fee — the caller must refuse rather than bill $0.
 */
export interface VisitFeeReader {
  readCents(): Promise<number>;
}
