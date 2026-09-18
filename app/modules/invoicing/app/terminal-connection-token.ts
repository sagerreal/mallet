import type { Result, AppError } from "@mallet/shared/types";
import { ok, err, isOk, precondition } from "@mallet/shared/types";
import type { TerminalGateway, TerminalConnectionToken } from "../domain/terminal-gateway";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import type { TerminalLocationStore } from "../domain/terminal-location-store";

/**
 * The sentence every Terminal endpoint refuses with when the shop cannot take cards yet — the
 * SAME copy the Checkout path uses, because it is the same fact and the same next step.
 */
export const CONNECT_NOT_READY =
  "this shop hasn't finished Stripe payment setup — complete onboarding in Settings → Payments to accept cards";

/**
 * Mint a Terminal connection token ON the shop's connected account (direct-charge model — see
 * terminal-gateway.ts). The token is what the phone's Terminal SDK authenticates its reader
 * session with; it is short-lived, single-purpose, and carries no account credential, which is
 * why a technician may request one: it can only ever drive a reader for THEIR shop's account.
 *
 * Scoped to the org's Terminal Location when one is stored (only readers registered to that
 * location can use it); unscoped before the first ensure-location, which Stripe permits and
 * which keeps token minting independent of location setup ordering.
 */
export class CreateTerminalConnectionTokenUseCase {
  constructor(
    private readonly gateway: TerminalGateway,
    private readonly connect: ConnectTargetReader,
    private readonly locations: TerminalLocationStore,
  ) {}

  async exec(): Promise<Result<TerminalConnectionToken, AppError>> {
    const target = await this.connect.read();
    if (!target.connectedAccountId || !target.chargesEnabled) {
      return err(precondition(CONNECT_NOT_READY));
    }
    const locationId = await this.locations.read();
    const token = await this.gateway.createConnectionToken({
      connectedAccountId: target.connectedAccountId,
      locationId,
    });
    if (!isOk(token)) return err(token.error);
    return ok(token.value);
  }
}
