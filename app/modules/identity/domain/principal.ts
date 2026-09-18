import type { UserId, OrgId } from "@mallet/shared/types";

// Who is making a request, resolved from a verified session. The org_id here is the single
// source of truth for tenancy — it is set on the org-scoped transaction and never taken from
// client input.
export type Role = "owner" | "office" | "tech";

export interface Principal {
  readonly userId: UserId;
  readonly orgId: OrgId;
  readonly role: Role;
}

export const ROLES: readonly Role[] = ["owner", "office", "tech"];

export const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);
