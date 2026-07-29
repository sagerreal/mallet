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

    if (props.rawPayload !== null) {
      const byteLength = Buffer.byteLength(JSON.stringify(props.rawPayload), "utf8");
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

    return ok(new RoomCapture({ ...props, roomName }));
  }

  get props(): RoomCaptureProps {
    return this.p;
  }
}
