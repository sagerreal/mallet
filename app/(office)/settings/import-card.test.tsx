// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportCard } from "./import-card";

const openModal = vi.fn();
vi.mock("@/lib/store/app-store", () => ({ useOpenModal: () => openModal }));

let customerCount: { total: number } | undefined;
let jobCount: { total: number } | undefined;
let serviceNames: { names: string[] } | undefined;
let materialNames: { names: string[] } | undefined;
let companyNames: { names: string[] } | undefined;

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      customers: { count: { useQuery: () => ({ data: customerCount }) } },
      jobs: { count: { useQuery: () => ({ data: jobCount }) } },
      companies: { importNames: { useQuery: () => ({ data: companyNames }) } },
      pricebook: {
        service: { importNames: { useQuery: () => ({ data: serviceNames }) } },
        material: { importNames: { useQuery: () => ({ data: materialNames }) } },
      },
    },
  },
}));

beforeEach(() => {
  openModal.mockClear();
  customerCount = { total: 648 };
  jobCount = { total: 686 };
  serviceNames = { names: ["a", "b", "c"] };
  materialNames = { names: ["p", "q"] };
  companyNames = { names: ["acme"] };
});

describe("ImportCard", () => {
  it("lists every importable entity", () => {
    render(<ImportCard />);
    expect(screen.getByText("Customers")).toBeTruthy();
    expect(screen.getByText("Price book")).toBeTruthy();
    expect(screen.getByText("Materials")).toBeTruthy();
    expect(screen.getByText("Jobs")).toBeTruthy();
  });

  it("shows what the shop already has, so 'did my import work' has an answer", () => {
    render(<ImportCard />);
    expect(screen.getByText("648 on file")).toBeTruthy();
    expect(screen.getByText("3 services")).toBeTruthy();
    expect(screen.getByText("2 materials")).toBeTruthy();
    expect(screen.getByText("686 jobs")).toBeTruthy();
  });

  it("says 'None yet' rather than '0', which reads as a failure", () => {
    customerCount = { total: 0 };
    render(<ImportCard />);
    expect(screen.getByText("None yet")).toBeTruthy();
  });

  it("holds the count back until it loads instead of flashing a wrong zero", () => {
    customerCount = undefined;
    render(<ImportCard />);
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
  });

  it("states the ordering dependency, since getting it wrong creates duplicates", () => {
    render(<ImportCard />);
    expect(screen.getByText(/import customers first/i)).toBeTruthy();
  });

  it("opens the matching modal for each entity", async () => {
    render(<ImportCard />);
    const buttons = screen.getAllByRole("button", { name: "Import" });
    expect(buttons).toHaveLength(5);

    // Order matters: it is the order a shop should import in, so the assertions pin it.
    const expected = [
      "import-customers",
      "import-companies",
      "import-services",
      "import-materials",
      "import-jobs",
    ];
    for (const [i, modal] of expected.entries()) {
      await userEvent.click(buttons[i]!);
      expect(openModal).toHaveBeenCalledWith(modal);
    }
  });
});
