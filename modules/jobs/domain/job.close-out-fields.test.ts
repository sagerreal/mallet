import { describe, it, expect } from "vitest";
import { Job } from "./job";
import { asJobId, asOrgId, asLeadId, money, zeroMoney, isOk } from "@mallet/shared/types";

/**
 * The four fields that had nowhere to go.
 *
 * `addr`, `phone`, `completion` and `invRequested` were accepted by the API and DROPPED — the jobs
 * table had no columns for them, and create-manual-job said so in a comment. The office job
 * modal's Service address row and the close-out sheet's "What was done" therefore edited nothing
 * at all: the value sat in the browser's store until the next jobs.list refetch erased it.
 *
 * The gating rule is the part worth testing. `patchFields` refuses to edit a completed job — but
 * the completion note and the ready-to-bill flag are written AT completion, so a blanket gate
 * would reject exactly the writes they exist for.
 */

const NOW = new Date("2026-08-01T12:00:00Z");

const make = (over: Record<string, unknown> = {}) => {
  const r = Job.create({
    id: asJobId("11111111-1111-4111-8111-111111111111"),
    orgId: asOrgId("22222222-2222-4222-8222-222222222222"),
    num: "JOB-2533",
    leadId: asLeadId("33333333-3333-4333-8333-333333333333"),
    sourceEstimateId: null,
    assigneeUserId: null,
    title: "Slab leak",
    svc: null,
    status: "scheduled",
    scheduledStart: null,
    scheduledEnd: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    cancelReason: null,
    total: zeroMoney,
    notes: null,
    checklist: null,
    signerName: null,
    signatureSvg: null,
    signerIp: null,
    signerUserAgent: null,
    signedAt: null,
    signedSnapshot: null,
    lat: null,
    lng: null,
    visits: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Parameters<typeof Job.create>[0]);
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

describe("a job's own address and phone", () => {
  it("defaults to none — a job normally inherits the customer's", () => {
    expect(make().props.addr).toBeNull();
    expect(make().props.phone).toBeNull();
  });

  it("holds an address that differs from the customer's on file", () => {
    const r = make().patchFields({ addr: "482 Pine St, Unit 3" }, NOW);
    expect(isOk(r) && r.value.props.addr).toBe("482 Pine St, Unit 3");
  });

  // A cleared input arrives as "", and storing that would make every reader special-case it.
  it("treats a cleared field as none rather than an empty string", () => {
    const r = make().patchFields({ addr: "   " }, NOW);
    expect(isOk(r) && r.value.props.addr).toBeNull();
  });
});

describe("close-out fields on a finished job", () => {
  const done = () => make({ status: "complete", completedAt: NOW });

  // THE GATING RULE. These are written at or after the moment a job completes.
  it("accepts the completion note after the job is complete", () => {
    const r = done().patchFields({ completion: "Replaced 40-gal water heater" }, NOW);
    expect(isOk(r) && r.value.props.completion).toBe("Replaced 40-gal water heater");
  });

  it("accepts the ready-to-bill flag after the job is complete", () => {
    const r = done().patchFields({ invRequested: true }, NOW);
    expect(isOk(r) && r.value.props.invRequested).toBe(true);
  });

  // Everything else stays gated: a finished job's scope and address are history, not a draft.
  it("still refuses to re-title a completed job", () => {
    expect(done().patchFields({ title: "Something else" }, NOW).ok).toBe(false);
  });

  it("still refuses to re-address a completed job", () => {
    expect(done().patchFields({ addr: "9 Elsewhere Rd" }, NOW).ok).toBe(false);
  });

  // A mixed patch must not smuggle a gated field in beside an ungated one.
  it("refuses a patch that mixes a gated field with a close-out one", () => {
    expect(done().patchFields({ completion: "done", title: "new" }, NOW).ok).toBe(false);
  });
});

describe("the completion note", () => {
  it("is refused past the column's ceiling rather than truncated by the database", () => {
    expect(make().patchFields({ completion: "x".repeat(2001) }, NOW).ok).toBe(false);
  });

  it("defaults to not-ready-to-bill", () => {
    expect(make().props.invRequested).toBe(false);
  });
});
