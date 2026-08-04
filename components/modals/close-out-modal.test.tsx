// @vitest-environment jsdom
/**
 * components/modals/close-out-modal.test.tsx
 * BillAsk's "+ Service / diagnostic fee" chip (presetFee) used to hardcode the amount "89".
 * Task 5: it reads the org's real visit fee (passed down as `serviceFee`, read outside the
 * store on this surface — see features/settings/use-org-service-fee.ts, since the close-out
 * modal's only entry, the tech job modal, lives in the field shell) and falls back to 89 only
 * when the org fee genuinely isn't loaded/set.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BillAsk } from "./close-out-modal";
import type { Job } from "@/lib/store/types";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    leadId: "lead-1",
    svc: "estimate",
    origin: "db",
    title: "Fix water heater",
    addr: "12 Oak St",
    phone: "",
    status: "done",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...overrides,
  };
}

describe("BillAsk — presetFee reads the org's real visit fee", () => {
  it("uses serviceFee 129 as the preset amount", () => {
    render(<BillAsk job={makeJob()} suggested={200} onCommit={vi.fn()} serviceFee={129} />);
    fireEvent.click(screen.getByText("Itemize"));
    fireEvent.click(screen.getByText("+ Service / diagnostic fee"));
    expect((screen.getByPlaceholderText("fee or part description") as HTMLInputElement).value).toBe(
      "Service / diagnostic call",
    );
    expect((screen.getByPlaceholderText("$") as HTMLInputElement).value).toBe("129");
  });

  it("falls back to 89 when serviceFee is 0 (org configured no fee / not genuinely set)", () => {
    render(<BillAsk job={makeJob()} suggested={200} onCommit={vi.fn()} serviceFee={0} />);
    fireEvent.click(screen.getByText("Itemize"));
    fireEvent.click(screen.getByText("+ Service / diagnostic fee"));
    expect((screen.getByPlaceholderText("$") as HTMLInputElement).value).toBe("89");
  });

  it("falls back to 89 when serviceFee is null (not loaded yet)", () => {
    render(<BillAsk job={makeJob()} suggested={200} onCommit={vi.fn()} serviceFee={null} />);
    fireEvent.click(screen.getByText("Itemize"));
    fireEvent.click(screen.getByText("+ Service / diagnostic fee"));
    expect((screen.getByPlaceholderText("$") as HTMLInputElement).value).toBe("89");
  });

  it("does not overwrite an amount the user already typed", () => {
    render(<BillAsk job={makeJob()} suggested={200} onCommit={vi.fn()} serviceFee={129} />);
    fireEvent.click(screen.getByText("Itemize"));
    fireEvent.change(screen.getByPlaceholderText("$"), { target: { value: "50" } });
    fireEvent.click(screen.getByText("+ Service / diagnostic fee"));
    expect((screen.getByPlaceholderText("$") as HTMLInputElement).value).toBe("50");
  });
});
