import { describe, it, expect } from "vitest";
import { CountTimeEntriesUseCase } from "./count-time-entries";
import type { TimeEntryRepository, TimeEntryFilter } from "../domain/time-entry-repository";
import { asUserId } from "@mallet/shared/types";

class FakeRepo {
  calls: TimeEntryFilter[] = [];
  constructor(private readonly result: number) {}
  async count(filter: TimeEntryFilter): Promise<number> {
    this.calls.push(filter);
    return this.result;
  }
}

const useCase = (repo: FakeRepo) =>
  new CountTimeEntriesUseCase(repo as unknown as TimeEntryRepository);

describe("CountTimeEntriesUseCase", () => {
  it("returns the repository's count", async () => {
    const repo = new FakeRepo(412);
    expect(await useCase(repo).exec({ filter: {} })).toBe(412);
  });

  it("passes the filter through untouched — the count must describe the same set as the list", async () => {
    const repo = new FakeRepo(0);
    const filter: TimeEntryFilter = {
      techUserId: asUserId("11111111-1111-1111-1111-111111111111"),
      fromDate: "2026-07-27",
      toDate: "2026-08-02",
    };
    await useCase(repo).exec({ filter });
    expect(repo.calls).toEqual([filter]);
  });

  it("returns zero rather than treating an empty shop as an error", async () => {
    // Zero is the answer that drives the first-run screen. It has to be a value, not a failure —
    // a thrown error there would render "couldn't load hours" to a shop whose hours are simply none.
    expect(await useCase(new FakeRepo(0)).exec({ filter: {} })).toBe(0);
  });
});
