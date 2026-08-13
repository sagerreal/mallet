// @vitest-environment jsdom
/**
 * components/modals/job-modal.foot.test.tsx
 * The job sheet's two-button foot follows the #362 grammar: `.sheet-pri` is
 * width:100% at the CLASS level (right for a foot it has to itself), so beside
 * the quiet Delete button it must take `flex: 1, width: "auto"` — otherwise the
 * flex line is over-constrained and the primary crushes into / overlaps its
 * sibling once anything (font scale, zoom, armed label) grows the shrink floor.
 * Store/trpc harness mirrors job-modal.assign.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

interface Store {
  jobs: unknown[];
  leads: unknown[];
  techs: { id: string; name: string; skills?: string[] }[];
  invoices: unknown[];
  estimates: unknown[];
  checklists: unknown[];
  settings: Record<string, unknown>;
  roomsByJob: Record<string, unknown[]>;
  sitesByJob: Record<string, unknown[]>;
  toggles: Record<string, boolean>;
}
let store: Store;

const job = () => ({
  id: "job-1",
  num: "J-1",
  leadId: "lead-1",
  title: "Hydro-jetting — main sewer",
  status: "scheduled",
  visits: [{ id: "v1", date: "2026-08-03", techId: "t1", start: 9, dur: 2, status: "scheduled" }],
  lines: [{ d: "Hydro-jetting", q: 1, r: 685 }],
  addons: [],
  archived: false,
  origin: "db",
});

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      ...store,
      updateVisit: vi.fn(),
      addVisit: vi.fn(),
      removeVisit: vi.fn(),
      updateJob: vi.fn(),
      deleteJob: vi.fn(),
      adoptJob: vi.fn(),
      setJobLines: vi.fn(),
    }),
  useActiveModal: () => ({ id: "JOB", params: { jobId: "job-1" } }),
  useCloseModal: () => vi.fn(),
  usePushModal: () => vi.fn(),
  useOpenModal: () => vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { jobs: { list: { invalidate: vi.fn() } } } }),
    v1: {
      // The sheet header's record trail. Undefined data renders nothing, which is what these tests
      // want — they are about the sheet's own body, not the chain.
      links: { forRecord: { useQuery: () => ({ data: undefined }) } },
      jobs: { get: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) } },
      invoicing: { createFromJob: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
      // The customer's note trail behind the Customer notes row — idle here.
      customers: { listNotes: { useQuery: () => ({ data: undefined }) } },
    },
  },
}));

import { JobModalContent } from "./job-modal";

describe("JobModalContent — two-button sheet foot (#362)", () => {
  beforeEach(() => {
    store = {
      jobs: [job()],
      leads: [{ id: "lead-1", name: "Sam Ortiz", phone: "+19255550099", archived: false }],
      techs: [{ id: "t1", name: "Rosa Boyd", skills: [] }],
      invoices: [],
      estimates: [],
      checklists: [],
      settings: {},
      roomsByJob: {},
      sitesByJob: {},
      toggles: { measurementEstimating: false },
    };
    vi.clearAllMocks();
  });

  it("Delete keeps its intrinsic width and the Done primary takes the remaining space", () => {
    render(<JobModalContent />);
    const quiet = document.querySelector<HTMLButtonElement>(".sheet-foot .btn.ghost");
    const pri = document.querySelector<HTMLButtonElement>(".sheet-foot .sheet-pri");
    expect(quiet).toBeTruthy();
    expect(pri).toBeTruthy();
    expect(quiet?.style.flexShrink).toBe("0");
    expect(quiet?.style.minHeight).toBe("44px");
    expect(pri?.style.flexGrow).toBe("1");
    expect(pri?.style.width).toBe("auto");
  });
});
