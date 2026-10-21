import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMockGateway, type AppGateway } from "@voyalier/contracts";

import { renderApp, renderTrip } from "./test/helpers";

const kinds: ("create" | "edit")[] = ["create", "edit"];
const dismissals: ("Cancel" | "Escape" | "backdrop")[] = [
  "Cancel",
  "Escape",
  "backdrop",
];
const cases = kinds.flatMap((kind) =>
  dismissals.flatMap((dismiss) =>
    [false, true].map((rejects) => ({ kind, dismiss, rejects })),
  ),
);

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}

async function pendingModal(kind: "create" | "edit", rejects: boolean) {
  const base = createMockGateway();
  const gate = deferred();
  const hold = async () => {
    await gate.promise;
    if (rejects)
      throw { code: "storage/failure", message: "Synthetic delayed failure" };
  };
  const create = vi.fn(
    async (input: Parameters<AppGateway["setConciergeProfile"]>[0]) => {
      await hold();
      return base.setConciergeProfile(input);
    },
  );
  const edit = vi.fn(async (...args: Parameters<AppGateway["updateTrip"]>) => {
    await hold();
    return base.updateTrip(...args);
  });
  const gateway = { ...base, setConciergeProfile: create, updateTrip: edit };
  if (kind === "create") renderApp(gateway);
  else await renderTrip(gateway);
  const open = async () => {
    fireEvent.click(
      await screen.findByRole("button", {
        name: kind === "create" ? "Create a trip" : "Edit",
      }),
    );
    return screen.findByRole("dialog", {
      name: kind === "create" ? "Create a trip" : "Edit trip",
    });
  };
  const a = await open();
  if (kind === "create") {
    for (const [label, value] of [
      ["From", "Chicago"],
      ["To", "Rome"],
      ["Start date", "2027-06-01"],
      ["End date", "2027-06-05"],
    ])
      fireEvent.change(within(a).getByLabelText(label), { target: { value } });
  }
  fireEvent.change(within(a).getByLabelText("Trip name (optional)"), {
    target: { value: "Accepted A" },
  });
  fireEvent.click(
    within(a).getByRole("button", {
      name: kind === "create" ? "Create trip" : "Save changes",
    }),
  );
  const operation = kind === "create" ? create : edit;
  await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
  async function settle() {
    await act(async () => {
      gate.release();
      await operation.mock.results[0].value.catch(() => undefined);
    });
  }
  return { a, base, open, settle };
}

it.each(cases)(
  "$kind completion after $dismiss preserves the replacement draft (rejects=$rejects)",
  async ({ kind, dismiss, rejects }) => {
    const { a, base, open, settle } = await pendingModal(kind, rejects);
    if (dismiss === "Cancel")
      fireEvent.click(within(a).getByRole("button", { name: "Cancel" }));
    else if (dismiss === "Escape") fireEvent.keyDown(a, { key: "Escape" });
    else fireEvent.mouseDown(a.parentElement!);
    await waitFor(() => expect(a).not.toBeInTheDocument());
    const b = await open();
    const destination = within(b).getByLabelText("To");
    fireEvent.change(destination, {
      target: { value: "Draft B must survive" },
    });
    destination.focus();
    await settle();
    expect(b).toBeInTheDocument();
    expect(destination).toHaveValue("Draft B must survive");
    expect(destination).toHaveFocus();
    expect(
      screen.queryByText("Trip created: Accepted A."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Trip updated.")).not.toBeInTheDocument();
    if (!rejects) {
      if (kind === "create")
        expect(
          await screen.findByRole("button", { name: "Open Accepted A" }),
        ).toBeInTheDocument();
      else {
        expect((await base.getTrip("trip_kyoto")).trip.title).toBe(
          "Accepted A",
        );
        expect(
          await screen.findByRole("heading", { name: "Accepted A", level: 1 }),
        ).toBeInTheDocument();
      }
    }
  },
);

it.each(["create", "edit"] as const)(
  "%s completion refreshes persisted trips after navigation without a stale announcement",
  async (kind) => {
    const { settle } = await pendingModal(kind, false);
    if (kind === "create") {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      await screen.findByRole("heading", { name: "Settings", level: 1 });
    } else {
      fireEvent.click(
        screen.getByRole("button", { name: "Voyalier — all trips" }),
      );
      await screen.findByRole("heading", { name: "Trips", level: 1 });
    }
    await settle();
    expect(
      screen.queryByText("Trip created: Accepted A."),
    ).not.toBeInTheDocument();
    if (kind === "create")
      fireEvent.click(
        screen.getByRole("button", { name: "Voyalier — all trips" }),
      );
    expect(
      await screen.findByRole("button", { name: "Open Accepted A" }),
    ).toBeInTheDocument();
  },
);
