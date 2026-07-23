import type { BusinessInfo } from "../domain/registration";

export function buildConsentDescription(info: BusinessInfo): string {
  return `Customers of ${info.legalName} provide their mobile number and agree to receive text messages from ${info.legalName} when they request service, book an appointment, or ask for a quote — by phone, in person, through the business's website contact or booking form (which includes a consent checkbox), or by texting the business's number first. They consent to receive service-related messages such as appointment confirmations, reminders, quotes, invoices, and support replies about their job. Consent is not a condition of purchase. Customers can reply STOP to opt out and HELP for help.`;
}

export function buildSampleMessages(info: BusinessInfo): string[] {
  const b = info.legalName;
  return [
    `${b}: Hi Dana, confirming your appointment Thu 5/8 between 8–10 AM. Reply C to confirm or R to reschedule. Reply STOP to opt out.`,
    `${b}: Reminder — your technician is scheduled to arrive tomorrow between 1–3 PM. Reply STOP to unsubscribe.`,
    `${b}: Your estimate is ready to view and approve here: https://mallet.link/q/8241. Reply STOP to opt out.`,
    `${b}: Invoice #1042 for $450 is ready. Pay securely here: https://mallet.link/pay/1042. Reply HELP for help, STOP to unsubscribe.`,
    `${b}: Thanks for reaching out! Yes, we can come take a look Friday morning. What's the best address for the visit? Reply STOP to opt out.`,
  ];
}

export function buildOptInMessage(info: BusinessInfo): string {
  return `${info.legalName}: You're now subscribed to service updates. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to unsubscribe.`;
}

export function buildSmsTermsSection(info: BusinessInfo): string {
  return `SMS Terms — ${info.legalName}: By providing your mobile number you agree to receive service-related text messages (appointment confirmations, reminders, quotes, invoices, and support). Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to unsubscribe at any time. Carrier is not liable for delayed or undelivered messages. See our Privacy Policy for how we handle your data.`;
}
