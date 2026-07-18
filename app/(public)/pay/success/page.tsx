import { PayResult } from "../pay-result";

// Stripe Checkout success_url target (destination charge succeeded; the webhook records the payment).
export default function PaySuccessPage() {
  return <PayResult variant="success" />;
}
