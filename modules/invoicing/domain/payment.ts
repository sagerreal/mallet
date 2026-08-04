import type { Money, Result, UserId, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export type PaymentMethod = "card" | "ach" | "cash" | "check" | "card_terminal";

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "card",
  "ach",
  "cash",
  "check",
  "card_terminal",
];

export const isPaymentMethod = (value: string): value is PaymentMethod =>
  (PAYMENT_METHODS as readonly string[]).includes(value);

export interface PaymentProps {
  readonly id: string;
  readonly amount: Money; // integer cents, always positive
  readonly method: PaymentMethod;
  readonly idempotencyKey: string; // client-supplied; dedupes retries at the ledger
  readonly externalId: string | null; // Stripe payment id later; null for manual
  /**
   * The authenticated user who took the money. Required at every construction site so attribution
   * is a deliberate decision, never an omission — but nullable, because two cases genuinely have no
   * in-app actor: a card payment the customer settled online (Stripe webhook), and rows written
   * before the column existed. Never sourced from client input.
   */
  readonly recordedByUserId: UserId | null;
  readonly receivedAt: Date;
}

// A single settled payment against an invoice. Immutable value object; the payments ledger is
// append-only, so a Payment is never mutated after creation.
export class Payment {
  private constructor(private readonly p: PaymentProps) {}

  static create(props: PaymentProps): Result<Payment, ValidationError> {
    if (props.amount <= 0) return err(validation("payment amount must be positive", "amount"));
    if (!isPaymentMethod(props.method)) {
      return err(validation(`unknown payment method: ${props.method}`, "method"));
    }
    if (props.idempotencyKey.trim().length < 8) {
      return err(validation("idempotency key must be at least 8 chars", "idempotencyKey"));
    }
    return ok(new Payment(props));
  }

  get props(): PaymentProps {
    return this.p;
  }
}
