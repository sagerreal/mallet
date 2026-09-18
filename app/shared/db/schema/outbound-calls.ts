import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";

// One row per click-to-call the office places from Mallet. Distinct from frontdesk_calls,
// which is the Vapi INBOUND record (keyed on a non-null vapi_call_id, with transcript and
// AI disposition) — an outbound call has neither, and has a two-leg provider lifecycle
// (agent leg rings first, then the customer leg is bridged) that table cannot express.
//
// This row is also the persisted call LOG: outcome + notes are written when the office
// picks a disposition, so the record survives a refresh.
//
// TWO transports write this table. "phone" rings the caller's own handset and bridges (the field
// case, and any browser that can't do WebRTC). "browser" is the softphone: the caller's microphone
// IS the leg, so there is no agent number and nothing rings.
export const outboundCalls = pgTable(
  "outbound_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    // Every outbound call is placed to a customer, so this is NOT nullable — unlike
    // frontdesk_calls, where a caller can hang up before a lead is matched.
    leadId: uuid("lead_id").notNull(),
    // Who pressed call — kept for per-user attribution in the timeline.
    placedByUserId: uuid("placed_by_user_id").notNull(),
    // The customer we are calling.
    toNumber: text("to_number").notNull(),
    // The org's business line — what the customer's phone displays as the caller ID.
    fromNumber: text("from_number").notNull(),
    // The agent's own mobile: Twilio rings THIS first, then bridges to toNumber.
    // NULL on a browser call — there is no handset to ring, the microphone is the leg.
    agentNumber: text("agent_number"),
    // phone | browser — which way this call was carried. A browser call has no agent_number and
    // its provider SID is the client leg, so the two cannot be told apart from the other columns.
    transport: text("transport").notNull().default("phone"),
    // queued | dialing | in_progress | completed | failed | no_answer | busy | canceled
    status: text("status").notNull().default("queued"),
    // Twilio's Call SID for the AGENT leg. Null until the provider accepts the request.
    // Unique per org so a replayed status webhook cannot bind to two rows.
    providerCallSid: text("provider_call_sid"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    // Disposition chosen by the office after hanging up (CALL_OUTCOMES), plus free notes
    // typed during the call.
    outcome: text("outcome"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // The status webhook resolves a row by SID alone, so this must be unique per org.
    uniqueIndex("outbound_calls_provider_sid_uidx").on(t.orgId, t.providerCallSid),
    index("outbound_calls_lead_idx").on(t.orgId, t.leadId),
    index("outbound_calls_created_idx").on(t.orgId, t.createdAt),
    // Composite FK (org_id, lead_id) → leads(org_id, id): prevents cross-tenant call→lead links.
    foreignKey({
      name: "outbound_calls_org_lead_fk",
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }),
  ],
);
