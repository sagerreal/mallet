import type { Result, AppError } from "@mallet/shared/types";
import { asOrgId, asJobId, notFound, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { RoomCapture } from "../domain/room-capture";
import type { MeasurementRepository } from "../domain/measurement-repository";

export interface RenameRoomCommand {
  readonly captureId: string;
  readonly roomName: string;
}

export interface RenamedRoom {
  readonly captureId: string;
  readonly roomName: string;
}

// Validates the new name using the exact same rule RoomCapture.create enforces (non-empty,
// <= 80 chars, trimmed) by routing it through a throwaway RoomCapture build rather than
// duplicating the constant — one source of truth for what a valid room name is.
export class RenameRoomUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: RenameRoomCommand, orgId: string): Promise<Result<RenamedRoom, AppError>> {
    const now = this.clock.now();
    const validationCheck = RoomCapture.create({
      id: "00000000-0000-0000-0000-000000000000",
      orgId: asOrgId(orgId),
      jobId: asJobId("00000000-0000-0000-0000-000000000000"),
      roomName: cmd.roomName,
      source: "manual",
      rawPayload: null,
      geometry: null,
      capturedAt: now,
      supersededById: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    if (!validationCheck.ok) return err(validationCheck.error);
    const roomName = validationCheck.value.props.roomName;

    const affected = await this.repo.renameRoom(cmd.captureId, roomName);
    if (affected === 0) return err(notFound("room capture not found"));

    logger.info({ captureId: cmd.captureId, orgId }, "measurements.room_renamed");

    return ok({ captureId: cmd.captureId, roomName });
  }
}
