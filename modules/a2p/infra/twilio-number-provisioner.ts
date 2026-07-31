import twilio from "twilio";
import type { Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { NumberProvisioner, NumberSearch, ProvisionedNumber } from "../domain/number-provisioner";

/**
 * Buys a shop's business number from Twilio.
 *
 * SEARCH WIDENS, IT DOES NOT FAIL. A shop whose ZIP has no numbers left still needs a phone, so
 * this tries the postal code, then the surrounding state, then anywhere in the US. A number in the
 * next area code is a cosmetic disappointment; no number at all is a shop that cannot be called.
 *
 * The SMS webhook points at Mallet immediately, but the number is NOT attached to any Messaging
 * Service here — a shop texts its customers under its OWN 10DLC registration, and borrowing
 * Mallet's would be exactly the aggregator pattern carriers filter and suspend for. A2pGateway
 * attaches it once that shop's own campaign is approved.
 *
 * Voice is left pointing at Twilio's default until the number is imported to Vapi, which is a
 * separate call against Vapi's API — tracked as the next step rather than half-wired here, because
 * a voice URL pointing at nothing answers with a Twilio error message in the customer's ear.
 */

/** The transport seam — swapped in tests so the whole search-and-widen path runs without Twilio. */
export interface NumberPurchaseTransport {
  search(params: { postalCode?: string; region?: string }): Promise<Array<{ phoneNumber: string }>>;
  buy(params: { phoneNumber: string; smsUrl: string; friendlyName: string }): Promise<{ sid: string; phoneNumber: string }>;
}

export class TwilioNumberProvisioner implements NumberProvisioner {
  private readonly transport: NumberPurchaseTransport;

  constructor(
    accountSid: string,
    authToken: string,
    private readonly smsWebhookUrl: string,
    transport?: NumberPurchaseTransport,
  ) {
    const client = twilio(accountSid, authToken);
    this.transport =
      transport ??
      {
        async search(params) {
          const list = await client.availablePhoneNumbers("US").local.list({
            ...(params.postalCode ? { inPostalCode: params.postalCode } : {}),
            ...(params.region ? { inRegion: params.region } : {}),
            smsEnabled: true,
            voiceEnabled: true,
            limit: 5,
          });
          return list.map((n) => ({ phoneNumber: n.phoneNumber }));
        },
        async buy(params) {
          const bought = await client.incomingPhoneNumbers.create({
            phoneNumber: params.phoneNumber,
            friendlyName: params.friendlyName,
            smsUrl: params.smsUrl,
            smsMethod: "POST",
          });
          return { sid: bought.sid, phoneNumber: bought.phoneNumber };
        },
      };
  }

  async provision(search: NumberSearch): Promise<Result<ProvisionedNumber, ExternalServiceError>> {
    try {
      const candidate = await this.findCandidate(search.postalCode);
      if (!candidate) {
        logger.error({ postalCode: search.postalCode }, "a2p.number.none_available");
        return err(externalService("twilio", "no phone numbers are available to buy right now"));
      }

      const bought = await this.transport.buy({
        phoneNumber: candidate,
        smsUrl: this.smsWebhookUrl,
        friendlyName: "Elas business line",
      });

      logger.info({ phoneNumber: bought.phoneNumber }, "a2p.number.provisioned");
      return ok({ phoneNumber: bought.phoneNumber, phoneNumberSid: bought.sid });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "a2p.number.provision_failed",
      );
      return err(externalService("twilio", "could not buy a phone number"));
    }
  }

  /** Postal code → state → anywhere. Each step only runs because the previous found nothing. */
  private async findCandidate(postalCode: string | null): Promise<string | null> {
    if (postalCode) {
      const local = await this.transport.search({ postalCode });
      if (local[0]) return local[0].phoneNumber;
      logger.warn({ postalCode }, "a2p.number.postal_code_empty — widening to state");

      const region = STATE_BY_ZIP_PREFIX[postalCode.slice(0, 3)];
      if (region) {
        const inState = await this.transport.search({ region });
        if (inState[0]) return inState[0].phoneNumber;
        logger.warn({ region }, "a2p.number.state_empty — widening to national");
      }
    }
    const anywhere = await this.transport.search({});
    return anywhere[0]?.phoneNumber ?? null;
  }
}

/**
 * ZIP-prefix → state, for the middle widening step only.
 *
 * Deliberately partial. This is a fallback used when the exact ZIP is sold out; a miss simply
 * widens straight to national, which is the step after anyway. A complete ZIP database would be
 * thousands of rows maintained forever to slightly improve one fallback — the three-digit prefix
 * ranges below cover the whole country accurately enough for that purpose.
 */
const STATE_BY_ZIP_PREFIX: Record<string, string> = (() => {
  const ranges: Array<[number, number, string]> = [
    [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 59, "VT"],
    [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"],
    [200, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"],
    [290, 299, "SC"], [300, 319, "GA"], [320, 349, "FL"], [350, 369, "AL"], [370, 385, "TN"],
    [386, 397, "MS"], [400, 427, "KY"], [430, 458, "OH"], [460, 479, "IN"], [480, 499, "MI"],
    [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"], [570, 577, "SD"], [580, 588, "ND"],
    [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"],
    [700, 714, "LA"], [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"],
    [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"],
    [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"],
    [995, 999, "AK"],
  ];
  const out: Record<string, string> = {};
  for (const [from, to, state] of ranges) {
    for (let i = from; i <= to; i++) out[String(i).padStart(3, "0")] = state;
  }
  return out;
})();
