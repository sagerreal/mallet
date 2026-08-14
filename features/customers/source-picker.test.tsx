// @vitest-environment jsdom
/**
 * The lead-source picker, which is now the ONE place a source is chosen or the list corrected.
 *
 * The gap it closes: a source could be set once, on the new-customer modal, at the moment you know
 * least about the job — and never changed. On an existing customer it was a line of text in the
 * header that rendered NOTHING when empty, so the commonest case (typed in a hurry, source skipped)
 * had no way back. The API had always accepted the change; there was simply no control.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SourcePicker } from "./source-picker";

const addSource = vi.fn().mockResolvedValue({ ok: true });
const removeSource = vi.fn();
let sources: { id: string; label: string }[] = [];

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ sources, addSource, removeSource }),
}));

const onPick = vi.fn();
const picker = (value = "") => render(<SourcePicker value={value} onPick={onPick} />);

beforeEach(() => {
  sources = [];
  vi.clearAllMocks();
});

describe("choosing a source", () => {
  it("offers the built-in list", () => {
    picker();
    expect(screen.getByRole("button", { name: /^Referral/ })).toBeTruthy();
  });

  it("reports the choice", () => {
    picker();
    fireEvent.click(screen.getByRole("button", { name: /^Referral/ }));
    expect(onPick).toHaveBeenCalledWith("Referral");
  });

  it("marks the one already set", () => {
    picker("Referral");
    expect(screen.getByRole("button", { name: /^Referral/ }).className).toContain("on");
  });
});

describe("correcting the list from inside the picker", () => {
  it("adds a source and selects it in one go", async () => {
    picker();
    fireEvent.click(screen.getByRole("button", { name: /Add a new source/ }));
    fireEvent.change(screen.getByPlaceholderText("Source name"), { target: { value: "Home show" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await vi.waitFor(() => expect(addSource).toHaveBeenCalledWith("Home show"));
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith("Home show"));
  });

  it("selects an existing source rather than erroring when the name is a duplicate", async () => {
    // The source already exists, so selecting it is what the person meant either way.
    addSource.mockResolvedValueOnce({ ok: false, reason: "duplicate" });
    picker();
    fireEvent.click(screen.getByRole("button", { name: /Add a new source/ }));
    fireEvent.change(screen.getByPlaceholderText("Source name"), { target: { value: "Referral" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith("Referral"));
  });

  it("removes a source this shop added", () => {
    sources = [{ id: "src-1", label: "Home show" }];
    picker();
    fireEvent.click(screen.getByRole("button", { name: "Remove Home show from the source list" }));
    expect(removeSource).toHaveBeenCalledWith("src-1");
  });

  it("offers NO remove on a built-in — those are always available", () => {
    picker();
    expect(screen.queryByRole("button", { name: /^Remove Referral/ })).toBeNull();
  });

  it("clears the selection when the source being removed is the one in use", () => {
    // Otherwise the record keeps a source that is no longer on the list.
    sources = [{ id: "src-1", label: "Home show" }];
    picker("Home show");
    fireEvent.click(screen.getByRole("button", { name: "Remove Home show from the source list" }));
    expect(onPick).toHaveBeenCalledWith("");
  });

  it("ignores a blank name instead of adding an empty source", () => {
    picker();
    fireEvent.click(screen.getByRole("button", { name: /Add a new source/ }));
    fireEvent.change(screen.getByPlaceholderText("Source name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(addSource).not.toHaveBeenCalled();
  });
});
