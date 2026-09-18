import type { CardOnFileVia } from "../domain/payment-profile";

/**
 * What Stripe saved when the customer paid: the reusable pointers plus the two presentational
 * facts. Read back from the settled payment intent (expand payment_method), platform-side —
 * where the platform-held Checkout session attached them.
 */
export interface SavedCardFacts {
  readonly customerId: string;
  readonly paymentMethodId: string;
  readonly brand: string;
  readonly last4: string;
}

/** Which record the settled session was FOR — the same discriminator the recorders route on. */
export type CaptureSubject =
  | { readonly kind: "payment"; readonly invoiceId: string }
  | { readonly kind: "deposit"; readonly estimateId: string };

export interface CaptureCardArgs {
  readonly orgId: string;
  readonly subject: CaptureSubject;
  /** The settled pi_… id, exactly as the recorders extracted it. Null = nothing to read from. */
  readonly paymentIntentId: string | null;
}

export interface CaptureCardDeps {
  /**
   * Reads the saved card off the settled intent (StripeClient.retrieveSavedCardFromIntent).
   * Null when the intent saved nothing reusable — old sessions minted before setup_future_usage,
   * or a wallet payment with no card behind it. Throwing = transient; caught here.
   */
  retrieveCard: (paymentIntentId: string) => Promise<SavedCardFacts | null>;
  /**
   * Resolves the subject to its customer and UPSERTS the profile inside one tenant tx
   * (saveCardOnFile). False when the subject cannot hold a card — invoice/estimate missing or
   * its customer archived. Throwing = transient; caught here.
   */
  saveProfile: (args: {
    orgId: string;
    subject: CaptureSubject;
    card: SavedCardFacts;
    via: CardOnFileVia;
  }) => Promise<boolean>;
  log: (message: string, ctx?: Record<string, unknown>) => void;
}

export interface CaptureCardOutcome {
  readonly saved: boolean;
  readonly reason?: "no_intent" | "nothing_saved" | "no_lead" | "error";
}

/**
 * Store the card a customer just paid with, as their card on file — the CAPTURE half of
 * charge-card-on-file. Called by both delivery paths (webhook and success-page reconcile) right
 * after the money is recorded; the upsert makes the second delivery harmless.
 *
 * THE ONE CONTRACT THAT MATTERS: this NEVER throws. The payment is already recorded by the time
 * this runs, and no bonus fact about a card may turn a settled payment into a 500 — which would
 * have Stripe redeliver a webhook for money that is already on the ledger. Failures are logged
 * (a shop that expects the charge button and never gets it needs a trail) and reported in the
 * return value for the callers' tests.
 */
export const captureCardOnFile = async (
  args: CaptureCardArgs,
  deps: CaptureCardDeps,
): Promise<CaptureCardOutcome> => {
  if (!args.paymentIntentId) return { saved: false, reason: "no_intent" };
  try {
    const card = await deps.retrieveCard(args.paymentIntentId);
    // The normal case for sessions minted before capture existed, and for payment methods with
    // nothing reusable behind them. Quietly nothing to do — not a failure worth a log line.
    if (!card) return { saved: false, reason: "nothing_saved" };

    const saved = await deps.saveProfile({
      orgId: args.orgId,
      subject: args.subject,
      card,
      via: args.subject.kind === "deposit" ? "deposit" : "payment",
    });
    if (!saved) return { saved: false, reason: "no_lead" };
    return { saved: true };
  } catch (error) {
    deps.log("card-on-file capture failed — payment already recorded, card not saved", {
      orgId: args.orgId,
      paymentIntentId: args.paymentIntentId,
      err: error instanceof Error ? error.message : String(error),
    });
    return { saved: false, reason: "error" };
  }
};
