import type { LeadId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

/**
 * Which payment saved the card: the customer paying an INVOICE, or paying a quote DEPOSIT. Two
 * values because those are the only two places Checkout collects a card in this app — and the
 * charge button answers "you have my card?" with this fact, so it must never be a free string.
 */
export const CARD_ON_FILE_SOURCES = ["payment", "deposit"] as const;
export type CardOnFileVia = (typeof CARD_ON_FILE_SOURCES)[number];

export const isCardOnFileVia = (value: string): value is CardOnFileVia =>
  (CARD_ON_FILE_SOURCES as readonly string[]).includes(value);

/**
 * What a list surface may know about the card: enough to render "Charge Visa ···· 4242 · saved
 * from the deposit" and NOTHING that could charge it. The Stripe pointers never take this shape.
 */
export interface CardOnFileSummary {
  readonly brand: string;
  readonly last4: string;
  readonly via: CardOnFileVia;
}

export interface PaymentProfileProps {
  readonly id: string;
  readonly leadId: LeadId;
  /** The Stripe Customer (cus_…) on the PLATFORM account — where Checkout saved the card. */
  readonly stripeCustomerId: string;
  /** The reusable payment method (pm_…) attached to that customer. */
  readonly stripePaymentMethodId: string;
  /** Presentational, as Stripe reported it ("visa", "mastercard", …). */
  readonly brand: string;
  /** Presentational. Exactly four digits; never more of the number. */
  readonly last4: string;
  readonly via: CardOnFileVia;
  readonly savedAt: Date;
}

const LAST4 = /^[0-9]{4}$/;

/**
 * The customer's card on file — an immutable value object over two Stripe pointers and two
 * presentational facts. One per customer (the store upserts on lead), replaced by whichever
 * successful payment happened most recently: that is the card the customer last proved they
 * control. See shared/db/schema/payment-profiles.ts for the storage rationale.
 */
export class PaymentProfile {
  private constructor(private readonly p: PaymentProfileProps) {}

  static create(props: PaymentProfileProps): Result<PaymentProfile, ValidationError> {
    if (props.stripeCustomerId.trim() === "") {
      return err(validation("stripe customer id is required", "stripeCustomerId"));
    }
    if (props.stripePaymentMethodId.trim() === "") {
      return err(validation("stripe payment method id is required", "stripePaymentMethodId"));
    }
    if (props.brand.trim() === "") return err(validation("card brand is required", "brand"));
    if (!LAST4.test(props.last4)) {
      return err(validation("last4 must be exactly four digits", "last4"));
    }
    if (!isCardOnFileVia(props.via)) {
      return err(validation(`unknown card-on-file source: ${props.via}`, "via"));
    }
    return ok(new PaymentProfile(props));
  }

  get props(): PaymentProfileProps {
    return this.p;
  }

  /** The presentational summary — the ONLY shape that crosses to a list DTO. */
  summary(): CardOnFileSummary {
    return { brand: this.p.brand, last4: this.p.last4, via: this.p.via };
  }
}
