import { describe, it, expect } from "vitest";
import { asJobId, isOk, isErr } from "@mallet/shared/types";
import {
  JobLine,
  JobAddon,
  JobVerifyAnswer,
  JobPhoto,
} from "./job-execution";

const JOB = asJobId("11111111-1111-1111-1111-111111111111");

describe("JobLine", () => {
  it("rejects an empty description", () => {
    const r = JobLine.create({
      id: "l1",
      jobId: JOB,
      description: "  ",
      quantity: 1,
      rateCents: 5000,
      costCents: 0,
      position: 0,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("description");
  });

  it("rejects a negative rate", () => {
    const r = JobLine.create({
      id: "l1",
      jobId: JOB,
      description: "Panel swap",
      quantity: 1,
      rateCents: -1,
      costCents: 0,
      position: 0,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("rateCents");
  });

  it("trims description and exposes props on the happy path", () => {
    const r = JobLine.create({
      id: "l1",
      jobId: JOB,
      description: "  Panel swap  ",
      quantity: 2,
      rateCents: 5000,
      costCents: 1000,
      position: 3,
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.description).toBe("Panel swap");
      expect(r.value.props.rate).toBe(5000);
      expect(r.value.props.position).toBe(3);
    }
  });
});

describe("JobAddon", () => {
  it("rejects an unknown status", () => {
    const r = JobAddon.create({
      id: "a1",
      jobId: JOB,
      description: "Extra outlet",
      quantity: 1,
      rateCents: 9000,
      costCents: 0,
      isOptional: false,
      invoiceSkip: false,
      status: "bogus",
      position: 0,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("status");
  });

  it("accepts proposed/approved/declined and preserves invoiceSkip", () => {
    const r = JobAddon.create({
      id: "a1",
      jobId: JOB,
      description: "Extra outlet",
      quantity: 1,
      rateCents: 9000,
      costCents: 0,
      isOptional: true,
      invoiceSkip: true,
      status: "approved",
      position: 0,
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.status).toBe("approved");
      expect(r.value.props.invoiceSkip).toBe(true);
    }
  });
});

describe("JobVerifyAnswer", () => {
  it("requires a reason when state is override", () => {
    const r = JobVerifyAnswer.create({
      jobId: JOB,
      itemId: 7,
      state: "override",
      via: null,
      reason: "  ",
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("reason");
  });

  it("accepts a pass answer with a via and no reason", () => {
    const r = JobVerifyAnswer.create({
      jobId: JOB,
      itemId: 7,
      state: "pass",
      via: "photo",
      reason: null,
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.state).toBe("pass");
      expect(r.value.props.via).toBe("photo");
    }
  });
});

describe("JobPhoto", () => {
  it("rejects an empty storage path", () => {
    const r = JobPhoto.create({
      id: "p1",
      jobId: JOB,
      storagePath: "",
      caption: null,
      verifyPass: false,
      position: 0,
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.field).toBe("storagePath");
  });

  it("accepts a valid path", () => {
    const r = JobPhoto.create({
      id: "p1",
      jobId: JOB,
      storagePath: "org/job/photo.jpg",
      caption: "before",
      verifyPass: true,
      position: 0,
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.storagePath).toBe("org/job/photo.jpg");
  });
});
