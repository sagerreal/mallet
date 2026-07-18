import { PayResult } from "../pay-result";

// Stripe Checkout cancel_url target (customer backed out; no charge was made).
export default function PayCancelPage() {
  return <PayResult variant="cancel" />;
}
