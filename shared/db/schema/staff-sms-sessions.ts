import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { users } from "./users";

// One live text conversation between a staffer and the agent.
//
// WHY THIS TABLE HAS TO EXIST. The agent loop is stateless across calls: `runAgentTurn` returns an
// opaque transcript and the CALLER is expected to hand it back next turn. In the app the browser
// does that (`useCounter` keeps it in React state). A text message has no browser, so without a
// server-side home every message would start a conversation from nothing — no follow-ups, no "yes"
// to a question the agent just asked.
//
// It also carries the approval hand-off. `runAgentTurn` HALTS on any mutating tool and returns
// `needs_approval` with a list of pending tool_use ids. In the app those become buttons. Over text
// they become "reply YES", so the ids have to survive between two separate inbound webhooks.
export const staffSmsSessions = pgTable(
  "staff_sms_sessions",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // The staffer this conversation belongs to. Composite FK so a session can never point at
    // another org's user — the same guarantee jobs.assignee_user_id uses.
    userId: uuid("user_id").notNull(),
    // The verified mobile the texts come from. Denormalised so the inbound lookup is one indexed
    // read on this table and does not have to join users on every message.
    phone: text("phone").notNull(),

    // The agent transcript, exactly as runAgentTurn returns it. Opaque JSON — this column is
    // written and read whole, never queried into.
    transcript: text("transcript"),

    // Tool-use ids the agent is waiting on, JSON array. Non-empty means the last reply asked a
    // yes/no question and the next inbound message is an ANSWER, not a new instruction.
    pendingJson: text("pending_json"),

    // What the agent said it would do, kept so a late "yes" can be answered with the same words
    // the staffer was shown rather than a silent execution.
    pendingSummary: text("pending_summary"),

    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live session per phone per org — the inbound lookup key.
    uniqueIndex("staff_sms_sessions_org_phone_uidx").on(t.orgId, t.phone),
    index("staff_sms_sessions_org_idx").on(t.orgId),
    index("staff_sms_sessions_user_idx").on(t.orgId, t.userId),
  ],
);
