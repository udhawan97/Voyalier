import { t } from "../app/i18n";
import {
  getLocalePreference,
  setLocalePreference,
  type LocalePreference,
} from "../app/locale";
import { SectionTitle } from "../components/primitives";
import { CompassIcon } from "../components/icons";

export function LocaleSettings() {
  return (
    <section className="voy-settings__section" aria-labelledby="language-title">
      <SectionTitle id="language-title" icon={<CompassIcon />}>
        {t("settings.language")}
      </SectionTitle>
      <p className="voy-settings__hint">{t("settings.language.hint")}</p>
      <label>
        <span className="voy-sr-only">{t("settings.language")}</span>
        <select
          value={getLocalePreference()}
          onChange={(event) =>
            setLocalePreference(event.target.value as LocalePreference)
          }
        >
          <option value="system">{t("settings.language.system")}</option>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </label>
    </section>
  );
}
