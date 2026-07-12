import { useEffect, useState } from "react";
import type {
  AiPrompt,
  AiPromptKind,
  AiPromptSettings as AiPromptSettingsData,
  AppError,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { t, type MessageKey } from "../app/i18n";
import { Button } from "../components/Button";
import { TextArea } from "../components/fields";

const KIND_LABEL: Record<AiPromptKind, MessageKey> = {
  assist: "prompts.kind.assist",
  draft_lodging_dates: "prompts.kind.draft_lodging_dates",
};
const KIND_DESC: Record<AiPromptKind, MessageKey> = {
  assist: "prompts.desc.assist",
  draft_lodging_dates: "prompts.desc.draft_lodging_dates",
};

function PromptRow({
  prompt,
  onChanged,
}: {
  prompt: AiPrompt;
  onChanged: (settings: AiPromptSettingsData) => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const isCustom = prompt.customText != null;
  const [text, setText] = useState(prompt.customText ?? prompt.defaultText);
  const [busy, setBusy] = useState<null | "save" | "reset">(null);
  const [error, setError] = useState(false);
  const name = t(KIND_LABEL[prompt.kind]);
  // Disable Save when blank or unchanged from the effective instruction.
  const effective = (prompt.customText ?? prompt.defaultText).trim();
  const unchanged = text.trim() === "" || text.trim() === effective;

  async function save() {
    setError(false);
    setBusy("save");
    try {
      onChanged(await gateway.setAiPrompt(prompt.kind, text));
      announce(t("prompts.announce.saved", { name }));
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setError(false);
    setBusy("reset");
    try {
      const settings = await gateway.setAiPrompt(prompt.kind, null);
      setText(prompt.defaultText);
      onChanged(settings);
      announce(t("prompts.announce.reset", { name }));
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="voy-prompt">
      <div className="voy-prompt__head">
        <span className="voy-prompt__name">{name}</span>
        <span
          className={`voy-prompt__badge voy-prompt__badge--${
            isCustom ? "custom" : "default"
          }`}
        >
          {isCustom ? t("prompts.badge.custom") : t("prompts.badge.default")}
        </span>
      </div>
      <TextArea
        id={`prompt-${prompt.kind}`}
        label={name}
        hint={t(KIND_DESC[prompt.kind])}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={5}
      />
      {error ? (
        <p className="voy-prompt__error" role="alert">
          {t("prompts.error")}
        </p>
      ) : null}
      <div className="voy-prompt__actions">
        <Button
          variant="secondary"
          busy={busy === "save"}
          disabled={busy !== null || unchanged}
          onClick={save}
        >
          {t("prompts.save")}
        </Button>
        <Button
          variant="ghost"
          busy={busy === "reset"}
          disabled={busy !== null || !isCustom}
          onClick={reset}
        >
          {t("prompts.reset")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Advanced settings to edit the AI system instructions. The date draft's output
 * is still schema-locked regardless of the instruction, so editing it can't make
 * the app accept anything but dates; the assist instruction is the softer
 * guardrail, and replies stay marked as non-authoritative either way.
 */
export function AiPromptSettings() {
  const gateway = useGateway();
  const [settings, setSettings] = useState<AiPromptSettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await gateway.getAiPrompts();
        if (!cancelled) setSettings(result);
      } catch (caught) {
        if (!cancelled) setError((caught as AppError).code);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  return (
    <section className="voy-prompts" aria-labelledby="prompts-title">
      <h2 id="prompts-title" className="voy-prompts__title">
        {t("prompts.title")}
      </h2>
      <p className="voy-prompts__intro">{t("prompts.intro")}</p>

      {settings ? (
        <div className="voy-prompts__list">
          {settings.prompts.map((prompt) => (
            <PromptRow
              key={prompt.kind}
              prompt={prompt}
              onChanged={setSettings}
            />
          ))}
        </div>
      ) : error ? (
        <p className="voy-prompts__error" role="alert">
          {t("prompts.error")}
        </p>
      ) : null}

      <p className="voy-prompts__scope">{t("prompts.scope")}</p>
    </section>
  );
}
