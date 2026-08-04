// @vitest-environment jsdom
/**
 * The technician's own settings read. Its whole reason to exist is that store.toggles was
 * unreachable for a tech — v1.settings.get is ownerOrOffice — so the field Quote tab's scan row
 * could never render for the role the field scanner was built for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { FieldTogglesHydrator } from "./field-toggles-hydrator";

const setMeasurementGate = vi.fn();
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { setMeasurementGate: typeof setMeasurementGate }) => unknown) =>
    sel({ setMeasurementGate }),
}));

const fieldTogglesQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { settings: { fieldToggles: { useQuery: () => fieldTogglesQuery() } } } },
}));

describe("FieldTogglesHydrator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lands an ON answer on the store", () => {
    fieldTogglesQuery.mockReturnValue({
      data: { measurementEstimating: true },
      isError: false,
      error: null,
    });
    render(<FieldTogglesHydrator />);
    expect(setMeasurementGate).toHaveBeenCalledWith("on");
  });

  it("lands an OFF answer on the store — a real answer is allowed to hide the surfaces", () => {
    fieldTogglesQuery.mockReturnValue({
      data: { measurementEstimating: false },
      isError: false,
      error: null,
    });
    render(<FieldTogglesHydrator />);
    expect(setMeasurementGate).toHaveBeenCalledWith("off");
  });

  it("writes NOTHING while the read is in flight — the gate stays unknown", () => {
    fieldTogglesQuery.mockReturnValue({ data: undefined, isError: false, error: null });
    render(<FieldTogglesHydrator />);
    expect(setMeasurementGate).not.toHaveBeenCalled();
  });

  /**
   * The fail-open contract. A dead read must not be reported as "off" — leaving the gate at
   * `"unknown"` is what keeps the scanner on screen (disabled with its reason if it truly cannot
   * run) instead of silently deleting it.
   */
  it("writes NOTHING on a failed read — never 'off'", () => {
    fieldTogglesQuery.mockReturnValue({ data: undefined, isError: true, error: new Error("500") });
    expect(() => render(<FieldTogglesHydrator />)).not.toThrow();
    expect(setMeasurementGate).not.toHaveBeenCalled();
  });

  it("keeps a good answer when a later refetch fails — stale beats unknown", () => {
    fieldTogglesQuery.mockReturnValue({
      data: { measurementEstimating: true },
      isError: true,
      error: new Error("refetch died"),
    });
    render(<FieldTogglesHydrator />);
    // isError short-circuits before the write, so whatever the store already holds survives.
    expect(setMeasurementGate).not.toHaveBeenCalled();
  });
});
