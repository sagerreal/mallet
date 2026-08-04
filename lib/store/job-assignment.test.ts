/**
 * lib/store/job-assignment.test.ts
 * "Is this job mine?" decides whether a technician is shown the money surfaces on a finished
 * job, so it has to agree with the server's own `Job.isAssignedTo` — or the close-out offers a
 * control the guard then refuses.
 */

import { describe, it, expect } from "vitest";
import { isJobAssignedTo } from "./job-assignment";

const visit = (techId: string | null, status = "done") => ({ techId, status });

describe("isJobAssignedTo", () => {
  it("is true for the assignee of a visit on the job", () => {
    expect(isJobAssignedTo([visit("tech-1")], "tech-1")).toBe(true);
  });

  it("is true on a two-visit job when only the SECOND visit is theirs", () => {
    // The server is deliberately job-level, not visit-level: whichever assigned technician is at
    // the door when the customer pays must be able to collect.
    expect(isJobAssignedTo([visit("tech-2"), visit("tech-1")], "tech-1")).toBe(true);
  });

  it("is false for a colleague's job", () => {
    expect(isJobAssignedTo([visit("tech-2")], "tech-1")).toBe(false);
  });

  it("ignores a CANCELED visit — a canceled assignment is not an assignment", () => {
    expect(isJobAssignedTo([visit("tech-1", "canceled")], "tech-1")).toBe(false);
  });

  it("does not require placement — a job completed straight from My day still counts", () => {
    // isVisitPlaced asks whether the BOARD can draw the visit; whether the technician ran it is a
    // different question, and one such visit has no start time at all.
    expect(isJobAssignedTo([{ techId: "tech-1", status: "done" }], "tech-1")).toBe(true);
  });

  it("fails CLOSED while identity is still loading", () => {
    expect(isJobAssignedTo([visit("tech-1")], undefined)).toBe(false);
    expect(isJobAssignedTo([visit("tech-1")], null)).toBe(false);
    expect(isJobAssignedTo([visit("tech-1")], "")).toBe(false);
  });

  it("fails CLOSED on an unassigned visit — null techId never matches a null user", () => {
    expect(isJobAssignedTo([visit(null)], null)).toBe(false);
  });

  it("handles a job with no visits at all", () => {
    expect(isJobAssignedTo([], "tech-1")).toBe(false);
    expect(isJobAssignedTo(undefined, "tech-1")).toBe(false);
  });
});
