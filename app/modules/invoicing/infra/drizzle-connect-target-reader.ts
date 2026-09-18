import { DrizzleSettingsRepository } from "@mallet/settings";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { ConnectTargetReader, ConnectChargeTarget } from "../domain/connect-target-reader";

// Bridges invoicing's ConnectTargetReader port to the settings module's repository (public seam),
// mirroring DrizzleJobReader. Keeps invoicing decoupled from settings internals; the read is
// side-effect-free (no lazy org_settings create).
export class DrizzleConnectTargetReader implements ConnectTargetReader {
  private readonly repo: DrizzleSettingsRepository;

  constructor(tx: TenantTx, orgId: OrgId) {
    this.repo = new DrizzleSettingsRepository(tx, orgId);
  }

  async read(): Promise<ConnectChargeTarget> {
    return this.repo.getConnectTarget();
  }
}
