import { DrizzleSettingsRepository } from "@mallet/settings";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { VisitFeeReader } from "../domain/visit-fee-reader";

// Bridges invoicing's VisitFeeReader port to the settings module's repository (public seam),
// mirroring DrizzleConnectTargetReader. The read is side-effect-free — no lazy org_settings create.
export class DrizzleVisitFeeReader implements VisitFeeReader {
  private readonly repo: DrizzleSettingsRepository;

  constructor(tx: TenantTx, orgId: OrgId) {
    this.repo = new DrizzleSettingsRepository(tx, orgId);
  }

  readCents(): Promise<number> {
    return this.repo.getServiceFeeCents();
  }
}
