import { z } from "zod";

/**
 * The metadata WE stamped on a Checkout Session at create time (stripe-client.ts), parsed back.
 *
 * Trusted only because it arrives on a signature-verified Stripe event or on a session retrieved
 * server-side from Stripe's API — never from anything the browser sent beyond the cs_ id.
 *
 * `kind` is the router. A DEPOSIT session carries estimateId and no invoiceId, which is exactly
 * why this is a union rather than one object: the previous single schema REQUIRED invoiceId, so a
 * deposit session failed validation and was dropped as "missing/invalid metadata" — a logged 200
 * with the customer's money taken and nothing recorded anywhere.
 *
 * An ABSENT kind means payment: sessions minted before `kind` existed carry only {orgId,
 * invoiceId}, and those must keep settling correctly.
 */
const depositMetadata = z.object({
  orgId: z.string().uuid(),
  estimateId: z.string().uuid(),
  kind: z.literal("deposit"),
});

const paymentMetadata = z.object({
  orgId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  kind: z.literal("payment").optional(),
});

export type CheckoutMetadata = z.infer<typeof depositMetadata> | z.infer<typeof paymentMetadata>;

export type ParsedCheckoutMetadata =
  | { readonly ok: true; readonly value: CheckoutMetadata }
  | { readonly ok: false };

/**
 * Parse session metadata into its routed shape. Discriminates on `kind` FIRST so a deposit session
 * with a malformed estimateId is rejected outright rather than silently falling through to the
 * payment branch (which would only reject it for a different, misleading reason).
 */
export const parseCheckoutMetadata = (raw: unknown): ParsedCheckoutMetadata => {
  const record = (raw ?? {}) as Record<string, unknown>;
  const schema = record.kind === "deposit" ? depositMetadata : paymentMetadata;
  const parsed = schema.safeParse(record);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
};

/** Type guard so callers branch on the union without re-reading `kind`. */
export const isDepositMetadata = (
  metadata: CheckoutMetadata,
): metadata is z.infer<typeof depositMetadata> => metadata.kind === "deposit";
