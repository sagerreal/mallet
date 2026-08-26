// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NoteComposer } from "./note-composer";

const pickFile = (container: HTMLElement, file: File) => {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  fireEvent.change(input, { target: { files: [file] } });
};

const photo = () => new File(["x"], "panel-label.jpg", { type: "image/jpeg" });

const addBtn = (): HTMLButtonElement =>
  screen.getByRole("button", { name: "Add note" }) as HTMLButtonElement;

describe("NoteComposer without onAttachFile", () => {
  // The job sheet and the tech feed pass nothing. They must look and behave exactly as they
  // did before attachments existed — this is the whole contract of the optional prop.
  it("renders no attach affordance at all", () => {
    const { container } = render(<NoteComposer placeholder="gate code…" onSubmit={vi.fn()} />);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Attach a file" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("still refuses an empty submit", () => {
    const onSubmit = vi.fn();
    render(<NoteComposer placeholder="gate code…" onSubmit={onSubmit} />);
    const add = addBtn();
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits trimmed text and clears the field", async () => {
    const onSubmit = vi.fn();
    render(<NoteComposer placeholder="gate code…" onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Add a note");
    fireEvent.change(field, { target: { value: "  Gate code 4482  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Gate code 4482"));
    expect((field as HTMLInputElement).value).toBe("");
  });
});

describe("NoteComposer with onAttachFile", () => {
  // A photo of a panel label is a whole note. Requiring a sentence first would only teach
  // people to type a dot.
  it("allows a submit carrying an attachment and no text", async () => {
    const onAttachFile = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn();
    const { container } = render(
      <NoteComposer placeholder="gate code…" onSubmit={onSubmit} onAttachFile={onAttachFile} />,
    );

    expect(addBtn().disabled).toBe(true);

    pickFile(container, photo());
    await waitFor(() => expect(onAttachFile).toHaveBeenCalled());
    await waitFor(() => expect(addBtn().disabled).toBe(false));
    expect(screen.getByText("panel-label.jpg")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(""));
  });

  it("clears the staged file once the note is added, so the next note starts empty", async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <NoteComposer placeholder="gate code…" onSubmit={onSubmit} onAttachFile={vi.fn().mockResolvedValue(undefined)} />,
    );
    pickFile(container, photo());
    await waitFor(() => expect(addBtn().disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(screen.queryByText("panel-label.jpg")).toBeNull());
    expect(addBtn().disabled).toBe(true);
  });

  it("sends the text alongside the file when both are present", async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <NoteComposer placeholder="gate code…" onSubmit={onSubmit} onAttachFile={vi.fn().mockResolvedValue(undefined)} />,
    );
    fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "Panel is 200A" } });
    pickFile(container, photo());
    await waitFor(() => expect(screen.getByText("panel-label.jpg")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Panel is 200A"));
  });

  // The caller knows which rule the file broke; the composer prints that reason rather than
  // "something went wrong", which would leave someone retrying a file that can never be taken.
  it("shows the caller's failure reason and stages nothing", async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <NoteComposer
        placeholder="gate code…"
        onSubmit={onSubmit}
        onAttachFile={vi.fn().mockRejectedValue(new Error("Can't attach a .docm file."))}
      />,
    );
    pickFile(container, new File(["x"], "macro.docm"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Can't attach a .docm file."));
    expect(addBtn().disabled).toBe(true);
  });

  it("keeps the staged file when the note itself fails to save", async () => {
    const { container } = render(
      <NoteComposer
        placeholder="gate code…"
        onSubmit={vi.fn().mockResolvedValue(false)}
        onAttachFile={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "Panel is 200A" } });
    pickFile(container, photo());
    await waitFor(() => expect(screen.getByText("panel-label.jpg")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    // Text restored, file still staged — a retry must not cost a second upload.
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect((screen.getByLabelText("Add a note") as HTMLInputElement).value).toBe("Panel is 200A");
    expect(screen.getByText("panel-label.jpg")).not.toBeNull();
  });
});
