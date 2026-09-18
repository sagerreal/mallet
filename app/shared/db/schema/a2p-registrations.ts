import { pgTable, uuid, text, boolean, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// One A2P 10DLC registration per org (the shop's own Brand + Campaign as an ISV secondary profile).
// Each external SID is stored the moment Twilio returns it, before the next fallible call, so a
// mid-sequence failure resumes rather than orphaning a Twilio resource (mirrors Stripe Connect).
export const a2pRegistrations = pgTable(
  "a2p_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    // State machine — see modules/a2p/domain/registration.ts for legal transitions.
    status: text("status").notNull().default("not_started"),
    secondaryProfileSid: text("secondary_profile_sid"),
    brandSid: text("brand_sid"),
    messagingServiceSid: text("messaging_service_sid"),
    campaignSid: text("campaign_sid"),
    phoneNumberSid: text("phone_number_sid"),
    // The collected business form (legal name, address, industry, EIN-or-null, contact). PII —
    // never logged; only SIDs/status are logged elsewhere.
    businessInfo: jsonb("business_info"),
    otpVerified: boolean("otp_verified").notNull().default(false),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("a2p_registrations_org_uidx").on(t.orgId)],
);
