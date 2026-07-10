# Voyalier implementation prompt sequence

Use separate branches or worktrees for these lanes. Do not run two implementation agents against the same files at the same time. Each lane starts by reading `AGENTS.md`, the product brief, architecture, threat model, data-source policy, design system, roadmap, and relevant code.

## Prompt 1 — Codex: trusted first vertical slice

You are implementing Voyalier's first end-to-end vertical slice. Inspect the repository and write a short plan before editing. Preserve the selected React/Vite + Rust/Axum + Tauri architecture unless a concrete repository constraint proves it unworkable.

Build: create a trip; persist it locally in SQLite; calculate a deterministic Smart Blueprint; manually add one reservation; surface readiness gaps and itinerary conflicts; expose typed API contracts; and render the same state in browser and Tauri modes. Add migrations, fixture-backed tests, error states, and seed data. No LLM, scraping, live booking, or vector database belongs in this lane. Keep the loopback service private with a random port, per-launch bearer token, strict origin checks, and graceful shutdown. Document every new command and architectural decision. Run all checks and report exactly what was verified.

## Prompt 2 — Claude Code: product shell and visual system

You own the Voyalier product experience, not its backend architecture. Inspect the current design tokens, Wayline V mark, React shell, and product vocabulary, then propose the information architecture and component inventory before editing. Work only against the typed contracts provided by the vertical-slice branch.

Create a premium, calm, Japanese-influenced interface without copying Apple assets or using decorative cultural clichés. Implement Blueprint, Discover, Itinerary, Documents, Readiness, Share, and an offline Today view as coherent responsive states. Support light/dark/system themes, keyboard navigation, visible focus, screen readers, high contrast, reduced motion, loading/error/empty/offline states, and realistic dense trip data. Prefer CSS transforms and opacity for motion; enforce performance budgets and avoid animation libraries unless measured value justifies them. Reuse the existing Wayline V identity, refine it only with documented rationale, and do not silently replace product terms or data contracts. Add visual/component tests where the repo supports them.

## Prompt 3 — Codex: evidence, documents, and optional intelligence

Implement grounded intelligence only after the deterministic vertical slice is stable. Start with a threat and data-flow plan. Add a versioned evidence record containing source URL/identity, publisher, retrieval time, observed validity, license/attribution, excerpt hash, confidence, corroboration count, locale, and freshness state.

Add local import and review for one representative confirmation PDF plus structured calendar/email fixtures. Treat extracted facts as untrusted until user approval. Implement FTS5 retrieval first, with interfaces for optional local embeddings. Add provider adapters for OpenAI, Anthropic, and Ollama behind one structured-output contract, explicit consent, redaction preview, budget limits, timeouts, and provenance-preserving citations. API keys must use OS secret storage and must never reach frontend storage or logs. Prompt-injected document text cannot issue tool calls or override system policy. Add evaluation fixtures that compare deterministic-only output with AI-enhanced output. Do not add live flight/hotel aggregation until a provider's license and access terms are documented.

## Prompt 4 — independent audit and release hardening

Act as an adversarial release reviewer. Begin read-only. Audit the combined branch against the product brief, architecture, threat model, data-source policy, accessibility requirements, and release checklist. Confirm findings with file-and-line evidence; distinguish blockers from enhancements.

Focus on data loss, migrations, secret leakage, loopback exposure, malicious documents, prompt injection, citation loss, stale travel facts, offline behavior, PDF redaction, accessibility, motion, performance, macOS/Windows packaging, updater trust, license attribution, and misleading visa/safety/price language. Run the full test/build matrix and exercise the real browser and desktop shells with fixtures. After presenting the confirmed findings and a fix plan, implement only approved in-scope fixes. Finish with residual risks, checks run, artifacts produced, and a clear ship/no-ship recommendation.

## Merge order

1. Merge the trusted vertical slice.
2. Rebase and merge the product shell.
3. Add evidence/documents/intelligence behind feature flags.
4. Run the independent audit before any public beta tag.

This sequence keeps the proof of concept resume-worthy while preventing the LLM layer from becoming the product's untestable foundation.
