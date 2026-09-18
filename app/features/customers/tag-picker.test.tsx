// @vitest-environment jsdom
/**
 * The customer tag picker — the ONE place tags are applied and the shop's tag list is corrected.
 *
 * It replaced a single-select "Lead source" row. Two things had to change and both are pinned
 * below: a customer can carry SEVERAL tags (one slot silently lost whichever fact came second),
 * and a tag the customer already carries has to stay visible even after the label leaves the
 * shop's list — otherwise the picker shows a set that is not what is stored, and the next
 * unrelated edit posts the shortened version.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TagPicker } from "./tag-picker";
import { MAX_TAGS } from "@/modules/customers/domain/customer-tags";

const addSource = vi.fn().mockResolvedValue({ ok: true });
const removeSource = vi.fn();
let sources: { id: string; label: string }[] = [];

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ sources, addSource, removeSource }),
}));

const onChange = vi.fn();
const picker = (value: readonly string[] = []) =>
  render(<TagPicker value={value} onChange={onChange} />);

beforeEach(() => {
  sources = [];
  vi.clearAllMocks();
});

describe("applying tags", () => {
  it("offers the built-in list", () => {
    picker();
    expect(screen.getByRole("button", { name: /^Referral/ })).toBeTruthy();
  });

  it("ADDS to the set rather than replacing it — the whole point of tags", () => {
    picker(["Google"]);
    fireEvent.click(screen.getByRole("button", { name: /^Referral/ }));
    expect(onChange).toHaveBeenCalledWith(["Google", "Referral"]);
  });

  it("unticking removes just that tag", () => {
    picker(["Google", "Referral"]);
    fireEvent.click(screen.getByRole("button", { name: /^Google/ }));
    expect(onChange).toHaveBeenCalledWith(["Referral"]);
  });

  it("marks every applied tag, not just one", () => {
    picker(["Google", "Referral"]);
    expect(screen.getByRole("button", { name: /^Google/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Referral/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Yard sign/ }).getAttribute("aria-pressed")).toBe("false");
  });

  /** Case-insensitive: the vocabulary's spelling is what the row shows, and it must still read as on. */
  it("recognises a tag stored with different casing", () => {
    picker(["google"]);
    expect(screen.getByRole("button", { name: /^Google/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("removes a differently-cased tag on untick instead of duplicating it", () => {
    picker(["google"]);
    fireEvent.click(screen.getByRole("button", { name: /^Google/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

/**
 * THE ONE THAT PROTECTS STORED DATA. Vocabulary and stored set are separate: removing a label
 * takes away the choice, not the history. A picker that rendered only the vocabulary would hide a
 * tag that is really on the record — and because onChange posts the FULL set, the next click on
 * any other row would write the set without it.
 */
describe("a tag that is no longer in the shop's list", () => {
  it("still appears, and still reads as applied", () => {
    picker(["Retired label"]);
    const row = screen.getByRole("button", { name: /^Retired label/ });
    expect(row.getAttribute("aria-pressed")).toBe("true");
  });

  it("survives a click on an unrelated tag", () => {
    picker(["Retired label"]);
    fireEvent.click(screen.getByRole("button", { name: /^Referral/ }));
    expect(onChange).toHaveBeenCalledWith(["Retired label", "Referral"]);
  });
});

describe("correcting the list from inside the picker", () => {
  it("adds a tag and applies it in one go", async () => {
    picker();
    fireEvent.click(screen.getByRole("button", { name: /Add a new tag/ }));
    fireEvent.change(screen.getByPlaceholderText("Tag name"), { target: { value: "Home show" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await vi.waitFor(() => expect(addSource).toHaveBeenCalledWith("Home show"));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(["Home show"]));
  });

  it("applies an existing tag rather than erroring when the name is a duplicate", async () => {
    addSource.mockResolvedValueOnce({ ok: false, reason: "duplicate" });
    picker();
    fireEvent.click(screen.getByRole("button", { name: /Add a new tag/ }));
    fireEvent.change(screen.getByPlaceholderText("Tag name"), { target: { value: "Referral" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(["Referral"]));
  });

  /** Adding a tag the customer ALREADY carries must not double it. */
  it("does not apply a duplicate twice", async () => {
    addSource.mockResolvedValueOnce({ ok: false, reason: "duplicate" });
    picker(["Referral"]);
    fireEvent.click(screen.getByRole("button", { name: /Add a new tag/ }));
    fireEvent.change(screen.getByPlaceholderText("Tag name"), { target: { value: "Referral" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await vi.waitFor(() => expect(addSource).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a tag this shop added", () => {
    sources = [{ id: "src-1", label: "Home show" }];
    picker();
    fireEvent.click(screen.getByRole("button", { name: "Remove Home show from the tag list" }));
    expect(removeSource).toHaveBeenCalledWith("src-1");
  });

  it("offers NO remove on a built-in — those are always available", () => {
    picker();
    expect(screen.queryByRole("button", { name: /^Remove Referral/ })).toBeNull();
  });

  it("unticks the removed tag on THIS customer when it was applied", () => {
    sources = [{ id: "src-1", label: "Home show" }];
    picker(["Home show", "Google"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Home show from the tag list" }));
    expect(onChange).toHaveBeenCalledWith(["Google"]);
  });

  it("says why the add was refused and keeps the name to fix", async () => {
    addSource.mockResolvedValueOnce({ ok: false, reason: "failed", message: "Label is too long — 200 characters maximum." });
    picker();
    fireEvent.click(screen.getByRole("button", { name: /Add a new tag/ }));
    fireEvent.change(screen.getByPlaceholderText("Tag name"), { target: { value: "Home show" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Label is too long — 200 characters maximum.")).toBeTruthy();
    expect(screen.getByDisplayValue("Home show")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the refusal once the add lands", async () => {
    addSource.mockResolvedValueOnce({ ok: false, reason: "failed", message: "Couldn't add tag." });
    picker();
    fireEvent.click(screen.getByRole("button", { name: /Add a new tag/ }));
    fireEvent.change(screen.getByPlaceholderText("Tag name"), { target: { value: "Home show" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText("Couldn't add tag.");

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(["Home show"]));
    expect(screen.queryByText("Couldn't add tag.")).toBeNull();
  });

  it("ignores a blank name instead of adding an empty tag", () => {
    picker();
    fireEvent.click(screen.getByRole("button", { name: /Add a new tag/ }));
    fireEvent.change(screen.getByPlaceholderText("Tag name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(addSource).not.toHaveBeenCalled();
  });
});

/**
 * The cap is enforced in the domain, so a silent refusal here would look like a dead button and
 * the save would fail later with no explanation of which click caused it.
 */
describe("the tag cap", () => {
  // Zero-padded so a prefix match on one row cannot also match "Tag 1x".
  const full = Array.from({ length: MAX_TAGS }, (_, i) => `Tag ${String(i + 1).padStart(2, "0")}`);

  it("says why an extra tag will not apply", () => {
    picker(full);
    fireEvent.click(screen.getByRole("button", { name: /^Referral/ }));
    expect(screen.getByRole("alert").textContent).toContain(String(MAX_TAGS));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still lets you untick at the cap — otherwise it is a trap", () => {
    picker(full);
    fireEvent.click(screen.getByRole("button", { name: /^Tag 01/ }));
    expect(onChange).toHaveBeenCalledWith(full.slice(1));
  });
});
