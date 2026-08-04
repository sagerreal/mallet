// A shop's Connect charge target — the connected account a destination charge routes to, plus
// whether Stripe has enabled charges on it. Sourced from the org's settings (Connect onboarding).
export interface ConnectChargeTarget {
  /** The shop's Stripe connected account id (acct_...), or null if onboarding never started. */
  readonly connectedAccountId: string | null;
  /** Mirror of the connected account's charges_enabled — false until onboarding completes. */
  readonly chargesEnabled: boolean;
}

// Reads the current org's Connect charge target, so the deposit use-case stays decoupled from the
// settings module. Deliberately a SECOND declaration of invoicing's identically-shaped port rather
// than an import of it: a module's domain never depends on another module's domain (the import
// boundary allows only barrels, and quoting's barrel pulling invoicing's would drag the invoice
// router — and its config validator — into quoting's unit tests). Both adapters bridge to the same
// settings seam (getConnectTarget), which is where the single source of truth actually lives.
export interface ConnectTargetReader {
  read(): Promise<ConnectChargeTarget>;
}
