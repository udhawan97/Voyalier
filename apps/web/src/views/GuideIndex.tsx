import { CompassIcon } from "../components/icons";
import { SectionTitle } from "../components/primitives";

const GUIDES = [
  {
    title: "Plan from the cockpit",
    body: "Set the group, work through next actions, compare providers, and bring final confirmations back.",
    href: "https://udhawan97.github.io/Voyalier/guides/concierge-cockpit/",
  },
  {
    title: "Save an undated trip idea",
    body: "Keep a route without inventing dates, then convert it when the travel window is real.",
    href: "https://udhawan97.github.io/Voyalier/guides/trip-ideas/",
  },
  {
    title: "Choose an area",
    body: "Compare islands or neighborhoods by fit, tradeoff, and a source you can verify.",
    href: "https://udhawan97.github.io/Voyalier/guides/choose-an-area/",
  },
  {
    title: "Use provider handoffs",
    body: "Carry a brief out, record the return, and import the confirmation without inferring a booking.",
    href: "https://udhawan97.github.io/Voyalier/guides/provider-handoffs/",
  },
  {
    title: "Prepare each traveler",
    body: "Follow conditional entry, biometrics, decision, passport-return, and onward-route steps.",
    href: "https://udhawan97.github.io/Voyalier/guides/per-person-entry/",
  },
  {
    title: "Build the document wallet",
    body: "Store encrypted PDF and image originals and link them to people and tasks.",
    href: "https://udhawan97.github.io/Voyalier/guides/document-wallet/",
  },
  {
    title: "Track exact currencies",
    body: "Separate estimates, commitments, and refunds with the correct currency precision.",
    href: "https://udhawan97.github.io/Voyalier/guides/money-ledger/",
  },
  {
    title: "Prepare travel day",
    body: "Assemble reviewed confirmations, transfers, originals, and available offline packs.",
    href: "https://udhawan97.github.io/Voyalier/guides/travel-day-offline/",
  },
] as const;

export function GuideIndex() {
  return (
    <section
      className="voy-settings__section"
      aria-labelledby="guide-index-title"
    >
      <SectionTitle id="guide-index-title" icon={<CompassIcon />}>
        Guides
      </SectionTitle>
      <p className="voy-settings__hint">
        Open a focused walkthrough when a trip step needs more context.
      </p>
      <div className="voy-guide-index">
        {GUIDES.map((guide) => (
          <article key={guide.href}>
            <strong>{guide.title}</strong>
            <span>{guide.body}</span>
            <a href={guide.href} target="_blank" rel="noreferrer noopener">
              Read guide
              <span className="voy-sr-only"> Opens in a new tab</span>
            </a>
          </article>
        ))}
      </div>
      <p className="voy-guide-index__credit">
        Planning and offline travel patterns were studied from{" "}
        <a
          href="https://github.com/KDE/itinerary"
          target="_blank"
          rel="noreferrer noopener"
        >
          KDE Itinerary
        </a>
        ,{" "}
        <a
          href="https://github.com/seanmorley15/AdventureLog"
          target="_blank"
          rel="noreferrer noopener"
        >
          AdventureLog
        </a>
        ,{" "}
        <a
          href="https://github.com/open-wanderer/wanderer"
          target="_blank"
          rel="noreferrer noopener"
        >
          wanderer
        </a>
        ,{" "}
        <a
          href="https://github.com/organicmaps/organicmaps"
          target="_blank"
          rel="noreferrer noopener"
        >
          Organic Maps
        </a>
        ,{" "}
        <a
          href="https://github.com/opentripplanner/OpenTripPlanner"
          target="_blank"
          rel="noreferrer noopener"
        >
          OpenTripPlanner
        </a>
        , and{" "}
        <a
          href="https://github.com/liketrek/TREK"
          target="_blank"
          rel="noreferrer noopener"
        >
          TREK
        </a>
        . No code or assets were copied.
      </p>
    </section>
  );
}
