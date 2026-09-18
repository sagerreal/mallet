// @vitest-environment jsdom
/**
 * THE JOB SHEET CARRIES THE NUMBER.
 *
 * It had Call and Text buttons but never showed the phone, so the one fact you need to do either
 * was invisible — and with no number on file there was no way to add one without leaving the job
 * for the customer record and coming back.
 *
 * Phone, Email and Service address were three sibling rows, each with its own chevron. They are
 * now laid out FLAT inside one collapsed "Contact" chapter, so the facts you check fold into a
 * single line and the sheet opens on the job itself. Everything below still pins the same two
 * things: the number is readable WITHOUT opening anything, and a missing one can be typed in
 * place without leaving the job.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const updateLead = vi.fn();
const pushModal = vi.fn();

interface Store {
  jobs: unknown[];
  leads: unknown[];
  invoices: unknown[];
  techs: unknown[];
  updateJob: () => void;
  updateLead: (id: string, patch: unknown) => void;
}
let store: Store;

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Store) => unknown) => sel(store),
  useActiveModal: () => ({ id: "JOB", params: { jobId: "job-1" } }),
  useCloseModal: () => vi.fn(),
  usePushModal: () => pushModal,
  useOpenModal: () => vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { invoicing: { list: { invalidate: vi.fn() } } } }),
    v1: {
      links: {
        forRecord: {
          useQuery: () => ({
            data: {
              customer: { id: "lead-1", name: "Cole Hayes" },
              quotes: [], jobs: [], invoices: [],
              counts: { quotes: 0, jobs: 0, invoices: 0 }, cap: 6,
            },
          }),
        },
      },
      jobs: { get: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) } },
      invoicing: { createFromJob: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
      customers: { listNotes: { useQuery: () => ({ data: undefined, isFetched: true }) } },
    },
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { JobModalContent } from "./job-modal";

const JOB = {
  id: "job-1",
  leadId: "lead-1",
  title: "Flat rate job test",
  cust: "Cole Hayes",
  addr: "493 San Ramon Valley Blvd",
  status: "scheduled",
  kind: "work",
  svc: "service",
  lines: [],
  visits: [],
  photos: [],
};

const seed = (
  leadPatch: Record<string, unknown> = {},
  jobPatch: Record<string, unknown> = {},
) => {
  store = {
    jobs: [{ ...JOB, ...jobPatch }],
    leads: [{ id: "lead-1", name: "Cole Hayes", stage: "Quoted", ...leadPatch }],
    invoices: [],
    techs: [],
    updateJob: vi.fn(),
    updateLead,
  };
};

/** The chapter head — one button carrying its own label and its collapsed summary. */
const chapter = (label: RegExp) => screen.getByRole("button", { name: label });

describe("job sheet — the Contact chapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  it("shows the customer's number without opening anything", () => {
    seed({ phone: "+14155550123" });
    render(<JobModalContent />);
    const contact = chapter(/^Contact/);
    // Nothing has been opened: the chapter is shut and the number is on its collapsed line.
    expect(contact.getAttribute("aria-expanded")).toBe("false");
    expect(contact.textContent).toMatch(/\(415\) 555-0123/);
  });

  /**
   * "Add" means the chapter is genuinely bare. Contact is no longer the phone alone — it holds the
   * email and the service address too — so the head says Add only when there is nothing in any of
   * them. With something on file it names that thing instead (the two tests below).
   */
  it("says Add when there is no way to reach them and no address either", () => {
    seed({ phone: "", email: "" }, { addr: "" });
    render(<JobModalContent />);
    expect(chapter(/^Contact/).textContent).toMatch(/Add/);
  });

  it("carries the email too", () => {
    seed({ email: "cole@example.com" });
    render(<JobModalContent />);
    expect(chapter(/^Contact/).textContent).toContain("cole@example.com");
  });

  // With neither number nor email the address is still worth a line — it is the one contact fact
  // that belongs to the JOB rather than the customer, and it is why the head is not saying Add.
  it("falls back to the service address when that is all the job has", () => {
    seed({ phone: "", email: "" });
    render(<JobModalContent />);
    expect(chapter(/^Contact/).textContent).toContain("493 San Ramon Valley Blvd");
  });

  /**
   * NO SECOND LAYER OF CHEVRONS. Phone, Email and Service address were three sibling rows each
   * with its own chevron, so reaching the keyboard cost two opens. Opening the chapter IS the
   * request to see inside it: the three fields are laid out flat, none of them a row to open.
   */
  it("lays Phone, Email and Service address out flat once Contact is open", () => {
    seed({ phone: "+14155550123", email: "cole@example.com" });
    render(<JobModalContent />);
    expect(screen.queryByLabelText("Phone")).toBeNull();

    fireEvent.click(chapter(/^Contact/));

    expect(screen.getByLabelText("Phone")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Service address")).toBeTruthy();
    for (const field of [/^Phone/, /^Email/, /^Service address/]) {
      expect(screen.queryByRole("button", { name: field })).toBeNull();
    }
  });

  // Call with no number used to stack a sheet whose whole job was one field — and it is titled
  // with the customer's name, so it reads as having started something else. It opens the Contact
  // chapter instead, where the empty Phone field is typed IN PLACE: no second row underneath.
  it("Call with no number opens Contact onto an empty Phone field, not a second sheet", () => {
    seed({ phone: "" });
    render(<JobModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(pushModal).not.toHaveBeenCalled();
    expect(chapter(/^Contact/).getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe("");
  });

  it("Text with no number does the same", () => {
    seed({ phone: "" });
    render(<JobModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(pushModal).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe("");
  });

  it("Call WITH a number still opens the call sheet", () => {
    seed({ phone: "+14155550123" });
    render(<JobModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(pushModal).toHaveBeenCalled();
  });
});
