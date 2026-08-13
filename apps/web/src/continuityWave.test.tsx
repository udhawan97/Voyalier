import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createMockGateway, type AppError } from "@voyalier/contracts";
import { vi } from "vitest";

import { renderApp } from "./test/helpers";

const DUPLICATE_DOCUMENT =
  "Confirmation RECOVER42 for the continuity test from ORD to NRT.";

async function openImport(content = DUPLICATE_DOCUMENT) {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Import a document",
  });
  fireEvent.change(screen.getByLabelText("Content"), {
    target: { value: content },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Import" }));
  await screen.findByText("Already imported");
}

describe("trip continuity wave", () => {
  it("opens an existing duplicate document without fetching or expanding its body", async () => {
    const gateway = createMockGateway();
    const imported = await gateway.importDocument({
      tripId: "trip_kyoto",
      kind: "pasted_text",
      label: "Continuity recovery",
      content: DUPLICATE_DOCUMENT,
    });
    const getDocument = vi.spyOn(gateway, "getDocument");
    renderApp(gateway);
    await openImport();

    fireEvent.click(
      screen.getByRole("button", { name: "Open existing document" }),
    );

    const row = await waitFor(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-search-source="document"][data-search-record="${imported.document.id}"]`,
      );
      expect(document.activeElement).toBe(target);
      return target!;
    });
    expect(row).toHaveTextContent("Continuity recovery");
    expect(row.querySelector(".voy-doc__body")).toBeNull();
    expect(getDocument).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain(imported.document.id);
  });

  it("lands on imported documents when a duplicate has no usable record id", async () => {
    const gateway = createMockGateway();
    const duplicate: AppError = {
      code: "document/duplicate",
      message: "duplicate",
      details: { existingDocumentId: "" },
    };
    vi.spyOn(gateway, "importDocument").mockRejectedValue(duplicate);
    const getDocument = vi.spyOn(gateway, "getDocument");
    renderApp(gateway);
    await openImport();

    fireEvent.click(
      screen.getByRole("button", { name: "Go to imported documents" }),
    );

    const heading = await screen.findByRole("heading", {
      name: "Imported documents",
    });
    await waitFor(() => expect(document.activeElement).toBe(heading), {
      timeout: 1_500,
    });
    expect(document.body).toHaveTextContent(
      "The existing document could not be located. Imported documents opened.",
    );
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("falls back when a nonempty duplicate record id no longer has a row", async () => {
    const gateway = createMockGateway();
    const duplicate: AppError = {
      code: "document/duplicate",
      message: "duplicate",
      details: { existingDocumentId: "document_vanished" },
    };
    vi.spyOn(gateway, "importDocument").mockRejectedValue(duplicate);
    const getDocument = vi.spyOn(gateway, "getDocument");
    renderApp(gateway);
    await openImport();

    fireEvent.click(
      screen.getByRole("button", { name: "Open existing document" }),
    );

    const heading = await screen.findByRole("heading", {
      name: "Imported documents",
    });
    await waitFor(() => expect(document.activeElement).toBe(heading), {
      timeout: 1_500,
    });
    expect(document.body).toHaveTextContent(
      "The existing document could not be located. Imported documents opened.",
    );
    expect(getDocument).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain("document_vanished");
  });
});
