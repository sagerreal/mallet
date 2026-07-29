import { eq, isNull, and } from "drizzle-orm";
import { orgs } from "@mallet/shared/db/schema";
import { withTenant } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { isOk } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { NumberProvisioner } from "../domain/number-provisioner";

export interface ProvisionOrgNumberCommand {
  readonly orgId: OrgId;
  /** The shop's ZIP from signup, so the area code is local to them. */
  readonly postalCode: string | null;
}

export type ProvisionOutcome =
  | { readonly kind: "provisioned"; readonly phoneNumber: string; readonly phoneNumberSid: string }
  /** Already had one — signup retried, or an admin set it by hand. */
  | { readonly kind: "already_had_one" }
  /** Twilio could not sell us one. The org exists and works; it just has no line yet. */
  | { readonly kind: "unavailable" };

/**
 * Give a newly created shop its business phone number.
 *
 * NEVER THROWS. This runs during signup, and a shop that cannot buy a phone number must still get
 * an account — failing the signup over Twilio being down would turn a provider outage into "Mallet
 * is broken, I could not even sign up". The Front Desk header already renders "Getting your number
 * — we'll email you when it's live" when `orgs.twilio_number` is null, so the not-yet state is a
 * designed one rather than an error.
 *
 * IDEMPOTENT. The UPDATE only matches a row whose number is still null, so a retry (or two signup
 * requests racing) cannot buy a second number for the same shop and silently strand the first one
 * on the bill.
 */
export class ProvisionOrgNumberUseCase {
  constructor(private readonly provisioner: NumberProvisioner) {}

  async exec(cmd: ProvisionOrgNumberCommand): Promise<ProvisionOutcome> {
    const existing = await withTenant(cmd.orgId, async (tx) => {
      const [row] = await tx.select({ n: orgs.twilioNumber }).from(orgs).where(eq(orgs.id, cmd.orgId)).limit(1);
      return row?.n ?? null;
    });
    if (existing) return { kind: "already_had_one" };

    const bought = await this.provisioner.provision({ postalCode: cmd.postalCode });
    if (!isOk(bought)) {
      // Loud, because nobody is watching a signup: this is the only trace that a shop was created
      // without a line, and somebody has to go and finish it.
      logger.error({ orgId: cmd.orgId, postalCode: cmd.postalCode }, "a2p.number.org_left_without_number");
      return { kind: "unavailable" };
    }

    const claimed = await withTenant(cmd.orgId, async (tx) =>
      tx
        .update(orgs)
        .set({ twilioNumber: bought.value.phoneNumber })
        // `isNull` is the race guard: two concurrent provisions cannot both win, so the second
        // one's number would be paid for and unreferenced. Losing that race is worth knowing about.
        .where(and(eq(orgs.id, cmd.orgId), isNull(orgs.twilioNumber)))
        .returning({ id: orgs.id }),
    );

    if (claimed.length === 0) {
      logger.error(
        { orgId: cmd.orgId, phoneNumber: bought.value.phoneNumber },
        "a2p.number.bought_but_not_claimed — another provision won the race; this number is paid for and unused",
      );
      return { kind: "already_had_one" };
    }

    return { kind: "provisioned", phoneNumber: bought.value.phoneNumber, phoneNumberSid: bought.value.phoneNumberSid };
  }
}
