import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AppError, Resource } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatInstantDate } from "../app/format";
import { t } from "../app/i18n";
import { useScopeKey } from "../app/revalidate";
import { useAsyncAction, useAsyncData } from "../app/useAsync";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";
import { Field } from "../components/fields";
import { CompassIcon } from "../components/icons";
import { Empty, SectionTitle, Skeleton } from "../components/primitives";

/**
 * A small piece of inline guidance: shown by default, dismissible, and gone for
 * the rest of the visit once dismissed.
 *
 * A `<p role="note">` rather than a dialog or a tooltip, so it is in the reading
 * order where it applies, reachable by keyboard, and readable by a screen reader
 * without anyone having to go hunting for a trigger. Exported because the chat
 * panel owes the traveler the same kind of sentence.
 */
export function Hint({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <p className="voy-field-hint" role="note">
      {children}{" "}
      <button
        type="button"
        className="voy-linkbtn"
        onClick={() => setShown(false)}
      >
        {t("hint.dismiss")}
      </button>
    </p>
  );
}

/** "kyoto, temples" → ["kyoto", "temples"]. Blank entries are dropped. */
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Map core's stable validation field to the quick-add control that owns it. */
function resourceFieldError(
  error?: AppError,
): { field: "tags"; message: string } | undefined {
  if (
    error?.code === "validation/invalid_input" &&
    error.details?.field === "tags"
  ) {
    return { field: "tags", message: t("resources.add.tagsInvalid") };
  }
  return undefined;
}

/**
 * One saved link: what it is, the traveler's own note, its tags, and the four
 * things they can do with it — read the stored copy, fetch one, edit, remove.
 *
 * Fetching is the only control here that can reach the network, so it exists
 * only while the traveler has allowed it. When they have not, the row says why
 * rather than showing a button that would refuse.
 */
function ResourceRow({
  resource,
  canFetch,
  onChanged,
}: {
  resource: Resource;
  canFetch: boolean;
  onChanged: () => void;
}) {
  const gateway = useGateway();
  const fieldId = useId();
  const [reading, setReading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(resource.title);
  const [note, setNote] = useState(resource.note);
  const [tags, setTags] = useState(resource.tags.join(", "));

  const fetchAction = useAsyncAction(
    () => gateway.fetchResourceDetails(resource.id),
    onChanged,
  );

  const saveAction = useAsyncAction(
    () =>
      gateway.updateResource({
        resourceId: resource.id,
        title: title.trim(),
        note: note.trim(),
        tags: parseTags(tags),
      }),
    () => {
      setEditing(false);
      onChanged();
    },
  );

  const removeAction = useAsyncAction(
    () => gateway.deleteResource(resource.id),
    onChanged,
  );

  const error = fetchAction.error ?? saveAction.error ?? removeAction.error;
  const snapshot = resource.snapshot;

  return (
    <li
      className="voy-doc"
      tabIndex={-1}
      data-search-source="resource"
      data-search-record={resource.id}
    >
      {editing ? (
        <div className="voy-form">
          <label htmlFor={`${fieldId}-title`}>
            {t("resources.add.titleLabel")}
          </label>
          <input
            id={`${fieldId}-title`}
            className="voy-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor={`${fieldId}-note`}>{t("resources.add.note")}</label>
          <textarea
            id={`${fieldId}-note`}
            className="voy-input voy-textarea"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <label htmlFor={`${fieldId}-tags`}>{t("resources.add.tags")}</label>
          <input
            id={`${fieldId}-tags`}
            className="voy-input"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
          <div className="voy-doc__actions">
            <Button
              variant="secondary"
              busy={saveAction.busy}
              disabled={!title.trim()}
              onClick={() => void saveAction.run()}
            >
              {t("resources.edit.save")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setTitle(resource.title);
                setNote(resource.note);
                setTags(resource.tags.join(", "));
              }}
            >
              {t("action.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="voy-doc__heading">
            <p className="voy-doc__label">
              {resource.url ? (
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {resource.title}
                  <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
                </a>
              ) : (
                resource.title
              )}
            </p>
            {resource.note ? (
              <p className="voy-doc__meta">{resource.note}</p>
            ) : null}
            {resource.tags.length > 0 ? (
              <ul
                className="voy-search__chips"
                aria-label={t("resources.tags.aria")}
              >
                {resource.tags.map((tag) => (
                  <li key={tag} className="voy-chip">
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}
            {snapshot ? (
              <p className="voy-doc__counts">
                {t("resources.read.fetched", {
                  date: formatInstantDate(snapshot.fetchedAt),
                })}
              </p>
            ) : null}
          </div>

          <div className="voy-doc__actions">
            {/* No aria-label here on purpose: this button's whole job is to
                report its own state, and an aria-label would hide the half of
                it that changes. */}
            {snapshot ? (
              <Button
                variant="ghost"
                onClick={() => setReading((open) => !open)}
              >
                {reading ? t("resources.read.hide") : t("resources.read")}
              </Button>
            ) : null}
            {/* The one network-touching control on this panel, so it is absent
                — not merely disabled — until fetching has been allowed. */}
            {resource.url && canFetch ? (
              <Button
                variant="ghost"
                busy={fetchAction.busy}
                aria-label={t("resources.fetch.actionLabel", {
                  title: resource.title,
                })}
                onClick={() => void fetchAction.run()}
              >
                {t("resources.fetch.action")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              aria-label={t("resources.edit.label", { title: resource.title })}
              onClick={() => setEditing(true)}
            >
              {t("resources.edit")}
            </Button>
            <ConfirmButton
              label={t("resources.remove")}
              ariaLabel={t("resources.remove.label", { title: resource.title })}
              busy={removeAction.busy}
              onConfirm={() => void removeAction.run()}
            />
          </div>

          {resource.url && !canFetch && !snapshot ? (
            <p className="voy-doc__meta">{t("resources.fetch.blocked")}</p>
          ) : null}

          {reading && snapshot ? (
            <div className="voy-doc__body">
              <p className="voy-doc__meta">
                {t("resources.read.fetched", {
                  date: formatInstantDate(snapshot.fetchedAt),
                })}
              </p>
              {snapshot.truncated ? (
                <p className="voy-doc__warn">{t("resources.read.truncated")}</p>
              ) : null}
              <pre aria-label={resource.title}>{snapshot.text}</pre>
              {resource.url ? (
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("resources.read.original")}
                  <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
                </a>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <p className="voy-field__error" role="alert">
          {describeError(error).title}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Trip-scoped research: the links a traveler keeps because they mean to read
 * them.
 *
 * The category matters more than the feature. Everything else on a trip page is
 * evidence the traveler confirmed; a saved page is not, and the panel says so in
 * as many words. Nothing here yields a candidate fact, becomes a booking, or
 * moves a readiness item — and one control, fetching a page's text, is the only
 * thing on the panel that can reach the network, so it stays behind a standing
 * permission the traveler grants and can withdraw.
 */
export function ResourcesPanel({ tripId }: { tripId: string }) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const fieldId = useId();
  // Through a scope, not a bare key: the workspace's Retry re-fetches every
  // scope on screen, and a panel that keeps its own key is invisible to it —
  // so a load that failed while the engine was down would keep saying so long
  // after the engine came back.
  const { status, data, error, reload } = useAsyncData(
    async () => {
      const [resources, settings] = await Promise.all([
        gateway.listResources(tripId),
        gateway.getResearchSettings(),
      ]);
      return { resources, settings };
    },
    useScopeKey(`resources:${tripId}`),
  );

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [submittedTags, setSubmittedTags] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const tagsRef = useRef<HTMLInputElement>(null);

  const addAction = useAsyncAction(
    () =>
      gateway.createResource({
        tripId,
        kind: "link",
        url: url.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(parseTags(tags).length > 0 ? { tags: parseTags(tags) } : {}),
      }),
    (created) => {
      // The store folds a link saved twice back onto the original and returns
      // it, so a create can legitimately answer with a row already on screen.
      // Appending it anyway would show the traveler two of their one link.
      const known = (data?.resources ?? []).some(
        (resource) => resource.id === created.id,
      );
      setDuplicate(known);
      if (!known) {
        announce(t("resources.announce.saved", { title: created.title }));
      }
      setUrl("");
      setTitle("");
      setNote("");
      setTags("");
      setSubmittedTags(null);
      reload();
    },
  );

  const settingsAction = useAsyncAction(
    (next: boolean) => gateway.setResearchSettings({ autoFetchDetails: next }),
    reload,
  );

  const resources = data?.resources ?? [];
  const addFieldError = resourceFieldError(addAction.error);
  const tagsError =
    addFieldError?.field === "tags" && submittedTags === tags
      ? addFieldError.message
      : undefined;

  useEffect(() => {
    if (tagsError) tagsRef.current?.focus();
  }, [tagsError]);

  const canFetch = data?.settings.autoFetchDetails === true;
  const allTags = [...new Set(resources.flatMap((resource) => resource.tags))];
  const shown =
    filter === null
      ? resources
      : resources.filter((resource) => resource.tags.includes(filter));

  return (
    <section className="voy-docs" aria-labelledby="resources-title">
      <SectionTitle id="resources-title" icon={<CompassIcon />}>
        {t("resources.title")}
      </SectionTitle>
      <p className="voy-docs__intro">{t("resources.intro")}</p>
      <Hint>{t("resources.hint.notEvidence")}</Hint>

      <form
        className="voy-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!url.trim()) return;
          setDuplicate(false);
          setSubmittedTags(tags);
          void addAction.run();
        }}
      >
        <h3>{t("resources.add.title")}</h3>
        <Hint>{t("resources.hint.import")}</Hint>
        <label htmlFor={`${fieldId}-url`}>{t("resources.add.url")}</label>
        <input
          id={`${fieldId}-url`}
          className="voy-input"
          type="url"
          required
          autoComplete="off"
          placeholder={t("resources.add.urlPlaceholder")}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <label htmlFor={`${fieldId}-title`}>
          {t("resources.add.titleLabel")}
        </label>
        <input
          id={`${fieldId}-title`}
          className="voy-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor={`${fieldId}-note`}>{t("resources.add.note")}</label>
        <textarea
          id={`${fieldId}-note`}
          className="voy-input voy-textarea"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <Field
          id={`${fieldId}-tags`}
          label={t("resources.add.tags")}
          hint={t("resources.add.tagsHint")}
          error={tagsError}
        >
          {(aria) => (
            <input
              id={`${fieldId}-tags`}
              ref={tagsRef}
              className="voy-input"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="secondary"
          busy={addAction.busy}
          disabled={!url.trim()}
        >
          {t("resources.add.save")}
        </Button>
        {duplicate ? (
          <p className="voy-doc__meta" role="status">
            {t("resources.duplicate")}
          </p>
        ) : null}
        {addAction.error && !addFieldError ? (
          <p className="voy-field__error" role="alert">
            {describeError(addAction.error).title}
          </p>
        ) : null}
      </form>

      {/* One standing permission rather than one per link: it is the same
          decision every time, and it has to be as easy to withdraw as it was
          to give. */}
      <div className="voy-docs__fetching">
        <Hint>{t("resources.hint.fetching")}</Hint>
        <label htmlFor={`${fieldId}-autofetch`}>
          <input
            id={`${fieldId}-autofetch`}
            type="checkbox"
            checked={canFetch}
            disabled={settingsAction.busy || !data}
            onChange={(event) => void settingsAction.run(event.target.checked)}
          />{" "}
          {t("resources.fetch.allow")}
        </label>
        <p className="voy-doc__meta">
          {canFetch ? t("resources.fetch.on") : t("resources.fetch.off")}
        </p>
        {settingsAction.error ? (
          <p className="voy-field__error" role="alert">
            {describeError(settingsAction.error).title}
          </p>
        ) : null}
      </div>

      {allTags.length > 0 ? (
        <div className="voy-search__suggestions">
          <ul
            className="voy-search__chips"
            aria-label={t("resources.filter.aria")}
          >
            <li>
              <button
                type="button"
                className="voy-search__chip"
                aria-pressed={filter === null}
                onClick={() => setFilter(null)}
              >
                {t("resources.filter.all")}
              </button>
            </li>
            {allTags.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  className="voy-search__chip"
                  aria-pressed={filter === tag}
                  onClick={() => setFilter(tag)}
                >
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {status === "loading" && !data ? (
        <Skeleton height="3rem" />
      ) : error ? (
        <p className="voy-docs__error" role="alert">
          {describeError(error).title}
        </p>
      ) : shown.length > 0 ? (
        <ul className="voy-docs__list" aria-label={t("resources.list.aria")}>
          {shown.map((resource) => (
            <ResourceRow
              key={resource.id}
              resource={resource}
              canFetch={canFetch}
              onChanged={reload}
            />
          ))}
        </ul>
      ) : (
        <Empty title={t("resources.empty")}>{t("resources.empty.hint")}</Empty>
      )}
    </section>
  );
}
