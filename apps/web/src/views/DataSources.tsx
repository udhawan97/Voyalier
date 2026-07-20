import register from "@voyalier/contracts/parity/data-sources.json";

import { t } from "../app/i18n";
import { SectionTitle } from "../components/primitives";
import { CompassIcon } from "../components/icons";

export function DataSources() {
  return (
    <section
      className="voy-settings__section voy-data-sources"
      aria-labelledby="data-sources-title"
    >
      <SectionTitle id="data-sources-title" icon={<CompassIcon />}>
        {t("dataSources.title")}
      </SectionTitle>
      <p className="voy-settings__hint">{t("dataSources.intro")}</p>
      <details>
        <summary>{t("dataSources.show")}</summary>
        <ul className="voy-data-sources__list">
          {register.sources.map((source) => (
            <li key={source.id}>
              <h3>{source.name}</h3>
              <p>
                <strong>{t("dataSources.use")}</strong> {source.use}
              </p>
              <p>
                <strong>{t("dataSources.license")}</strong> {source.license}
              </p>
              <p>{source.attribution}</p>
              <p>{source.network}</p>
              <p>{source.authority}</p>
              <code>{source.endpoint}</code>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
