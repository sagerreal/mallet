// @vitest-environment jsdom
/**
 * The signed record on the Quote tab. What matters: the evidence renders from whichever
 * record holds it (job first, then the source estimate), collapsed to one line until
 * asked; with no record in hand the OFFICE gets the pointer to the quote sheet — worded
 * by the `signed` flag so an unsigned (verbal) acceptance is never called signed — and a
 * technician gets no dead link to an office sheet their shell cannot load.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SignedRecordRow } from "./signed-record-row";
import type { EstimateSignature, Estimate, Job } from "@/lib/store/types";

let mockEstimates: Estimate[] = [];
let mockRole = "owner";
const pushModal = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { estimates: Estimate[] }) => unknown) => sel({ estimates: mockEstimates }),
  usePushModal: () => pushModal,
}));
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: { role: mockRole } }),
}));

const signature: EstimateSignature = {
  signerName: "Dana Alvarez",
  signatureSvg: null,
  signerIp: null,
  signerUserAgent: null,
  signedAt: "2026-08-12T15:04:00.000Z",
  snapshot: {
    estimateNum: "EST-101",
    totalCents: 20_000,
    depositCents: 0,
    chosenTier: null,
    authorizationText: "I approve the work listed above for $200.00.",
    lines: [{ description: "work work work", quantity: 1, rateCents: 20_000 }],
  },
} as EstimateSignature;

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "job-1",
    leadId: "lead-1",
    svc: "service",
    kind: "work",
    origin: "db",
    sourceEstimateId: "est-1",
    title: "work work work",
    addr: "",
    phone: "",
    status: "scheduled",
    archived: false,
    lines: [{ d: "work work work", q: 1, r: 200 }],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...over,
  }) as unknown as Job;

beforeEach(() => {
  mockEstimates = [];
  mockRole = "owner";
  pushModal.mockClear();
});

describe("SignedRecordRow", () => {
  it("renders the job's own signature as a one-line row that expands to the full record", () => {
    render(<SignedRecordRow job={job({ signature })} />);
    expect(screen.getByText(/Dana Alvarez · Aug 12/)).toBeTruthy();
    // Collapsed: no evidence body yet.
    expect(screen.queryByText("Signed by the customer")).toBeNull();

    fireEvent.click(screen.getByText("Signed"));
    expect(screen.getByText("Signed by the customer")).toBeTruthy();
    // The frozen snapshot, not the live rows.
    expect(screen.getByText("I approve the work listed above for $200.00.")).toBeTruthy();
    expect(screen.getByText("EST-101")).toBeTruthy();
  });

  it("falls back to the source estimate's signature when the job carries none", () => {
    mockEstimates = [{ id: "est-1", signature } as unknown as Estimate];
    render(<SignedRecordRow job={job()} />);
    expect(screen.getByText(/Dana Alvarez · Aug 12/)).toBeTruthy();
  });

  it("with no record in hand: the OFFICE gets the pointer to the quote sheet", () => {
    render(<SignedRecordRow job={job()} />);
    fireEvent.click(screen.getByText("The signed quote is on file"));
    expect(pushModal).toHaveBeenCalledWith("est", { estId: "est-1" });
  });

  it("never calls a verbal acceptance signed — the signed flag words the pointer", () => {
    mockEstimates = [{ id: "est-1", signed: false } as unknown as Estimate];
    render(<SignedRecordRow job={job()} />);
    expect(screen.getByText("Sold from a quote")).toBeTruthy();
    expect(screen.queryByText(/signed quote is on file/)).toBeNull();
  });

  it("a technician gets no dead link to the office quote sheet", () => {
    mockRole = "tech";
    const { container } = render(<SignedRecordRow job={job()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing on a job with neither signature nor source quote (booked, unsigned)", () => {
    const { container } = render(
      <SignedRecordRow job={job({ sourceEstimateId: null })} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
