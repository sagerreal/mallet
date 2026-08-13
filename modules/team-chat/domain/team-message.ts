import type { OrgId, UserId, Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

/** The only media types the chat accepts — same set the job-photo pipeline renders. */
export type ChatMediaType = "image/jpeg" | "image/png" | "image/webp";
export const CHAT_MEDIA_TYPES: readonly ChatMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** Extensions the upload path will mint a key for, paired to the type stored on the row. */
export const CHAT_EXT_TO_MEDIA_TYPE: Readonly<Record<string, ChatMediaType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * 10 MB. The browser downscales photos to a 1568px long edge before upload (lib/images
 * /downscale.ts), which lands a phone photo well under this — the cap is the backstop for a
 * client that skips that path, and it is ALSO set on the bucket so storage refuses the bytes
 * even if a caller lies to the API.
 */
export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024;

/** A message's body cap. Generous for a note to a colleague, bounded so a row stays a row. */
export const MAX_CHAT_BODY = 4000;

export interface ChatAttachment {
  readonly path: string;
  readonly mediaType: ChatMediaType;
  readonly bytes: number;
}

export interface TeamMessageProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly authorUserId: UserId;
  readonly body: string;
  readonly attachment: ChatAttachment | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * One message. A row must carry words, a photo, or both — an empty message is not a thing
 * somebody meant to send, and the storage CHECK says the same.
 */
export class TeamMessage {
  private constructor(private readonly p: TeamMessageProps) {}

  static create(props: TeamMessageProps): Result<TeamMessage, ValidationError> {
    const body = props.body.trim();
    if (body.length === 0 && !props.attachment) {
      return err(validation("write a message or attach a photo", "body"));
    }
    if (body.length > MAX_CHAT_BODY) {
      return err(validation(`message must be ${MAX_CHAT_BODY} characters or fewer`, "body"));
    }
    const file = props.attachment;
    if (file) {
      if (!CHAT_MEDIA_TYPES.includes(file.mediaType)) {
        return err(validation("only JPEG, PNG and WebP photos can be attached", "attachment"));
      }
      if (file.bytes <= 0 || file.bytes > MAX_CHAT_FILE_BYTES) {
        return err(validation("attachments must be 10MB or smaller", "attachment"));
      }
    }
    return ok(new TeamMessage({ ...props, body }));
  }

  get props(): TeamMessageProps {
    return this.p;
  }
}
