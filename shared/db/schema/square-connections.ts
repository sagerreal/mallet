import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// One Square connection per org. RLS is added by a hand-written migration — drizzle-kit does not
// emit it, and this table holds the credentials that move a shop's money.
//
// WHY A SEPARATE TABLE rather than columns on org_settings, where Stripe's connected account lives:
// Square is "connect the account the shop ALREADY has" (OAuth), not Stripe Connect's "create an
// account for them". That means tokens, expiry and a refresh lifecycle — the qbo_connections shape,
// not the stripe_connected_account_id shape. Widening the Stripe columns would force two unrelated
// lifecycles through one set of fields.
//
// SECURITY: both token columns hold SEALED values (AES-256-GCM via platform/crypto/secret-box),
// never plaintext — same law as qbo_connections. These are replayable secrets that authorise
// charges against a real merchant, so nothing in this table may be logged.
//
// Tokens are "" on a disconnected row rather than nullable, mirroring qbo_connections: the domain
// treats empty-and-disconnected as legal and empty-and-active as invalid, so NULL would add a
// third state that means nothing extra.
export const squareConnections = pgTable(
  "square_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Square's merchant id. Not globally unique here: the same merchant could in principle be
    // connected by two different Mallet orgs, exactly as with QBO realms.
    merchantId: text("merchant_id").notNull(),
    // The seller location payments are taken against. Square scopes payments by location and a
    // merchant may have several; null until the shop picks one.
    locationId: text("location_id"),
    accessTokenSealed: text("access_token_sealed").notNull().default(""),
    refreshTokenSealed: text("refresh_token_sealed").notNull().default(""),
    // Square access tokens are short-lived and the refresh token rotates on use.
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("active"),
    connectedByUserId: uuid("connected_by_user_id"),
    // The scopes the seller actually granted, verbatim. Stored because app fees depend on
    // PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS being among them — a connection without it can still
    // take payments, just not our fee, and that has to be visible rather than inferred at charge
    // time when it is far too late to ask.
    scopes: text("scopes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // ONE live connection per org. Partial on deleted_at so a disconnected row can be kept as
    // history without blocking a reconnect.
    uniqueIndex("square_connections_org_live_uq")
      .on(t.orgId)
      .where(sql`${t.deletedAt} is null`),
    check("square_connections_status_ck", sql`${t.status} in ('active','disconnected','expired')`),
  ],
);
