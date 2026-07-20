import register from "@voyalier/contracts/parity/data-sources.json";

import { t, type MessageKey } from "../app/i18n";
import { SectionTitle } from "../components/primitives";
import { CompassIcon } from "../components/icons";

type SourceCategory = (typeof register.sources)[number]["category"];

const GROUPS: Array<{
  category: SourceCategory;
  label:
    | "dataSources.group.builtIn"
    | "dataSources.group.consentFetched"
    | "dataSources.group.offlineDownloads"
    | "dataSources.group.optionalAi";
}> = [
  { category: "built_in", label: "dataSources.group.builtIn" },
  {
    category: "consent_fetched",
    label: "dataSources.group.consentFetched",
  },
  {
    category: "offline_download",
    label: "dataSources.group.offlineDownloads",
  },
  { category: "optional_ai", label: "dataSources.group.optionalAi" },
];

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
        {GROUPS.map((group) => {
          const sources = register.sources.filter(
            (source) => source.category === group.category,
          );
          return (
            <section key={group.category} className="voy-data-sources__group">
              <h3>{t(group.label)}</h3>
              <ul className="voy-data-sources__list">
                {sources.map((source) => (
                  <li key={source.id}>
                    <h4>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.name}
                      </a>
                    </h4>
                    <p>
                      <strong>{t("dataSources.use")}</strong>{" "}
                      {t(`dataSources.${source.id}.use` as MessageKey)}
                    </p>
                    <p>
                      <strong>{t("dataSources.license")}</strong>{" "}
                      {source.license}
                    </p>
                    <p>{source.attribution}</p>
                    <p>{t(`dataSources.${source.id}.network` as MessageKey)}</p>
                    <p>
                      {t(`dataSources.${source.id}.authority` as MessageKey)}
                    </p>
                    <p>
                      <strong>{t("dataSources.endpoint")}</strong>{" "}
                      <code>{source.endpoint}</code>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </details>
    </section>
  );
}
