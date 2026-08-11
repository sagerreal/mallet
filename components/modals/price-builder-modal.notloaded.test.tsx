// @vitest-environment jsdom
/**
 * The builder can be open on a job whose create is still in flight (the New-job modal's
 * "Create & price it" hands off on the client-authored id without waiting), so a job that
 * fails to persist ROLLS OUT of the store underneath this sheet. `return null` here left a
 * blank white panel with a ✕ — the exact anti-pattern the close-out sheet already fixed.
 * The sheet must say what happened instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceBuilderModalContent } from "./price-builder-modal";
import type { Job } from "@/lib/store/types";

let mockJobs: Job[] = [];
const noop = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "price-builder", params: { jobId: "job-gone" } }),
  useCloseModal: () => noop,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      jobs: mockJobs,
      leads: [],
      services: [],
      laborRates: [],
      taxRate: 0,
      setJobLines: noop,
      updateJob: noop,
    }),
}));

describe("PriceBuilderModalContent — never a blank sheet", () => {
  beforeEach(() => {
    mockJobs = [];
  });

  it("names the problem when the job isn't in the store (rolled back / never loaded)", () => {
    render(<PriceBuilderModalContent />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/isn.t loaded/i)).toBeTruthy();
    // The sheet still says which sheet it is.
    expect(screen.getByText("Build the price")).toBeTruthy();
  });
});
