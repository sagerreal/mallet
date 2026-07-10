// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { BrandHydrator } from "./brand-hydrator";

const setBrand = vi.fn();
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { setBrand: typeof setBrand }) => unknown) => sel({ setBrand }),
}));

const getQuery = vi.fn();
const meQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      settings: { get: { useQuery: () => getQuery() } },
      identity: { me: { useQuery: () => meQuery() } },
    },
  },
}));

describe("BrandHydrator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes brand to the store when both queries resolve", () => {
    getQuery.mockReturnValue({
      data: { brand: { name: "ignored", tagline: "Licensed", site: "r.com", color: "#9C5B34", logoUrl: null, initials: "RP" } },
      isError: false, error: null,
    });
    meQuery.mockReturnValue({ data: { orgName: "Rivera Plumbing" }, isError: false, error: null });

    render(<BrandHydrator />);

    expect(setBrand).toHaveBeenCalledWith({
      name: "Rivera Plumbing", // from me.orgName, not settings.brand.name
      tagline: "Licensed",
      site: "r.com",
      color: "#9C5B34",
      initials: "RP",
      logoUrl: undefined,
    });
  });

  it("does not write until both queries have data", () => {
    getQuery.mockReturnValue({ data: undefined, isError: false, error: null });
    meQuery.mockReturnValue({ data: { orgName: "X" }, isError: false, error: null });
    render(<BrandHydrator />);
    expect(setBrand).not.toHaveBeenCalled();
  });

  it("does not throw on query error", () => {
    getQuery.mockReturnValue({ data: undefined, isError: true, error: new Error("boom") });
    meQuery.mockReturnValue({ data: undefined, isError: true, error: new Error("boom") });
    expect(() => render(<BrandHydrator />)).not.toThrow();
    expect(setBrand).not.toHaveBeenCalled();
  });
});
