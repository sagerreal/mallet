import { DrizzleSettingsRepository, GetBusinessIdentityUseCase } from "@mallet/settings";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, Clock } from "@mallet/shared/types";
import { isOk } from "@mallet/shared/types";
import type { TerminalLocationStore } from "../domain/terminal-location-store";

/**
 * Bridges invoicing's TerminalLocationStore port to the settings module's repository (public
 * seam), mirroring DrizzleConnectTargetReader: the location id lives on org_settings beside the
 * connected account it belongs to, and the business profile a location is created from is the
 * SAME identity block the invoice document prints (GetBusinessIdentityUseCase) — one definition
 * of "the shop's name and address", not a second one.
 */
export class DrizzleTerminalLocationStore implements TerminalLocationStore {
  private readonly repo: DrizzleSettingsRepository;

  constructor(
    tx: TenantTx,
    private readonly orgId: OrgId,
    private readonly clock: Clock,
  ) {
    this.repo = new DrizzleSettingsRepository(tx, orgId);
  }

  async read(): Promise<string | null> {
    return this.repo.getTerminalLocationId();
  }

  async save(locationId: string): Promise<void> {
    await this.repo.setTerminalLocationId(locationId, this.clock.now());
  }

  async businessProfile(): Promise<{ displayName: string; addressLine1: string | null }> {
    const identity = await new GetBusinessIdentityUseCase(this.repo).exec(this.orgId);
    if (!isOk(identity)) {
      // GetBusinessIdentityUseCase cannot refuse today (it only reads); this guard exists so a
      // future refusal surfaces as a thrown error (→ the org tx rolls back) instead of a
      // fabricated empty profile reaching Stripe.
      throw new Error(`could not read the shop's business identity: ${identity.error.message}`);
    }
    return { displayName: identity.value.name, addressLine1: identity.value.address };
  }
}
