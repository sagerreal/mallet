import { SuccessConfirm } from "./success-confirm";

// Stripe Checkout success_url target. The SuccessConfirm island POSTs the session_id (substituted
// by Stripe into the return URL) to the reconcile endpoint so the invoice reflects the payment
// immediately; the webhook remains the primary recorder and the copy degrades gracefully.
export default function PaySuccessPage() {
  return <SuccessConfirm />;
}
