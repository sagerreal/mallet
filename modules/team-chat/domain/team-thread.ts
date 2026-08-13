import type { OrgId, UserId, Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

export type ThreadKind = "dm" | "group";

export const MAX_GROUP_TITLE = 80;
/** A group big enough for a whole shop's crew, small enough that nobody is broadcasting. */
export const MAX_GROUP_MEMBERS = 50;

export interface TeamThreadProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly kind: ThreadKind;
  readonly title: string | null;
  readonly dmKey: string | null;
  readonly createdByUserId: UserId;
  readonly lastMessageAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The key that makes a DM find-or-create instead of fork: both user ids, sorted, joined.
 * Sorting is what makes it symmetric — "Dana → Mike" and "Mike → Dana" produce the same key,
 * so the unique index on (org_id, dm_key) collapses them onto one conversation.
 */
export const dmKeyFor = (a: UserId, b: UserId): string => [a, b].sort().join(":");

/**
 * A conversation between staff. Immutable; all construction goes through create() so the
 * kind/title/dm_key shape is enforced in one place (and matches the storage CHECK).
 */
export class TeamThread {
  private constructor(private readonly p: TeamThreadProps) {}

  static create(props: TeamThreadProps): Result<TeamThread, ValidationError> {
    if (props.kind === "dm") {
      if (!props.dmKey) return err(validation("a direct message needs a dm key", "dmKey"));
      if (props.title !== null) return err(validation("a direct message has no title", "title"));
      return ok(new TeamThread(props));
    }
    const title = (props.title ?? "").trim();
    if (title.length === 0) return err(validation("group name is required", "title"));
    if (title.length > MAX_GROUP_TITLE) {
      return err(validation(`group name must be ${MAX_GROUP_TITLE} characters or fewer`, "title"));
    }
    if (props.dmKey !== null) return err(validation("a group has no dm key", "dmKey"));
    return ok(new TeamThread({ ...props, title }));
  }

  get props(): TeamThreadProps {
    return this.p;
  }
}
