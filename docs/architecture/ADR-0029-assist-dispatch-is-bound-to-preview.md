# ADR-0029: Assist dispatch is bound to preview

Status: accepted, 2026-10-08

Extends ADR-0003 and ADR-0012. Addresses DR-ea305767-013.

## Evidence

A contained public-interface probe at audited application source 4b3d3b7 used two
AppService sessions, disposable SQLite, shipped FakeFetcher and MemorySecretStore.
After preview, separate confirmed-fact, model and instruction changes appeared
in the synthetic OpenAI request body despite being absent from the displayed
preview. The unchanged control matched. No real provider call or disclosure was
performed; redaction remained intact.

## Decision

AppService issues an `approvalToken` alongside the redacted assist preview.
Pure core builders do not issue tokens. The versioned commitment covers trip,
operation/provider, effective URL, resolved model and the exact credential-free
serialized request body. It never includes auth headers or key material and is
not logged as activity. No preview cache or new persistence is introduced.

Run requires the displayed preview's token. It prepares the current request
once, compares its commitment before key retrieval/network dispatch, and refuses
a missing or changed token with a fresh-preview action and no activity entry.
After approval validation, the same prepared request receives only auth headers
through an inherent core method; URL, model and body bytes remain unchanged.
There is no second body build between validation and dispatch.

The explicit Send/Run click remains the consent action. A commitment binds
content; it is not authentication or proof that a person read it. The client
cannot submit arbitrary prompt text as approved content. Changed content must
be previewed and explicitly sent again; the UI never refreshes and dispatches
automatically. Provider/trip changes invalidate displayed consent. Loading and
sending are mutually exclusive, and stale/unmounted completions cannot affect
another trip's UI.

## Compatibility and scope

Preview's token is additive/optional for older readers and pure/local-draft
builders. `runAssist` requires it in current TypeScript callers. HTTP/Tauri
accept omitted input only to return a clear fail-closed domain error for older
clients; this intentionally tightens the existing versioned run contract.
No unguarded legacy cloud dispatch route remains. The route manifest is edited
by hand and typed wire fixtures cover both transports.

This guard covers itinerary assist for all its existing providers, including
local Ollama. The distinct lodging-dates draft remains local-only and outside
this cloud-consent correction; it must not claim immutable preview binding.
Redaction, reply bounds, provider protocol ownership and metadata-only activity
logging remain unchanged. Credentials continue to enter only outgoing headers.

## Verification

Unchanged approval dispatches exact body bytes. Fact/model/instruction changes,
wrong trip/provider, malformed and missing legacy tokens reject with zero POST
and no activity; renewed preview succeeds. Header attachment preserves prepared
URL/model/body and enforces provider key policy. UI preserves the shown request,
requires deliberate refresh/review/send, and handles navigation/loading races.

## Amendment — credential-bearing requests do not redirect (2026-10-21)

Provider validation GET and assist POST refuse redirects in the production HTTP
adapter before contacting a second destination. The fixed endpoint is part of
the approved request boundary; the HTTP client's default removal of Authorization
does not protect Anthropic's custom `x-api-key` header. A redirect returns a safe
provider error without its destination, credentials, or response body.

Verify 301/302/307/308 with two disposable loopback listeners and synthetic
credentials for both methods. The second listener must receive no request;
successful responses, provider error parsing, exact prepared request bytes and
response-size limits remain unchanged. No real provider or credential is used.
