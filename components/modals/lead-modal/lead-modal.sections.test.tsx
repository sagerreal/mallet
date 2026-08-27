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

  it("hides a chapter's contents while it is closed — that is the point of closing it", () => {
    render(<LeadModal open />);
    const work = section(/^Work/);
    // Work starts closed for a customer with nothing in it.
    expect(work.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Tasks")).toBeNull();
    fireEvent.click(work);
    // Its fields are laid out flat inside — a group label, not another row to open.
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Tasks/ })).toBeNull();
  });

  /**
   * EVERY CHAPTER STARTS SHUT. Contact used to open on the theory that it is why the sheet gets
   * opened, but it landed the reader on a wall of fields instead of the summary the collapsed rows
   * already carry — and the summary is what answers "can I reach this person" in one line.
   */
  it("starts with every chapter closed, summaries doing the talking", () => {
    seed({ phone: "5105550123" });
    render(<LeadModal open />);
    expect(section(/^Contact/).getAttribute("aria-expanded")).toBe("false");
    expect(section(/^Contact/).textContent).toContain("5105550123");
  });

  /**
   * PHONE AND EMAIL ARE TYPED IN PLACE. They were rows with their own chevron inside Contact, so
   * reaching the number cost two opens. A free-text field has nothing to reveal, so there is no
   * "Phone" button any more — there is a Phone input.
   */
  /**
   * NO SECOND LAYER OF CHEVRONS. Every field in Contact was its own expandable row, so opening the
   * chapter revealed four more things to open. Opening a chapter IS the request to see inside it.
   */
  it("lays every Contact field out flat — no field is a row to open", () => {
    render(<LeadModal open />);
    fireEvent.click(section(/^Contact/));

    expect(screen.getByLabelText("Phone")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Service address")).toBeTruthy();
    expect(screen.getByText("Tags")).toBeTruthy();

    for (const field of [/^Phone/, /^Email/, /^Tags/, /^Service address/]) {
      expect(screen.queryByRole("button", { name: field })).toBeNull();
    }
  });

  // THE TRAP. "Add phone" has to reach the field, and the field is inside a shut chapter.
  it("'Add phone' opens Contact and reveals the phone field", () => {
    render(<LeadModal open />);
    expect(screen.queryByLabelText("Phone")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add phone" }));

    expect(section(/^Contact/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Phone")).toBeTruthy();
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

  /**
   * "Add", the same word every other chapter head uses. It used to say "Add phone" — the only
   * head on the sheet that named a field — and "Add phone · email on file" when there was an
   * email, the only one that wrote a sentence.
   */
  it("says just Add when there is no way to reach them", () => {
    seed({ phone: "", email: "" });
    render(<LeadModal open />);
    const head = section(/^Contact/).textContent ?? "";
    expect(head).toMatch(/Add/);
    expect(head).not.toMatch(/Add phone/);
  });

  // Lead source is not contact information. Scoring it made a customer nobody can reach look
  // partly filled in.
  it("does not count lead source as a way to reach someone", () => {
    seed({ phone: "", email: "", source: "Added manually" });
    render(<LeadModal open />);
    expect(section(/^Contact/).textContent).not.toMatch(/Added manually/);
    expect(section(/^Contact/).textContent).toMatch(/Add/);
  });

  /** With an email but no phone, the head shows the email rather than a sentence about it. */
  it("shows the email in the head when that is the only way to reach them", () => {
    seed({ phone: "", email: "marta@example.com" });
    render(<LeadModal open />);
    expect(section(/^Contact/).textContent).toContain("marta@example.com");
  });

  /**
   * Call and Text with no number used to stack a second sheet whose whole job was one field —
   * and it was titled with the CUSTOMER'S NAME, so a customer called "New customer" produced a
   * sheet headed "New customer" over the sheet you were already reading. They now open the phone
   * field six inches below, which is what the primary action already did.
   */
  it("Call with no number opens the phone field instead of another sheet", () => {
    seed({ phone: "", email: "marta@example.com" });
    render(<LeadModal open />);
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(section(/^Contact/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Phone")).toBeTruthy();
    expect(pushModal).not.toHaveBeenCalled();
  });

  it("Text with no number does the same", () => {
    seed({ phone: "", email: "marta@example.com" });
    render(<LeadModal open />);
    fireEvent.click(screen.getByRole("button", { name: /^Text/ }));
    expect(screen.getByLabelText("Phone")).toBeTruthy();
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
