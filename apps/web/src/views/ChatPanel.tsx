import { useId, useState } from "react";
import type {
  ChatMessage,
  HighStakesTopic,
  LocalAiStatus,
} from "@voyalier/contracts";
import { MAX_CHAT_MESSAGE_CHARS, countChars } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError } from "../app/format";
import { plural, t, type MessageKey } from "../app/i18n";
import { chatScope, useScopeKey } from "../app/revalidate";
import { useAsyncAction, useAsyncData } from "../app/useAsync";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";
import { CpuIcon } from "../components/icons";
import { Empty, SectionTitle, Skeleton } from "../components/primitives";
import { Hint } from "../components/Hint";

/**
 * What Voyalier says for itself on a subject it refuses to be the authority on.
 *
 * An exhaustive `Record`, so adding a `HighStakesTopic` is a type error here
 * rather than a topic the interface silently has no answer for.
 */
const POINTER: Record<
  HighStakesTopic,
  { title: MessageKey; body: MessageKey }
> = {
  entry: { title: "chat.pointer.entry.title", body: "chat.pointer.entry.body" },
  health: {
    title: "chat.pointer.health.title",
    body: "chat.pointer.health.body",
  },
  safety: {
    title: "chat.pointer.safety.title",
    body: "chat.pointer.safety.body",
  },
  prices: {
    title: "chat.pointer.prices.title",
    body: "chat.pointer.prices.body",
  },
};

/** Ollama is not running, or could not be asked. Same answer either way. */
const NO_LOCAL_AI: LocalAiStatus = {
  provider: "ollama",
  available: false,
  models: [],
};

/**
 * One reply from the model, with everything Voyalier owes the traveler around
 * it: what it was grounded in, where the real authority lives on any high-stakes
 * subject it touched, and a way to keep it.
 *
 * The pointer cards sit *above* the reply and never replace it. Suppressing an
 * answer would be its own kind of claim — that Voyalier judged the model wrong —
 * and the honest move is to print both and name which one is authoritative.
 */
function AssistantTurn({
  tripId,
  message,
}: {
  tripId: string;
  message: ChatMessage;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [saved, setSaved] = useState(false);

  // There is deliberately no gateway method for this: a reply is not a new kind
  // of record, it is text the traveler chose to keep, so it goes where the rest
  // of their own words go.
  const saveAction = useAsyncAction(
    async () => {
      const notes = await gateway.getTripNotes(tripId);
      const body = notes.body.trim()
        ? `${notes.body}\n\n${message.text}`
        : message.text;
      await gateway.setTripNotes(tripId, body);
    },
    () => {
      setSaved(true);
      announce(t("chat.saveToNotes.done"));
    },
  );

  const sources = message.grounding.map((entry) => entry.label);
  const facts = message.itineraryFacts;

  return (
    <>
      {message.pointers.map((topic) => (
        <div key={topic} className="voy-chat__pointer" role="note">
          <strong>{t(POINTER[topic].title)}</strong>
          <p>{t(POINTER[topic].body)}</p>
        </div>
      ))}

      <p className="voy-chat__role">{t("chat.role.assistant")}</p>
      <p className="voy-chat__text">{message.text}</p>

      {/* Nothing to cite is said by saying nothing — an empty "Grounded on:"
          would read as a claim about the trip rather than about the answer. */}
      {sources.length > 0 || facts > 0 ? (
        <p className="voy-chat__grounding">
          {sources.length > 0
            ? t("chat.groundedOn", { sources: sources.join(", ") })
            : null}
          {sources.length > 0 && facts > 0 ? " · " : null}
          {facts > 0 ? plural("chat.itineraryFacts", facts) : null}
        </p>
      ) : null}

      <Button
        variant="ghost"
        busy={saveAction.busy}
        disabled={saved}
        onClick={() => void saveAction.run()}
      >
        {saved ? t("chat.saveToNotes.done") : t("chat.saveToNotes")}
      </Button>
      {saveAction.error ? (
        <p className="voy-field__error" role="alert">
          {t("chat.saveToNotes.error")}
        </p>
      ) : null}
    </>
  );
}

/**
 * An on-device conversation about one trip.
 *
 * Local only, by construction: Ollama answers, and if nothing is installed the
 * panel says so rather than quietly falling back to a cloud provider — a
 * per-message cloud consent is unusable and a standing one would be a change to
 * the trust contract, not a feature.
 *
 * The model reads the trip's own saved material. It does not read confirmation
 * codes or traveler names, which is why it cannot answer "what is my booking
 * reference" — a limit worth stating up front rather than letting the traveler
 * discover it as a bad answer.
 */
export function ChatPanel({
  tripId,
  onOpenSettings,
}: {
  tripId: string;
  onOpenSettings?: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const fieldId = useId();
  // Keyed through a scope rather than a bare string: the workspace's Retry
  // re-fetches every scope on screen, and a panel that keeps its own key is
  // invisible to it — so a load that failed while the engine was down would go
  // on saying so long after the engine came back.
  const { status, data, error, reload } = useAsyncData(
    async () => {
      const [messages, localAi] = await Promise.all([
        gateway.listChatMessages(tripId),
        // A runtime probe that fails is a runtime that is not there. It must
        // not take the whole thread down with it.
        gateway.detectLocalAi().catch(() => NO_LOCAL_AI),
      ]);
      return { messages, localAi };
    },
    useScopeKey(chatScope(tripId)),
  );

  const [draft, setDraft] = useState("");

  const sendAction = useAsyncAction(
    () => gateway.sendChatMessage(tripId, draft.trim()),
    () => {
      setDraft("");
      announce(t("chat.announce.reply"));
      // The reply comes back alone; the thread is what holds both turns.
      reload();
    },
  );

  const clearAction = useAsyncAction(
    () => gateway.clearChat(tripId),
    () => {
      announce(t("chat.announce.cleared"));
      reload();
    },
  );

  const messages = data?.messages ?? [];
  const available = data?.localAi.available === true;
  // Unicode characters, like the store counts them — `.length` would let a
  // message of emoji through and then fail on save.
  const tooLong = countChars(draft) > MAX_CHAT_MESSAGE_CHARS;

  return (
    <section className="voy-chat" aria-labelledby="chat-title">
      <SectionTitle id="chat-title" icon={<CpuIcon />}>
        {t("chat.title")}
      </SectionTitle>
      <p className="voy-chat__intro">{t("chat.intro")}</p>
      <Hint>{t("chat.hint.local")}</Hint>
      {/* Not conditional and not dismissible: it is Voyalier's standing
          position on model output, not a notice about a resolvable state. */}
      <p className="voy-chat__disclaimer" role="note">
        {t("chat.disclaimer")}
      </p>

      {status === "loading" && !data ? (
        <Skeleton height="6rem" />
      ) : error ? (
        <p className="voy-chat__error" role="alert">
          {describeError(error).title}
        </p>
      ) : (
        <>
          {messages.length > 0 ? (
            <ol className="voy-chat__thread" aria-label={t("chat.thread.aria")}>
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={`voy-chat__turn voy-chat__turn--${message.role}`}
                >
                  {message.role === "assistant" ? (
                    <AssistantTurn tripId={tripId} message={message} />
                  ) : (
                    <>
                      <p className="voy-chat__role">{t("chat.role.user")}</p>
                      <p className="voy-chat__text">{message.text}</p>
                    </>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <Empty title={t("chat.empty")} />
          )}

          {available ? (
            <form
              className="voy-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!draft.trim() || tooLong) return;
                void sendAction.run();
              }}
            >
              <label htmlFor={fieldId}>{t("chat.label")}</label>
              <textarea
                id={fieldId}
                className="voy-input voy-textarea"
                rows={3}
                value={draft}
                placeholder={t("chat.placeholder")}
                aria-invalid={tooLong || undefined}
                onChange={(event) => setDraft(event.target.value)}
              />
              {tooLong ? (
                <p className="voy-field__error" role="alert">
                  {t("chat.tooLong")}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                busy={sendAction.busy}
                disabled={!draft.trim() || tooLong}
              >
                {sendAction.busy ? t("chat.sending") : t("chat.send")}
              </Button>
              {sendAction.error ? (
                <p className="voy-field__error" role="alert">
                  {describeError(sendAction.error).title}
                </p>
              ) : null}
            </form>
          ) : (
            <div className="voy-chat__unavailable">
              <h3>{t("chat.unavailable.title")}</h3>
              <p>{t("chat.unavailable.body")}</p>
              {onOpenSettings ? (
                <button
                  type="button"
                  className="voy-linkbtn"
                  onClick={onOpenSettings}
                >
                  {t("chat.unavailable.link")}
                </button>
              ) : null}
            </div>
          )}

          {messages.length > 0 ? (
            <div className="voy-chat__actions">
              <ConfirmButton
                label={t("chat.clear")}
                busy={clearAction.busy}
                onConfirm={() => void clearAction.run()}
              />
              {clearAction.error ? (
                <p className="voy-field__error" role="alert">
                  {describeError(clearAction.error).title}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
