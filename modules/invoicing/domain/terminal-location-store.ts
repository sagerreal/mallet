/**
 * Where the org's ONE Terminal Location id lives, plus the shop facts a location is created
 * from. A port so the ensure-location use-case stays decoupled from the settings module — the
 * Drizzle adapter bridges to @mallet/settings's repository seam, mirroring ConnectTargetReader.
 *
 * `businessProfile` rides on the same port (not its own reader) because the two reads are only
 * ever needed together: a location is created exactly once, from the shop's name and address,
 * and stored here. Splitting them would mint a port with a single one-time caller.
 */
export interface TerminalLocationStore {
  /** The stored Terminal Location id (tml_...), or null before the first ensure. */
  read(): Promise<string | null>;
  /** Persist the created location id. Called at most once per org in practice (ensure-once). */
  save(locationId: string): Promise<void>;
  /** The shop's display name (always present) and free-text business address (nullable). */
  businessProfile(): Promise<{ displayName: string; addressLine1: string | null }>;
}
