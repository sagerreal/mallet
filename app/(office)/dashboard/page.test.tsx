// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/** Only what the page actually selects: the tab counts, the Front Desk dot, and the shift report. */
interface Store {
  toggles: { frontDesk: boolean };
  services: unknown[];
  checklists: unknown[];
  leads: unknown[]; estimates: unknown[]; jobs: unknown[];
}
let storeState: Store;

/** What useWorkBoard reports — the states the Today pane branches on, plus the per-column counts
 *  the first-run verdict is summed from. */
let boardState: {
  columns: { id: string; count: number }[];
  needsYou: { count: number; valueDollars: number; textsReady: number };
  wonCount: number;
  isFetched: boolean;
  isError: boolean;
};

/** Four columns with `n` open items between them — the only board fact first-run reads. */
const columnsHolding = (n: number) => [
  { id: "requests", count: n }, { id: "quoting", count: 0 },
  { id: "jobs", count: 0 }, { id: "billing", count: 0 },
];

const openModal = vi.fn();
/** The pane's own card→modal mapping, captured off the board it hands it to. */
let onOpen: (item: {
  kind: string;
  refId: string;
  leadId?: string;
  scopeVisitJobId?: string;
  [k: string]: unknown;
}) => void;
/** Whether the pane told the board it is a brand-new shop. */
let boardFirstRun: boolean | undefined;
/** What the pane tells the hero — `loading` above all, which must never disagree with the board. */
let handoff: { queueCount: number; queueValue: number; textsReady?: number; loading?: boolean };

// The scoped "quote it ›" card routes to the composer — the page holds a router now.
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(storeState),
  useOpenModal: () => openModal,
}));
/** Mutable so a shop whose owner never filled in a name can be asserted, not assumed. */
let meData: { orgName: string; name?: string; email?: string };
vi.mock("@/features/identity/hooks", () => ({ useMe: () => ({ data: meData }) }));
vi.mock("@/features/home/derive", () => ({ deriveShiftReport: () => ({}) }));
// Kept as a stub, but one that reports its own gate: the testid says which branch the REAL
// component would take, so "the hero is loading" is asserted rather than assumed.
vi.mock("@/features/home/handoff-note", () => ({
  HandoffNote: (props: typeof handoff) => {
    handoff = props;
    return <div data-testid={props.loading ? "handoff-loading" : "handoff"} />;
  },
}));
// The pane's only remaining tRPC use is the retry's cache invalidation — these tests are about
// the tab shell, so it's a no-op.
vi.mock("@/lib/trpc/client", () => ({
  api: { useUtils: () => ({ v1: { invalidate: () => Promise.resolve() } }) },
}));
// Today is the board now. Stubbed at the hook + component seam: what those render is covered by
// features/board's own tests, and these tests are about the tab shell.
vi.mock("@/features/board/use-work-board", () => ({
  useWorkBoard: () => boardState,
}));
vi.mock("@/features/board/work-board", () => ({
  WorkBoard: (props: { onOpen: typeof onOpen; firstRun: boolean }) => {
    onOpen = props.onOpen;
    boardFirstRun = props.firstRun;
    return <div data-testid="board" />;
  },
  WorkBoardSkeleton: () => <div data-testid="board-skeleton" />,
}));
vi.mock("@/features/office/front-desk-pane", () => ({ FrontDeskPane: () => <div data-testid="fd-pane" /> }));
vi.mock("@/features/office/pricebook-pane", () => ({ PricebookPane: () => <div data-testid="pb-pane" /> }));
vi.mock("@/features/jobs/checklists-panel", () => ({ ChecklistsPanel: () => <div data-testid="cl-pane" /> }));

import OfficePage from "./page";

describe("Office page — one tab bar, four panes", () => {
  beforeEach(() => {
    meData = { orgName: "Rivera Plumbing", name: "Owen D", email: "o@x.com" };
    storeState = {
      toggles: { frontDesk: true }, services: [{ id: "s1" }], checklists: [],
      leads: [], estimates: [], jobs: [],
    };
    // The default board is a WORKING shop with rows — first-run is the exception, asserted below.
    boardState = { columns: columnsHolding(3), needsYou: { count: 0, valueDollars: 0, textsReady: 0 }, wonCount: 0, isFetched: true, isError: false };
    boardFirstRun = undefined;
    openModal.mockClear();
    window.history.replaceState(null, "", "/dashboard");
  });

  it("lands on Today with all four tabs visible (counts on Pricebook, none on empty Checklists)", () => {
    render(<OfficePage />);
    expect(screen.getByTestId("handoff")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Today" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Front Desk/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Pricebook 1/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Checklists" })).toBeTruthy();
  });

  it("carries otabs-page, the modifier that makes the bar visible at all", () => {
    // A shop owner opened this page and never saw the tab row: the labels were 13px — smaller than
    // the body copy under them — 40px above a 64px hero. `otabs-page` is the whole fix (17px labels
    // on desktop, wrapping at body size on a phone) and `.otabs` alone silently restores the bar
    // nobody could see. Pinned here because nothing else would notice it being dropped.
    render(<OfficePage />);
    const bar = screen.getByRole("tablist", { name: "Office" });
    expect(bar.className.split(/\s+/)).toContain("otabs-page");
  });

  it("tabbing over swaps the pane in place — no navigation", async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByRole("tab", { name: /Front Desk/ }));
    // Panes are code-split (next/dynamic) — resolution is async, so find*.
    expect(await screen.findByTestId("fd-pane")).toBeTruthy();
    expect(screen.queryByTestId("handoff")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Pricebook/ }));
    expect(await screen.findByTestId("pb-pane")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Checklists" }));
    expect(await screen.findByTestId("cl-pane")).toBeTruthy();
  });

  it("deep-links: ?tab=pricebook opens the Pricebook pane directly", async () => {
    window.history.replaceState(null, "", "/dashboard?tab=pricebook");
    render(<OfficePage />);
    expect(await screen.findByTestId("pb-pane")).toBeTruthy();
    expect(screen.queryByTestId("handoff")).toBeNull();
  });

  it("Today is the board: a settled read renders it under the handoff note", () => {
    render(<OfficePage />);
    expect(screen.getByTestId("board")).toBeTruthy();
    expect(screen.queryByTestId("board-skeleton")).toBeNull();
  });

  it("first read in flight → the board's own skeleton, never an empty four-column board", () => {
    boardState = { ...boardState, isFetched: false };
    render(<OfficePage />);
    expect(screen.getByTestId("board-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("board")).toBeNull();
  });

  // The whole point of a card: it opens the record it IS. A kind wired to the wrong modal sends the
  // owner to somebody else's record, and only one of the four kinds has rows in the E2E fixture.
  it.each([
    ["lead", "lead", { leadId: "L1" }],
    ["estimate", "est", { estId: "L1" }],
    ["job", "job", { jobId: "L1" }],
    ["invoice", "invoice", { invoiceId: "L1" }],
  ])("a %s card opens the %s modal with its own id", (kind, modalId, payload) => {
    render(<OfficePage />);
    onOpen({ kind, refId: "L1" });
    expect(openModal).toHaveBeenCalledWith(modalId, payload);
  });

  it("errored with nothing cached → LoadFailed with a retry, never four empty columns", () => {
    boardState = { ...boardState, isFetched: false, isError: true };
    render(<OfficePage />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByTestId("board")).toBeNull();
    expect(screen.queryByTestId("board-skeleton")).toBeNull();
  });

  // A SETTLED failure reports isFetched AND isError together, with zeros in `needsYou`. Gating the
  // hero on `!isFetched` alone let it drop its skeleton and print "Nothing's waiting on you. Go run
  // the day." immediately above "Couldn't load your board." — the app contradicting itself, most
  // confidently in the sentence that was wrong.
  it("a SETTLED error keeps the hero loading — no zero-state above the load-failed panel", () => {
    boardState = { columns: columnsHolding(0), needsYou: { count: 0, valueDollars: 0, textsReady: 0 }, wonCount: 0, isFetched: true, isError: true };
    render(<OfficePage />);
    expect(handoff.loading).toBe(true);
    expect(screen.getByTestId("handoff-loading")).toBeTruthy();
    expect(screen.queryByTestId("handoff")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("a settled, healthy board hands the hero its own figures and stops loading", () => {
    boardState = { columns: columnsHolding(35), needsYou: { count: 35, valueDollars: 5310, textsReady: 6 }, wonCount: 0, isFetched: true, isError: false };
    render(<OfficePage />);
    expect(handoff).toMatchObject({ queueCount: 35, queueValue: 5310, textsReady: 6, loading: false });
  });
});

/**
 * THE BRAND-NEW SHOP. A handoff note over an empty board says "Nothing's waiting on you" to
 * somebody who has never had anything waiting — a true sentence that teaches nothing. So when
 * every source has been read, none failed, and the four columns hold zero between them, the note
 * is REPLACED by the setup brief: three ways in, each one wired to something that actually opens.
 */
describe("Office Today — the first-run setup brief", () => {
  beforeEach(() => {
    storeState = {
      toggles: { frontDesk: false }, services: [], checklists: [],
      leads: [], estimates: [], jobs: [],
    };
    meData = { orgName: "Rivera Plumbing", name: "Owen D", email: "o@x.com" };
    boardState = { columns: columnsHolding(0), needsYou: { count: 0, valueDollars: 0, textsReady: 0 }, wonCount: 0, isFetched: true, isError: false };
    boardFirstRun = undefined;
    openModal.mockClear();
    window.history.replaceState(null, "", "/dashboard");
  });

  it("replaces the handoff note with the brief, and greets the owner by name", () => {
    render(<OfficePage />);
    expect(screen.queryByTestId("handoff")).toBeNull();
    expect(screen.queryByTestId("handoff-loading")).toBeNull();
    expect(screen.getByRole("heading", { name: "Welcome, Owen." })).toBeTruthy();
    expect(screen.getByText(/board fills itself as work comes in/i)).toBeTruthy();
  });

  // A blank name is a VALUE, so `??` kept it and the very first screen of the product read
  // "Welcome, ." — the brief greets a brand-new shop, which is exactly where the field is empty.
  it("falls through a blank name to the email handle — never 'Welcome, .'", () => {
    meData = { orgName: "Rivera Plumbing", name: "", email: "dana@riveraplumbing.com" };
    render(<OfficePage />);
    expect(screen.getByRole("heading", { name: "Welcome, dana." })).toBeTruthy();
  });

  it("falls all the way through to 'there' when there is no name and no email", () => {
    meData = { orgName: "Rivera Plumbing", name: "   ", email: "" };
    render(<OfficePage />);
    expect(screen.getByRole("heading", { name: "Welcome, there." })).toBeTruthy();
  });

  it("keeps the board — it is the columns, drawn — and tells it that it is first-run", () => {
    render(<OfficePage />);
    expect(screen.getByTestId("board")).toBeTruthy();
    expect(boardFirstRun).toBe(true);
  });

  it("no dollar figure reaches a shop that has never billed anyone", () => {
    const { container } = render(<OfficePage />);
    expect(container.textContent).not.toContain("$");
  });

  it("Import opens the customer import", () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(openModal).toHaveBeenCalledWith("import-customers");
  });

  it("Add job opens the new-job modal", () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByRole("button", { name: "Add job" }));
    expect(openModal).toHaveBeenCalledWith("new-job");
  });

  it("Set up switches to the Front Desk tab rather than opening a modal", async () => {
    render(<OfficePage />);
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(await screen.findByTestId("fd-pane")).toBeTruthy();
    expect(openModal).not.toHaveBeenCalled();
  });

  it("a shop with ONE open item gets its board, not the brief", () => {
    boardState = { ...boardState, columns: columnsHolding(1) };
    render(<OfficePage />);
    expect(screen.getByTestId("handoff")).toBeTruthy();
    expect(boardFirstRun).toBe(false);
    expect(screen.queryByRole("heading", { name: /^Welcome,/ })).toBeNull();
  });

  it("a board still loading shows the skeleton, never a flash of the brief", () => {
    boardState = { ...boardState, isFetched: false };
    render(<OfficePage />);
    expect(screen.getByTestId("board-skeleton")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Welcome,/ })).toBeNull();
  });

  it("a board that FAILED shows the failure — an empty read is not the same as no work", () => {
    boardState = { ...boardState, isError: true };
    render(<OfficePage />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByTestId("board")).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Welcome,/ })).toBeNull();
  });

  it("totalOpen 0 + wonCount 0 → first-run (brand-new shop)", () => {
    boardState = { ...boardState, columns: columnsHolding(0), wonCount: 0 };
    render(<OfficePage />);
    expect(boardFirstRun).toBe(true);
    expect(screen.getByRole("heading", { name: /^Welcome,/ })).toBeTruthy();
  });

  it("totalOpen 0 + wonCount > 0 → NOT first-run (established shop, cleared board)", () => {
    boardState = { ...boardState, columns: columnsHolding(0), wonCount: 5 };
    render(<OfficePage />);
    expect(boardFirstRun).toBe(false);
    expect(screen.getByTestId("handoff")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Welcome,/ })).toBeNull();
  });
});

/**
 * WHERE A CARD OPENS. A scoped walkthrough's card says "quote it" — so it opens the QUOTE: the
 * composer, carrying the walkthrough job (?lead=&job=) so the From-the-site card reads the scope
 * and accept CONVERTS that job instead of minting a twin. Every other lead-kind card still opens
 * the customer sheet — there is nothing to quote yet.
 */
describe("Office Today — where a board card opens", () => {
  beforeEach(() => {
    meData = { orgName: "Rivera Plumbing", name: "Owen D", email: "o@x.com" };
    storeState = {
      toggles: { frontDesk: true }, services: [], checklists: [],
      leads: [], estimates: [], jobs: [],
    };
    boardState = { columns: columnsHolding(3), needsYou: { count: 0, valueDollars: 0, textsReady: 0 }, wonCount: 0, isFetched: true, isError: false };
    openModal.mockClear();
    routerPush.mockClear();
    window.history.replaceState(null, "", "/dashboard");
  });

  const baseItem = {
    key: "bl-l1", column: "quoting" as const, refId: "l1", leadId: "l1", name: "Dana",
    service: "Repipe", valueDollars: 0, stateLabel: "Needs quote", tone: "attention" as const,
    needsAction: true, ageLabel: "scoped today",
  };

  it("a SCOPED card routes to the composer with the walkthrough job", () => {
    render(<OfficePage />);
    onOpen({ ...baseItem, kind: "lead", scopeVisitJobId: "job-9" });

    expect(routerPush).toHaveBeenCalledWith("/composer?lead=l1&job=job-9");
    expect(openModal).not.toHaveBeenCalledWith("lead", expect.anything());
  });

  it("a plain lead card still opens the customer sheet", () => {
    render(<OfficePage />);
    onOpen({ ...baseItem, kind: "lead", stateLabel: "Walkthrough booked", needsAction: false });

    expect(openModal).toHaveBeenCalledWith("lead", { leadId: "l1" });
    expect(routerPush).not.toHaveBeenCalled();
  });
});
