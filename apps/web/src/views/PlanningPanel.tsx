import { useRef, useState } from "react";
import type {
  PackingItem,
  PackingSuggestion,
  SavedPlace,
  TripItem,
  TripItemKind,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDateTimeLocal } from "../app/format";
import { t, type MessageKey } from "../app/i18n";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";
import { CheckIcon, PlusIcon } from "../components/icons";
import { SectionTitle } from "../components/primitives";
import { toAppError } from "../gateway/errors";

type Props = {
  tripId: string;
  savedPlaces: SavedPlace[];
  suggestions: PackingSuggestion[];
  packingItems: PackingItem[];
  tripItems: TripItem[];
  onChanged: () => void;
};

export function PlanningPanel({
  tripId,
  savedPlaces,
  suggestions,
  packingItems,
  tripItems,
  onChanged,
}: Props) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customPacking, setCustomPacking] = useState("");
  const [titleError, setTitleError] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [savedNotes, setSavedNotes] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<TripItemKind>("activity");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [itemNotes, setItemNotes] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [selectedSavedPlaceId, setSelectedSavedPlaceId] = useState<
    string | null
  >(null);
  const [editingPackingId, setEditingPackingId] = useState<string | null>(null);
  const [packingLabel, setPackingLabel] = useState("");

  function resetItemForm() {
    setEditingItemId(null);
    setKind("activity");
    setTitle("");
    setLocation("");
    setStartAt("");
    setEndAt("");
    setItemNotes("");
    setSelectedSavedPlaceId(null);
    setTitleError(false);
  }

  async function change(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(describeError(toAppError(caught)).title);
    } finally {
      setBusy(null);
    }
  }

  const acceptedCodes = new Set(
    packingItems.map((item) => item.suggestionCode).filter(Boolean),
  );

  return (
    <div className="voy-planning">
      <section aria-labelledby="saved-places-title">
        <SectionTitle id="saved-places-title" icon={<PlusIcon />}>
          {t("planning.saved.title")}
        </SectionTitle>
        <p>{t("planning.saved.intro")}</p>
        {savedPlaces.length === 0 ? (
          <p className="voy-muted">{t("planning.saved.empty")}</p>
        ) : (
          <ul className="voy-planning__list">
            {savedPlaces.map((place) => (
              <li
                key={place.id}
                className="voy-planning__card"
                tabIndex={-1}
                data-search-source="saved_place"
                data-search-record={place.id}
                data-testid={`search-target-saved_place-${place.id}`}
              >
                <div>
                  <strong>{place.name}</strong>
                  <p>
                    {place.source} · {place.license}
                    {!place.sourcePackAvailable
                      ? ` · ${t("planning.saved.packRemoved")}`
                      : ""}
                  </p>
                </div>
                <label>
                  {t("planning.saved.notes")}
                  <textarea
                    value={savedNotes[place.id] ?? place.notes}
                    onChange={(event) =>
                      setSavedNotes((current) => ({
                        ...current,
                        [place.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="voy-planning__actions">
                  <Button
                    variant="ghost"
                    aria-label={t("planning.saved.saveNotesLabel", {
                      name: place.name,
                    })}
                    busy={busy === `notes:${place.id}`}
                    onClick={() =>
                      change(`notes:${place.id}`, () =>
                        gateway.updateSavedPlace({
                          savedPlaceId: place.id,
                          notes: savedNotes[place.id] ?? place.notes,
                        }),
                      )
                    }
                  >
                    {t("planning.saved.saveNotes")}
                  </Button>
                  <Button
                    variant="secondary"
                    aria-label={t("planning.saved.addToPlanLabel", {
                      name: place.name,
                    })}
                    onClick={() => {
                      setEditingItemId(null);
                      setKind("activity");
                      setTitle(place.name);
                      setLocation(`${place.lat}, ${place.lon}`);
                      setStartAt("");
                      setEndAt("");
                      setItemNotes("");
                      setSelectedSavedPlaceId(place.id);
                      setTitleError(false);
                      announce(
                        t("planning.saved.prefilled", { name: place.name }),
                      );
                    }}
                  >
                    {t("planning.saved.addToPlan")}
                  </Button>
                  <ConfirmButton
                    label={t("planning.remove")}
                    ariaLabel={t("planning.removeNamed", {
                      name: place.name,
                    })}
                    busy={busy === `delete-place:${place.id}`}
                    onConfirm={() =>
                      change(`delete-place:${place.id}`, () =>
                        gateway.deleteSavedPlace(place.id),
                      )
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="packing-checklist-title">
        <SectionTitle id="packing-checklist-title" icon={<CheckIcon />}>
          {t("planning.packing.title")}
        </SectionTitle>
        <p>{t("planning.packing.intro")}</p>
        {suggestions.length > 0 ? (
          <ul className="voy-planning__suggestions">
            {suggestions.map((suggestion) => {
              const accepted = acceptedCodes.has(suggestion.code);
              return (
                <li key={suggestion.code}>
                  <span>
                    {t(`packing.${suggestion.code}` as MessageKey)}
                    <small>
                      {t(
                        `packing.reason.${suggestion.reason.code}` as MessageKey,
                        { value: suggestion.reason.value ?? "" },
                      )}
                    </small>
                  </span>
                  <Button
                    variant="ghost"
                    disabled={accepted}
                    busy={busy === `suggestion:${suggestion.code}`}
                    onClick={() =>
                      change(`suggestion:${suggestion.code}`, () =>
                        gateway.addPackingItem({
                          tripId,
                          label: t(`packing.${suggestion.code}` as MessageKey),
                          suggestionCode: suggestion.code,
                        }),
                      )
                    }
                  >
                    {accepted
                      ? t("planning.packing.added")
                      : t("planning.packing.add")}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <form
          className="voy-planning__inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const label = customPacking.trim();
            if (!label) return;
            void change("packing:new", async () => {
              await gateway.addPackingItem({ tripId, label });
              setCustomPacking("");
            });
          }}
        >
          <label>
            {t("planning.packing.custom")}
            <input
              required
              aria-describedby="custom-packing-hint"
              value={customPacking}
              onChange={(event) => setCustomPacking(event.target.value)}
            />
          </label>
          <small id="custom-packing-hint" className="voy-field-hint">
            {t("planning.packing.required")}
          </small>
          <Button
            type="submit"
            variant="secondary"
            busy={busy === "packing:new"}
            disabled={!customPacking.trim()}
          >
            {t("planning.packing.add")}
          </Button>
        </form>
        <ul className="voy-planning__checklist">
          {packingItems.map((item) => (
            <li key={item.id}>
              {editingPackingId === item.id ? (
                <label>
                  {t("planning.packing.nameLabel")}
                  <input
                    value={packingLabel}
                    onChange={(event) => setPackingLabel(event.target.value)}
                  />
                </label>
              ) : (
                <label>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(event) =>
                      void change(`packing:${item.id}`, () =>
                        gateway.updatePackingItem({
                          packingItemId: item.id,
                          label: item.label,
                          checked: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>{item.label}</span>
                </label>
              )}
              {editingPackingId === item.id ? (
                <Button
                  variant="ghost"
                  aria-label={t("planning.packing.saveLabel")}
                  busy={busy === `packing:${item.id}`}
                  onClick={() =>
                    void change(`packing:${item.id}`, async () => {
                      await gateway.updatePackingItem({
                        packingItemId: item.id,
                        label: packingLabel,
                        checked: item.checked,
                      });
                      setEditingPackingId(null);
                      setPackingLabel("");
                    })
                  }
                >
                  {t("planning.items.save")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  aria-label={t("planning.packing.renameLabel", {
                    name: item.label,
                  })}
                  onClick={() => {
                    setEditingPackingId(item.id);
                    setPackingLabel(item.label);
                  }}
                >
                  {t("planning.items.edit")}
                </Button>
              )}
              <ConfirmButton
                label={t("planning.remove")}
                ariaLabel={t("planning.removeNamed", { name: item.label })}
                busy={busy === `delete-packing:${item.id}`}
                onConfirm={() =>
                  change(`delete-packing:${item.id}`, () =>
                    gateway.deletePackingItem(item.id),
                  )
                }
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="manual-plan-title">
        <SectionTitle id="manual-plan-title" icon={<PlusIcon />}>
          {t("planning.items.title")}
        </SectionTitle>
        <p>{t("planning.items.intro")}</p>
        <form
          className="voy-planning__item-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) {
              setTitleError(true);
              titleInputRef.current?.focus();
              return;
            }
            const fields = {
              kind,
              title: title.trim(),
              ...(location.trim() ? { location } : {}),
              ...(startAt ? { startAt } : {}),
              ...(endAt ? { endAt } : {}),
              ...(itemNotes.trim() ? { notes: itemNotes } : {}),
              ...(selectedSavedPlaceId
                ? { savedPlaceId: selectedSavedPlaceId }
                : {}),
            };
            const key = editingItemId
              ? `trip-item:${editingItemId}`
              : "trip-item:new";
            void change(key, async () => {
              if (editingItemId) {
                await gateway.updateTripItem({
                  tripItemId: editingItemId,
                  ...fields,
                });
              } else {
                await gateway.createTripItem({ tripId, ...fields });
              }
              resetItemForm();
            });
          }}
        >
          <label>
            {t("planning.items.kind")}
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as TripItemKind)}
            >
              <option value="activity">{t("planning.items.activity")}</option>
              <option value="rail">{t("planning.items.rail")}</option>
              <option value="transfer">{t("planning.items.transfer")}</option>
            </select>
          </label>
          <label>
            {t("planning.items.name")}
            <input
              ref={titleInputRef}
              required
              aria-invalid={titleError || undefined}
              aria-describedby={
                titleError ? "trip-item-title-error" : undefined
              }
              value={title}
              onChange={(event) => {
                const next = event.target.value;
                setTitle(next);
                if (next.trim()) setTitleError(false);
              }}
            />
            {titleError ? (
              <span
                id="trip-item-title-error"
                className="voy-field-error"
                role="alert"
              >
                {t("planning.items.nameRequired")}
              </span>
            ) : null}
          </label>
          <label>
            {t("planning.items.location")}
            <input
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </label>
          <label>
            {t("planning.items.start")}
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </label>
          <label>
            {t("planning.items.end")}
            <input
              type="datetime-local"
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
            />
          </label>
          <label>
            {t("planning.items.notes")}
            <textarea
              value={itemNotes}
              onChange={(event) => setItemNotes(event.target.value)}
            />
          </label>
          <Button
            type="submit"
            variant="secondary"
            busy={
              busy ===
              (editingItemId ? `trip-item:${editingItemId}` : "trip-item:new")
            }
          >
            {editingItemId ? t("planning.items.save") : t("planning.items.add")}
          </Button>
          {editingItemId ? (
            <Button type="button" variant="ghost" onClick={resetItemForm}>
              {t("action.cancel")}
            </Button>
          ) : null}
        </form>
        <ul className="voy-planning__list">
          {tripItems.map((item) => (
            <li
              key={item.id}
              className="voy-planning__card"
              tabIndex={-1}
              data-search-source="trip_item"
              data-search-record={item.id}
              data-testid={`search-target-trip_item-${item.id}`}
            >
              <div>
                <strong>{item.title}</strong>
                <p>
                  {t(`planning.items.${item.kind}` as MessageKey)}
                  {item.location ? ` · ${item.location}` : ""}
                  {item.startAt
                    ? ` · ${formatDateTimeLocal(item.startAt)}`
                    : ""}
                </p>
              </div>
              <div className="voy-planning__actions">
                <Button
                  variant="ghost"
                  aria-label={t("planning.items.editLabel", {
                    name: item.title,
                  })}
                  onClick={() => {
                    setEditingItemId(item.id);
                    setKind(item.kind);
                    setTitle(item.title);
                    setLocation(item.location ?? "");
                    setStartAt(item.startAt ?? "");
                    setEndAt(item.endAt ?? "");
                    setItemNotes(item.notes ?? "");
                    setSelectedSavedPlaceId(item.savedPlaceId ?? null);
                    setTitleError(false);
                  }}
                >
                  {t("planning.items.edit")}
                </Button>
                <ConfirmButton
                  label={t("planning.remove")}
                  ariaLabel={t("planning.items.removeLabel", {
                    name: item.title,
                  })}
                  busy={busy === `delete-item:${item.id}`}
                  onConfirm={() =>
                    change(`delete-item:${item.id}`, () =>
                      gateway.deleteTripItem(item.id),
                    )
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {error ? (
        <p role="alert" className="voy-planning__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
