import { useEffect, useState } from "react";
import type { HealthResponse } from "@voyalier/contracts";
import markUrl from "@voyalier/brand/voyalier-mark.svg?url";

type ServiceState = "checking" | "connected" | "offline";

const productAreas = [
  ["Blueprint", "Decisions, confirmations, and the next three actions."],
  ["Discover", "Persona-aware ideas with sources and freshness."],
  ["Itinerary", "A realistic day plan with time and travel constraints."],
  ["Documents", "Local extraction with review before anything changes."],
  ["Readiness", "Entry, transit, health, weather, and logistics actions."],
  ["Share", "Redacted briefs, calendar files, and trip bundles."],
] as const;

export function App() {
  const [serviceState, setServiceState] = useState<ServiceState>("checking");

  useEffect(() => {
    const controller = new AbortController();
    const isTauri =
      window.location.protocol === "tauri:" ||
      window.location.hostname === "tauri.localhost";
    const healthUrl = isTauri
      ? "http://127.0.0.1:8787/api/health"
      : "/api/health";

    async function checkService() {
      try {
        const response = await fetch(healthUrl, { signal: controller.signal });
        if (!response.ok) throw new Error("Local service is unavailable");
        const health = (await response.json()) as HealthResponse;
        setServiceState(health.status === "ok" ? "connected" : "offline");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setServiceState("offline");
      }
    }

    void checkService();
    return () => controller.abort();
  }, []);

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Voyalier home">
          <img src={markUrl} alt="" />
          <span>Voyalier</span>
        </a>
        <span className={`service-pill service-pill--${serviceState}`}>
          <span aria-hidden="true" />
          {serviceState === "connected"
            ? "Local core ready"
            : serviceState === "checking"
              ? "Checking local core"
              : "Interface preview"}
        </span>
      </header>

      <section className="hero" id="top">
        <div className="hero__copy">
          <p className="eyebrow">A quiet place for the whole journey</p>
          <h1>From scattered plans to one clear journey.</h1>
          <p className="lede">
            Voyalier is becoming a private travel workspace for research,
            bookings, documents, readiness, and the plan you actually use.
          </p>
          <div className="hero__actions">
            <button type="button" disabled>
              Create a trip <span>Foundation preview</span>
            </button>
            <a href="https://github.com/udhawan97/Voyalier">
              Explore the source
            </a>
          </div>
        </div>
        <div className="hero__mark" aria-hidden="true">
          <img src={markUrl} alt="" />
        </div>
      </section>

      <section className="blueprint" aria-labelledby="blueprint-title">
        <div>
          <p className="eyebrow">The product contract</p>
          <h2 id="blueprint-title">One Blueprint, six calm surfaces.</h2>
        </div>
        <div className="area-grid">
          {productAreas.map(([name, description], index) => (
            <article key={name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{name}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <p>Local-first · Open source · Evidence before confidence</p>
        <p>Foundation build 0.1.0</p>
      </footer>
    </main>
  );
}
