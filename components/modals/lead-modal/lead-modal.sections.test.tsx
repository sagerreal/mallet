// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The customer sheet's chapters.
 *
 * Contact and Work were plain grey captions (`.sheet-worklab`) that owned nothing: every row
 * under them was its own accordion, so eight rows of identical weight sat on the sheet, six of
 * them reading "Add", and the two labels collapsed nothing. The grouping was a caption, not a
 * structure.
 *
 * They are now real sections — SheetRow's existing `variant="section"` — so a chapter opens and
 * closes as a unit and a customer with no work costs two lines instead of six.
 *
 * The trap these tests exist for: the docked primary "Add phone" opens the PHONE row, which now
 * lives inside a section. Open the row without opening its section and the button does nothing
 * you can see.
 */

interface StoreShape {
  leads: Record<string, unknown>[];
  adoptLead: (lead: unknown) => void;
  updateLead: (id: string, patch: unknown) => void;
  estimates: unknown[];
  companies: unknown[];
  tasks: unknown[];
  jobs: unknown[];
  techs: unknown[];
}

let store: StoreShape;
let leadQuery: { data: unknown; isLoading: boolean; isError: boolean };

const pushModal = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: StoreShape) => unknown) => sel(store),
  useActiveModal: () => ({ id: "LEAD", params: { leadId: "lead-1" } }),
  useCloseModal: () => vi.fn(),
  usePushModal: () => pushModal,
  useOpenModal: () => vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      links: { forRecord: { useQuery: () => ({ data: undefined }) } },
      customers: {
        // The sheet's "Pipeline stage" row gates on this; empty = the row never renders.
        pipeline: { board: { useQuery: () => ({ data: undefined }) } },
        get: { useQuery: () => leadQuery },
        listNotes: { useQuery: () => ({ data: undefined, isFetched: true }) },
      },
      quoting: { listByLead: { useQuery: () => ({ data: undefined, isFetched: true }) } },
      tasks: { list: { useQuery: () => ({ data: undefined, isFetched: true }) } },
    },
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { LeadModal } from "./lead-modal";

const seed = (over: Record<string, unknown> = {}) => {
  store = {
    leads: [{
      id: "lead-1", name: "Marta Feldkamp", phone: "", stage: "New customer",
      archived: false, value: 0, unread: false, age: 1, source: "", job: "", address: "",
      email: "", ...over,
    }],
    adoptLead: vi.fn(), updateLead: vi.fn(),
    estimates: [], companies: [], tasks: [], jobs: [], techs: [],
  };
  leadQuery = { data: undefined, isLoading: false, isError: false };
};

const section = (name: RegExp) => screen.getByRole("button", { name });

describe("the customer sheet's chapters", () => {
  beforeEach(() => { vi.clearAllMocks(); seed(); });

  it("draws Contact and Work as sections that collapse, not as captions", () => {
    render(<LeadModal open />);
    // aria-expanded is what makes it a disclosure rather than a label.
    expect(section(/^Contact/).getAttribute("aria-expanded")).toBeTruthy();
    expect(section(/^Work/).getAttribute("aria-expanded")).toBeTruthy();
  });

  it("hides a chapter's rows while it is closed — that is the point of closing it", () => {
    render(<LeadModal open />);
    const work = section(/^Work/);
    // Work starts closed for a customer with nothing in it.
    expect(work.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Tasks/ })).toBeNull();
    fireEvent.click(work);
    expect(screen.getByRole("button", { name: /^Tasks/ })).toBeTruthy();
  });

  it("opens Contact so the sheet does not start as four shut doors", () => {
    render(<LeadModal open />);
    expect(section(/^Contact/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /^Phone/ })).toBeTruthy();
  });

  // THE TRAP. "Add phone" opens the Phone row, which is now inside a section.
  it("'Add phone' opens the Phone row even when Contact has been closed", () => {
    render(<LeadModal open />);
    fireEvent.click(section(/^Contact/));                   // collapse it
    expect(screen.queryByRole("button", { name: /^Phone/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add phone" }));

    expect(section(/^Contact/).getAttribute("aria-expanded")).toBe("true");
    const phone = screen.getByRole("button", { name: /^Phone/ });
    expect(phone.getAttribute("aria-expanded")).toBe("true");
  });

  /**
   * The closed row answers "can I reach this person", so it NAMES the thing rather than counting
   * boxes. It used to read "1 of 4" — pagination-shaped, and the 1 was usually Lead source, which
   * is not a way to reach anyone. A customer with no phone and no email still scored 1.
   */
  it("a closed chapter shows the number, not a tally", () => {
    seed({ phone: "5105550123", email: "marta@example.com" });
    render(<LeadModal open />);
    expect(section(/^Contact/).textContent).toContain("5105550123");
    expect(section(/^Contact/).textContent).not.toMatch(/of 4/);
  });

  it("says Add phone when there is no way to call them", () => {
    seed({ phone: "", email: "" });
    render(<LeadModal open />);
    expect(section(/^Contact/).textContent).toMatch(/Add phone/);
  });

  // Lead source is not contact information. Scoring it made a customer nobody can reach look
  // partly filled in.
  it("does not count lead source as a way to reach someone", () => {
    seed({ phone: "", email: "", source: "Added manually" });
    render(<LeadModal open />);
    expect(section(/^Contact/).textContent).toMatch(/Add phone/);
  });

  /**
   * Call and Text with no number used to stack a second sheet whose whole job was one field —
   * and it was titled with the CUSTOMER'S NAME, so a customer called "New customer" produced a
   * sheet headed "New customer" over the sheet you were already reading. They now open the Phone
   * row six inches below, which is what the primary action already did.
   */
  it("Call with no number opens the Phone row instead of another sheet", () => {
    seed({ phone: "", email: "marta@example.com" });
    render(<LeadModal open />);
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(section(/^Contact/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /^Phone/ }).getAttribute("aria-expanded")).toBe("true");
    expect(pushModal).not.toHaveBeenCalled();
  });

  it("Text with no number does the same", () => {
    seed({ phone: "", email: "marta@example.com" });
    render(<LeadModal open />);
    fireEvent.click(screen.getByRole("button", { name: /^Text/ }));
    expect(screen.getByRole("button", { name: /^Phone/ }).getAttribute("aria-expanded")).toBe("true");
    expect(pushModal).not.toHaveBeenCalled();
  });

  // With a number, the buttons still do their real job.
  // Stage matters: on a NEW customer with a number, Call is the PRIMARY action and there is no
  // secondary Call button to click.
  it("Call with a number opens the call sheet", () => {
    seed({ phone: "5105550123", stage: "Quoted" });
    render(<LeadModal open />);
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(pushModal).toHaveBeenCalled();
  });
});
