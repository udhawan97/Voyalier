import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";

import { setLocalePreference } from "./app/locale";
import { renderApp } from "./test/helpers";

const languages = [
  {
    locale: "en",
    create: "Create a trip",
    from: "From",
    to: "To",
    travelers: "Travelers",
    save: "Save trip idea",
    start: "Start date",
    end: "End date",
    partial: "Set both dates or leave both undecided.",
    invalidParty: "Enter between 1 and 20 travelers.",
    ideas: "Trip ideas",
    undecided: "Dates undecided",
    oneTraveler: "1 traveler",
    fourTravelers: "4 travelers",
    noSearch: "No inventory or availability search runs while this is an idea.",
    cardStart: "Start",
    cardEnd: "End",
    convert: "Build dated trip",
    remove: "Delete idea",
    cancel: "Cancel",
    submit: "Create trip",
    saved: "Saved Montréal as a trip idea.",
  },
  {
    locale: "es",
    create: "Crear un viaje",
    from: "Desde",
    to: "Destino",
    travelers: "Viajeros",
    save: "Guardar idea de viaje",
    start: "Fecha de inicio",
    end: "Fecha de finalización",
    partial: "Indica ambas fechas o deja ambas sin decidir.",
    invalidParty: "Indica entre 1 y 20 viajeros.",
    ideas: "Ideas de viaje",
    undecided: "Fechas sin decidir",
    oneTraveler: "1 viajero",
    fourTravelers: "4 viajeros",
    noSearch: "No se busca inventario ni disponibilidad mientras sea una idea.",
    cardStart: "Inicio",
    cardEnd: "Fin",
    convert: "Crear viaje con fechas",
    remove: "Eliminar idea",
    cancel: "Cancelar",
    submit: "Crear viaje",
    saved: "Se guardó Montréal como idea de viaje.",
  },
] as const;

function change(label: string, value: string, root: HTMLElement) {
  fireEvent.change(within(root).getByLabelText(label), { target: { value } });
}

describe.each(languages)("trip ideas in $locale", (copy) => {
  beforeEach(() => setLocalePreference(copy.locale));
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setLocalePreference("en");
  });

  it("validates, saves an undated idea and converts its unchanged source data", async () => {
    const gateway = createMockGateway();
    const save = vi.spyOn(gateway, "saveTripIntent");
    const create = vi.spyOn(gateway, "createTrip");
    const convert = vi.spyOn(gateway, "convertTripIntent");
    const view = renderApp(gateway);
    fireEvent.click(await screen.findByRole("button", { name: copy.create }));
    const dialog = await screen.findByRole("dialog");
    change(copy.from, "Chicago", dialog);
    change(copy.to, "Montréal", dialog);
    change(copy.start, "2027-05-01", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: copy.save }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(copy.partial);
    expect(within(dialog).getByLabelText(copy.start)).toHaveFocus();
    expect(save).not.toHaveBeenCalled();

    change(copy.start, "", dialog);
    change(copy.travelers, "0", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: copy.save }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      copy.invalidParty,
    );
    expect(within(dialog).getByLabelText(copy.travelers)).toHaveFocus();
    expect(save).not.toHaveBeenCalled();
    change(copy.travelers, "4", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: copy.save }));

    await screen.findByRole("heading", { name: copy.ideas });
    expect(await screen.findByText(copy.saved)).toBeInTheDocument();
    expect(save).toHaveBeenCalledExactlyOnceWith({
      origin: "Chicago",
      destination: "Montréal",
      partySize: 4,
    });
    expect(create).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe(copy.locale);
    expect(localStorage.getItem("voyalier.locale")).toBe(copy.locale);

    // Component remount is source-runtime evidence, not native relaunch proof.
    view.unmount();
    renderApp(gateway);
    const idea = await screen.findByRole("heading", {
      name: "Chicago → Montréal",
    });
    const card = idea.closest("article")!;
    expect(within(card).getByText(copy.undecided)).toBeInTheDocument();
    expect(within(card).getByText(copy.noSearch)).toBeInTheDocument();
    expect(
      within(card).getByText(`Chicago → Montréal · ${copy.fourTravelers}`),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: copy.convert }),
    ).toBeDisabled();
    const [saved] = await gateway.listTripIntents();
    change(copy.cardStart, "2027-05-01", card);
    change(copy.cardEnd, "2027-05-08", card);
    fireEvent.click(within(card).getByRole("button", { name: copy.convert }));
    expect(
      await screen.findByRole("heading", {
        name: "Chicago → Montréal",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(convert).toHaveBeenCalledExactlyOnceWith({
      draftId: saved.id,
      startDate: "2027-05-01",
      endDate: "2027-05-08",
    });
    expect(await gateway.listTripIntents()).toHaveLength(0);
    const converted = (await gateway.listTrips()).find(
      (trip) => trip.destination === "Montréal",
    )!;
    const workspace = await gateway.getConciergeWorkspace(converted.id);
    expect(workspace.profile.preferences.partySize).toBe(4);
    // The owner deliberately retained this separate English surface.
    expect(
      (
        await screen.findByRole("heading", {
          name: "Everything between here and there",
        })
      ).closest("section"),
    ).toHaveAttribute("lang", "en");
  });

  it("keeps cancel free of writes and deletes an idea through localized controls", async () => {
    const gateway = createMockGateway();
    const saved = await gateway.saveTripIntent({
      origin: "Chicago",
      destination: "Montréal",
      partySize: 1,
    });
    const save = vi.spyOn(gateway, "saveTripIntent");
    const remove = vi.spyOn(gateway, "deleteTripIntent");
    renderApp(gateway);
    const opener = await screen.findByRole("button", { name: copy.create });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    change(copy.to, "Traveler text", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: copy.cancel }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(save).not.toHaveBeenCalled();
    const card = (
      await screen.findByRole("heading", { name: "Chicago → Montréal" })
    ).closest("article")!;
    expect(
      within(card).getByText(`Chicago → Montréal · ${copy.oneTraveler}`),
    ).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: copy.remove }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Chicago → Montréal" }),
      ).toBeNull(),
    );
    expect(remove).toHaveBeenCalledExactlyOnceWith(saved.id);
    expect(await gateway.listTripIntents()).toHaveLength(0);
  });

  it("creates a dated trip with the same route, dates and party size", async () => {
    const gateway = createMockGateway();
    const create = vi.spyOn(gateway, "createTrip");
    const save = vi.spyOn(gateway, "saveTripIntent");
    renderApp(gateway);
    fireEvent.click(await screen.findByRole("button", { name: copy.create }));
    const dialog = await screen.findByRole("dialog");
    change(copy.from, "Chicago", dialog);
    change(copy.to, "Montréal", dialog);
    change(copy.start, "2027-05-01", dialog);
    change(copy.end, "2027-05-08", dialog);
    change(copy.travelers, "4", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: copy.submit }));
    await screen.findByRole("heading", { name: "Chicago → Montréal" });
    expect(create).toHaveBeenCalledExactlyOnceWith({
      origin: "Chicago",
      destination: "Montréal",
      startDate: "2027-05-01",
      endDate: "2027-05-08",
    });
    expect(save).not.toHaveBeenCalled();
    const created = (await gateway.listTrips()).find(
      (trip) => trip.destination === "Montréal",
    )!;
    expect(
      (await gateway.getConciergeWorkspace(created.id)).profile.preferences
        .partySize,
    ).toBe(4);
  });
});

it("switches active trip-idea errors and controls without losing draft or focus", async () => {
  setLocalePreference("en");
  try {
    const gateway = createMockGateway();
    const save = vi.spyOn(gateway, "saveTripIntent");
    renderApp(gateway);
    fireEvent.click(
      await screen.findByRole("button", { name: "Create a trip" }),
    );
    const dialog = await screen.findByRole("dialog");
    change("From", "Chicago", dialog);
    change("To", "Montréal 🌿", dialog);
    change("Start date", "2027-05-01", dialog);
    change("Travelers", "0", dialog);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save trip idea" }),
    );
    expect(
      within(dialog).getByText("Set both dates or leave both undecided."),
    ).toHaveAttribute("role", "alert");
    expect(
      within(dialog).getByText("Enter between 1 and 20 travelers."),
    ).toHaveAttribute("role", "alert");
    expect(within(dialog).getByLabelText("Start date")).toHaveFocus();

    act(() => setLocalePreference("es"));
    expect(
      within(dialog).getByRole("button", { name: "Guardar idea de viaje" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Indica ambas fechas o deja ambas sin decidir."),
    ).toHaveAttribute("role", "alert");
    expect(
      within(dialog).getByText("Indica entre 1 y 20 viajeros."),
    ).toHaveAttribute("role", "alert");
    expect(
      within(dialog).queryByText("Set both dates or leave both undecided."),
    ).toBeNull();
    expect(
      within(dialog).queryByText("Enter between 1 and 20 travelers."),
    ).toBeNull();
    expect(within(dialog).getByLabelText("Viajeros")).toHaveValue(0);
    expect(within(dialog).getByLabelText("Destino")).toHaveValue("Montréal 🌿");
    expect(within(dialog).getByLabelText("Fecha de inicio")).toHaveValue(
      "2027-05-01",
    );
    expect(within(dialog).getByLabelText("Fecha de inicio")).toHaveFocus();
    expect(document.documentElement.lang).toBe("es");
    expect(save).not.toHaveBeenCalled();

    act(() => setLocalePreference("en"));
    expect(
      within(dialog).getByText("Set both dates or leave both undecided."),
    ).toHaveAttribute("role", "alert");
    expect(
      within(dialog).getByText("Enter between 1 and 20 travelers."),
    ).toHaveAttribute("role", "alert");
    expect(within(dialog).getByLabelText("Start date")).toHaveFocus();
  } finally {
    cleanup();
    setLocalePreference("en");
  }
});
