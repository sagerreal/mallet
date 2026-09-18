import type { OrgId, Result, AppError } from "@mallet/shared/types";
import { ok, err, isOk, precondition } from "@mallet/shared/types";
import type { TerminalGateway } from "../domain/terminal-gateway";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import type { TerminalLocationStore } from "../domain/terminal-location-store";
import { CONNECT_NOT_READY } from "./terminal-connection-token";

export interface EnsureTerminalLocationCommand {
  readonly orgId: OrgId;
}

export interface EnsuredTerminalLocation {
  readonly locationId: string;
  /** True only on the call that actually created the Stripe location. */
  readonly created: boolean;
}

/**
 * Create-once the org's Terminal Location on its connected account, or return the stored one.
 *
 * Tap to Pay readers (the technicians' phones) register themselves to a location at connect
 * time, so one location per shop is the whole fleet model — created from the shop's own name
 * and business address the first time anything Terminal-shaped runs, stored beside the
 * connected account id it belongs to, and never re-created.
 *
 * ORDERING/FAILURE POSTURE: the Stripe create runs before the save (there is no id to save until
 * Stripe answers), inside the caller's org transaction — the same posture as the Checkout charge
 * path, which also calls Stripe inside the request's tx. A save that rolls back does NOT orphan
 * the Stripe location: the idempotency key is stable per (org, account), so the retry gets the
 * SAME location back and saves it then. (Contrast BeginConnectOnboardingUseCase, a NoTx
 * procedure that could — and does — commit the external id in its own tx first.)
 */
export class EnsureTerminalLocationUseCase {
  constructor(
    private readonly gateway: TerminalGateway,
    private readonly connect: ConnectTargetReader,
    private readonly locations: TerminalLocationStore,
  ) {}

  async exec(cmd: EnsureTerminalLocationCommand): Promise<Result<EnsuredTerminalLocation, AppError>> {
    const target = await this.connect.read();
    if (!target.connectedAccountId || !target.chargesEnabled) {
      return err(precondition(CONNECT_NOT_READY));
    }

    const existing = await this.locations.read();
    if (existing) return ok({ locationId: existing, created: false });

    const profile = await this.locations.businessProfile();
    const created = await this.gateway.createLocation({
      connectedAccountId: target.connectedAccountId,
      displayName: profile.displayName,
      addressLine1: profile.addressLine1,
      idempotencyKey: `tml:${cmd.orgId}:${target.connectedAccountId}`,
    });
    if (!isOk(created)) return err(created.error);

    await this.locations.save(created.value.locationId);
    return ok({ locationId: created.value.locationId, created: true });
  }
}
