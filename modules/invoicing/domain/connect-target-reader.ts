// A shop's Connect charge target — the connected account a destination charge routes to, plus
// whether Stripe has enabled charges on it. Sourced from the org's settings (PR1 onboarding state).
export interface ConnectChargeTarget {
  /** The shop's Stripe connected account id (acct_...), or null if onboarding never started. */
  readonly connectedAccountId: string | null;
  /** Mirror of the connected account's charges_enabled — false until onboarding completes. */
  readonly chargesEnabled: boolean;
}

// Reads the current org's Connect charge target. A port so the payment use-case stays decoupled
// from the settings module; the Drizzle adapter bridges to @mallet/settings's repository seam.
// Mirrors the JobReader port (invoicing reaching another module through a focused read).
export interface ConnectTargetReader {
  read(): Promise<ConnectChargeTarget>;
}
