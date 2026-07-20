# Review Voyalier data sources and licenses

Status: ready for implementation

## Trigger

The traveler opens **Data sources & licenses** from Settings or follows a source
link from a feature panel.

## Outcome

The traveler can see what data Voyalier bundles or contacts, under which terms,
what leaves the device, how fresh retrieved data can be, and what authority the
source does or does not have.

## Confirmed behavior

- A single shared data-source register lists bundled datasets, consent-gated
  remote sources, GitHub-hosted city packs/maps, and optional AI providers.
- Each entry has a stable id, display name, category, human source URL, license
  or terms label, attribution, network posture, and a short authority boundary.
- The screen groups entries by **Built in**, **Fetched when you ask**, **Offline
  downloads**, and **Optional AI**. It never collapses those into one trust score.
- Pack-specific layers continue to show their own manifests; the register links
  to that model instead of pretending Overture and Wikivoyage share a license.
- The shared register is held by Rust and TypeScript parity tests so application
  sources cannot drift silently from the traveler-facing list.
- The feature is available with no trip and makes no network request merely by
  opening it.

## Boundaries

- License text is descriptive, not legal advice.
- Official sources are named individually; government advisory levels remain
  semantically non-comparable.
- The register records current product behavior and must not advertise planned
  providers or datasets as shipped.

## Checkpoint

None. This is a read-only transparency surface. Following an external link uses
the normal browser checkpoint; fetching data still happens only in its feature.

## Verification

- Shared golden data has exact-case pins in Rust and TypeScript.
- Tests assert every current network/source constant maps to a register entry.
- React and axe tests verify groups, accessible links, and empty-network behavior.
- Docs and README link to the same source-policy language.

## Definition of done

Every shipped data edge is represented honestly in one accessible, offline
screen, and parity checks make omissions fail the repository gate.
