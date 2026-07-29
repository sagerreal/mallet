import type { JobId, OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";
import type { NormalizedGeometry } from "./normalized-geometry";

export type RoomCaptureSource = "roomplan_v1" | "manual";

const VALID_SOURCES: readonly RoomCaptureSource[] = ["roomplan_v1", "manual"];
const MAX_ROOM_NAME_LENGTH = 80;
const MAX_RAW_PAYLOAD_BYTES = 512 * 1024;

export interface RoomCaptureProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly jobId: JobId;
  readonly roomName: string;
  readonly source: RoomCaptureSource;
  readonly rawPayload: unknown | null;
  readonly geometry: NormalizedGeometry | null;
  readonly capturedAt: Date;
  readonly supersededById: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

// A single scan (RoomPlan) or manual entry for a room on a job. Immutable; the factory enforces
// invariants so an invalid RoomCapture can never exist.
export class RoomCapture {
  private constructor(private readonly p: RoomCaptureProps) {}

  static create(props: RoomCaptureProps): Result<RoomCapture, ValidationError> {
    const roomName = props.roomName.trim();
    if (roomName.length === 0) return err(validation("room name is required", "roomName"));
    if (roomName.length > MAX_ROOM_NAME_LENGTH) {
      return err(validation(`room name must be ${MAX_ROOM_NAME_LENGTH} characters or fewer`, "roomName"));
    }

    if (!VALID_SOURCES.includes(props.source)) {
      return err(validation(`invalid source: "${props.source}"`, "source"));
    }

    // The wire value may arrive as `undefined` (absent JSON key) — normalize to null so the
    // rest of this factory only ever deals with one "no payload" representation.
    const rawPayload = props.rawPayload === undefined ? null : props.rawPayload;

    if (rawPayload !== null) {
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(rawPayload);
      } catch {
        // JSON.stringify throws on circular structures (and on BigInt); an untrusted payload
        // that can't be serialized is invalid input, not a crash.
        return err(validation("raw payload is not serializable", "rawPayload"));
      }
      // JSON.stringify itself returns undefined for values like a bare function or symbol —
      // treat that the same as "not serializable" rather than let byte-length math blow up.
      if (serialized === undefined) {
        return err(validation("raw payload is not serializable", "rawPayload"));
      }
      // TextEncoder (not Buffer) — the domain layer must stay runtime-agnostic.
      const byteLength = new TextEncoder().encode(serialized).length;
      if (byteLength > MAX_RAW_PAYLOAD_BYTES) {
        return err(validation(`raw payload exceeds ${MAX_RAW_PAYLOAD_BYTES} bytes`, "rawPayload"));
      }
    }

    if (props.source === "roomplan_v1" && props.geometry === null) {
      return err(validation("geometry is required for a roomplan_v1 capture", "geometry"));
    }
    if (props.source === "manual" && props.geometry !== null) {
      return err(validation("geometry must be absent for a manual capture", "geometry"));
    }

    return ok(new RoomCapture({ ...props, roomName, rawPayload }));
  }

  get props(): RoomCaptureProps {
    return this.p;
  }
}
