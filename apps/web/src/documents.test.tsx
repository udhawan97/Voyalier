import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { AppGateway } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { failingGateway, renderApp } from "./test/helpers";

/** Documents are trip-scoped, so the manager lives on the trip page. */
async function openDocuments(gateway?: AppGateway) {
  renderApp(gateway ?? createMockGateway());
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
  );
  await screen.findByRole("heading", {
    name: "Kyoto autumn journey",
    level: 1,
  });
  return screen.findByRole("region", { name: "Imported documents" });
}

/**
 * The documents manager is the answer to a privacy promise: Voyalier reads
 * confirmation emails full of codes and names, so the traveler must be able to
 * see exactly what it kept and remove it.
 */
describe("imported documents", () => {
  it("lists what was imported without revealing any of it", async () => {
    const region = await openDocuments();

    const kyoto = await within(region).findByText("Kyoto confirmations");
    const row = kyoto.closest(".voy-doc") as HTMLElement;
    expect(within(row).getByText("2 awaiting review")).toBeInTheDocument();

    // A listing must never carry the body: it holds confirmation codes, and
    // nothing has asked for it yet.
    expect(within(region).queryByText(/KY7M2Q/)).toBeNull();
    expect(within(region).queryByText(/Maple Lantern House/)).toBeNull();
  });

  it("shows the original text only when asked, then hides it again", async () => {
    const region = await openDocuments();
    const kyoto = await within(region).findByText("Kyoto confirmations");
    const row = kyoto.closest(".voy-doc") as HTMLElement;

    fireEvent.click(within(row).getByRole("button", { name: "Show original" }));
    // The stored body comes back verbatim — that is the whole point.
    expect(await within(row).findByText(/KY7M2Q/)).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "Hide original" }));
    expect(within(row).queryByText(/KY7M2Q/)).toBeNull();
  });

  it("warns what a deletion takes with it before taking it", async () => {
    const region = await openDocuments();
    const kyoto = await within(region).findByText("Kyoto confirmations");
    const row = kyoto.closest(".voy-doc") as HTMLElement;

    expect(
      within(row).getByText(/still awaiting review go(es)? too/),
    ).toBeInTheDocument();
  });

  it("removes a document behind a two-step confirm", async () => {
    const region = await openDocuments();
    const kyoto = await within(region).findByText("Kyoto confirmations");
    const row = kyoto.closest(".voy-doc") as HTMLElement;

    // First click arms; it must not delete on a single click.
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Kyoto confirmations")).toBeInTheDocument();

    fireEvent.click(
      within(row).getByRole("button", { name: "Remove — sure?" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Kyoto confirmations")).toBeNull(),
    );
    // The other import is untouched.
    expect(screen.getByText("Note from a travel forum")).toBeInTheDocument();
  });

  it("keeps confirmed facts when their document goes, and says they lost it", async () => {
    const gateway = createMockGateway();
    // Confirm a candidate so a fact exists that outlives its document.
    const pending = await gateway.listCandidates("trip_kyoto", "pending");
    const fromKyoto = pending.find(
      (candidate) => candidate.documentId === "document_kyoto_confirmations",
    )!;
    await gateway.confirmCandidate({ candidateId: fromKyoto.id });

    const region = await openDocuments(gateway);
    const kyoto = await within(region).findByText("Kyoto confirmations");
    const row = kyoto.closest(".voy-doc") as HTMLElement;
    expect(within(row).getByText(/1 confirmed/)).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    fireEvent.click(
      within(row).getByRole("button", { name: "Remove — sure?" }),
    );

    // The fact survives — the traveler approved it — but the UI admits its
    // evidence is gone rather than passing it off as hand-typed.
    expect(
      await screen.findByText("Source document removed"),
    ).toBeInTheDocument();
  });

  it("reports a failure to load instead of rendering an empty list", async () => {
    const region = await openDocuments(
      failingGateway({
        listDocuments: () =>
          Promise.reject({ code: "transport/failure", message: "down" }),
      }),
    );
    expect(await within(region).findByRole("alert")).toBeInTheDocument();
  });
});
