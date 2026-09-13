import { ThemeToggle } from "../components/ThemeToggle";
import { ArrowLeftIcon, SunIcon } from "../components/icons";
import { SectionTitle } from "../components/primitives";
import { t } from "../app/i18n";
import { AiPromptSettings } from "./AiPromptSettings";
import { AiProviders } from "./AiProviders";
import { OnDeviceAi } from "./OnDeviceAi";
import { BackupPanel } from "./BackupPanel";
import { UpdatesPanel } from "./UpdatesPanel";
import { VaultPanel } from "./VaultPanel";
import { DataSources } from "./DataSources";
import { LocaleSettings } from "./LocaleSettings";
import { GuideIndex } from "./GuideIndex";

type MotionPreference = "system" | "reduced" | "full";

function MotionSettings() {
  const [motion, setMotion] = useState<MotionPreference>(() => {
    const stored = globalThis.localStorage?.getItem("voyalier.motion");
    return stored === "reduced" || stored === "full" ? stored : "system";
  });
  useEffect(() => {
    globalThis.localStorage?.setItem("voyalier.motion", motion);
    if (motion === "system") {
      document.documentElement.removeAttribute("data-voy-motion");
    } else {
      document.documentElement.dataset.voyMotion = motion;
    }
  }, [motion]);
  return (
    <fieldset className="voy-segmented" aria-describedby="motion-hint">
      <legend>Motion</legend>
      <p className="voy-settings__hint" id="motion-hint">
        Reduced disables the atlas route reveal and depth transitions. System
        follows macOS or browser accessibility settings.
      </p>
      {(["system", "reduced", "full"] as const).map((value) => (
        <label key={value}>
          <input
            type="radio"
            name="motion-preference"
            value={value}
            checked={motion === value}
            onChange={() => setMotion(value)}
          />
          <span>{value[0].toUpperCase() + value.slice(1)}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Every workspace-wide surface in one place.
 *
 * These panels used to be scattered: Updates and Encryption sat at the bottom of
 * the home list, while the three AI panels re-mounted inside *every* trip. That
 * left a real hole — with no trips, AI could not be configured at all, because
 * its only entry point lived inside a trip that did not exist. Settings is
 * reachable from the topbar on any screen, so configuration no longer depends on
 * having created something first.
 *
 * Trip-scoped surfaces deliberately stay on the trip page; this view holds only
 * what applies to the whole workspace.
 */
export function SettingsView({ onBack }: { onBack: () => void }) {
  return (
    <div className="voy-settings">
      <button type="button" className="voy-back" onClick={onBack}>
        <ArrowLeftIcon aria-hidden="true" />
        <span>{t("settings.back")}</span>
      </button>
      <h1 className="voy-settings__title" data-voy-view-heading tabIndex={-1}>
        {t("settings.title")}
      </h1>
      <p className="voy-settings__intro">{t("settings.intro")}</p>

      <section
        className="voy-settings__section"
        aria-labelledby="appearance-title"
      >
        <SectionTitle id="appearance-title" icon={<SunIcon />}>
          {t("settings.appearance")}
        </SectionTitle>
        <p className="voy-settings__hint">{t("settings.appearance.hint")}</p>
        <ThemeToggle />
        <MotionSettings />
      </section>

      <LocaleSettings />

      <GuideIndex />

      <OnDeviceAi />

      <AiProviders />

      <AiPromptSettings />

      <UpdatesPanel />

      <VaultPanel />

      <DataSources />

      <BackupPanel />
    </div>
  );
}
import { useEffect, useState } from "react";
