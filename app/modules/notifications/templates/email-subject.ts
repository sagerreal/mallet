// Maps a notification `kind` to an email subject line. Kept functional and plain (no marketing
// voice) — the body carries the detail. Unknown kinds get a neutral fallback rather than leaking
// the internal kind string to the customer.
export const emailSubjectFor = (kind: string): string => {
  switch (kind) {
    case "invoice_sent":
      return "Your invoice is ready";
    case "invoice_reminder":
      return "Reminder: your invoice is due";
    // A settled bill. The default arm ("A message from your service provider") would be a worse
    // answer than the truth on the one message a customer files and keeps.
    case "payment_receipt":
      return "Your receipt";
    case "estimate_sent":
      return "Your estimate is ready";
    case "estimate_reminder":
      return "Reminder: your estimate is waiting";
    default:
      return "A message from your service provider";
  }
};
