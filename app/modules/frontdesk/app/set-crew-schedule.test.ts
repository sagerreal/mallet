import { describe, it, expect, vi } from "vitest";
import { asOrgId, asUserId } from "@mallet/shared/types";
import type { UserId } from "@mallet/shared/types";
import type { CrewDaySchedule } from "../domain/availability";
import type { CrewScheduleRepository } from "../domain/crew-schedule-repository";
import type { CrewScheduleEntry } from "../domain/crew-schedule";
import { SetCrewScheduleUseCase } from "./set-crew-schedule";

const ORG_ID = asOrgId("00000000-0000-0000-0000-000000000001");
const USER_ID = "00000000-0000-0000-0000-000000000002";

function makeRepo(rows: CrewDaySchedule[] = []): CrewScheduleRepository & {
  replaceForUser: ReturnType<typeof vi.fn>;
} {
  const replaceForUser = vi.fn<
    (userId: UserId, entries: readonly CrewScheduleEntry[]) => Promise<void>
  >(async () => undefined);
  return {
    replaceForUser,
    listForOrg: async () => rows,
  };
}

describe("SetCrewScheduleUseCase", () => {
  it("saves validated entries and returns that user's rows", async () => {
    const userId = asUserId(USER_ID);
    const stored: CrewDaySchedule[] = [
      { userId, weekday: 1, openHour: 8, closeHour: 17 },
      { userId, weekday: 2, openHour: 8, closeHour: 17 },
    ];
    const repo = makeRepo(stored);
    const useCase = new SetCrewScheduleUseCase(repo);

    const result = await useCase.exec(
      {
        userId: USER_ID,
        entries: [
          { weekday: 1, openHour: 8, closeHour: 17 },
          { weekday: 2, openHour: 8, closeHour: 17 },
        ],
      },
      ORG_ID,
    );

    expect(result.ok).toBe(true);
    expect(repo.replaceForUser).toHaveBeenCalledTimes(1);
    const [calledUserId, calledEntries] = repo.replaceForUser.mock.calls[0] as [
      UserId,
      readonly CrewScheduleEntry[],
    ];
    expect(calledUserId).toBe(userId);
    expect(calledEntries).toHaveLength(2);
    if (result.ok) {
      expect(result.value).toEqual(stored);
    }
  });

  it("returns a validation error for duplicate weekdays without calling the repo", async () => {
    const repo = makeRepo();
    const useCase = new SetCrewScheduleUseCase(repo);

    const result = await useCase.exec(
      {
        userId: USER_ID,
        entries: [
          { weekday: 1, openHour: 8, closeHour: 17 },
          { weekday: 1, openHour: 9, closeHour: 18 },
        ],
      },
      ORG_ID,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
    expect(repo.replaceForUser).not.toHaveBeenCalled();
  });

  it("returns a validation error for an invalid entry (weekday 7) without calling the repo", async () => {
    const repo = makeRepo();
    const useCase = new SetCrewScheduleUseCase(repo);

    const result = await useCase.exec(
      {
        userId: USER_ID,
        entries: [{ weekday: 7, openHour: 8, closeHour: 17 }],
      },
      ORG_ID,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
    expect(repo.replaceForUser).not.toHaveBeenCalled();
  });

  it("calls replaceForUser with empty array when entries is empty (clears overrides)", async () => {
    const repo = makeRepo();
    const useCase = new SetCrewScheduleUseCase(repo);

    const result = await useCase.exec({ userId: USER_ID, entries: [] }, ORG_ID);

    expect(result.ok).toBe(true);
    expect(repo.replaceForUser).toHaveBeenCalledTimes(1);
    const [, calledEntries] = repo.replaceForUser.mock.calls[0] as [
      UserId,
      readonly CrewScheduleEntry[],
    ];
    expect(calledEntries).toHaveLength(0);
  });
});
