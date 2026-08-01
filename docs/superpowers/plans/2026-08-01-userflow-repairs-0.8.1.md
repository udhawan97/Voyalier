# Audited user-flow repairs (0.8.1)

A browser audit of 0.8.0 (`310c562`) exercised five connected journeys against the real loopback
Axum service and a disposable SQLite workspace: trip creation and re-entry, confirmation import and
review, planning and saved reading, visa preparation, and Settings/offline recovery. The audit ran
at 320, 375, 768, and 1280 CSS pixels in light and dark themes. It found five reproducible web gaps.

The standalone HTML audit is temporary and stays outside the repository. This plan is the durable
record of the gaps, their root causes, the implementation boundary, and the release acceptance
checks.

## Product and architecture boundary

All five defects are web presentation or interaction defects. Core already returns the relevant
validation field in `AppError.details`, and no wire, storage, transport, provider, or domain-contract
change is required. The fixes therefore remain in `apps/web`, reuse the shared gateway error shape,
and preserve the existing local-first and visa non-authority language.

## Gaps and dispositions

### G1 — mobile theme radios lose their accessible names

`ThemeToggle` relies on its visible text for the radio name, while the mobile stylesheet removes
that text with `display: none`. At 320 and 375 pixels the accessibility tree exposes three unnamed
radios in both the top bar and Settings.

Each radio receives an explicit localized `aria-label`. The existing roving tab stop, arrow-key
behavior, visible icons, theme persistence, and desktop labels remain unchanged.

### G2 — Resource and Planning validation discards field-level recovery

Core returns `details.field = "tags"` for invalid resource tags and `details.field = "endAt"` for
an activity ending before it starts. The two views flatten those errors to the banner title
“Check the highlighted fields,” but mark no field invalid. Planning also offers Retry for invalid
input, which can only repeat the same request.

Resource maps a tags validation error to one actionable localized rule covering both shipped tag
limits, connects it to the field with `aria-describedby`, marks the field invalid, and focuses it.
Planning retains the normalized `AppError`, maps validation errors to the relevant activity field,
focuses that field, and omits Retry for deterministic validation codes. Retry remains for failures
that can succeed without changing input.

### G3 — an offline nationality save accuses valid input

The visa nationality form maps every `save.error` to the ISO two-letter validation message. A valid
`US` value therefore becomes `aria-invalid` when the loopback engine is unavailable, contradicting
the global transport banner.

Only local validation and server validation codes produce the field error. Transport failure stays
owned by the global offline banner; other non-validation failures receive truthful local banner
copy. The field value and the existing successful-recovery behavior are preserved.

### G4 — the last section destination is invisible at 320 pixels

The trip section rail is horizontally scrollable, but at 320 pixels the AI chip begins entirely
outside the viewport with no visible continuation cue. At 375 pixels all five chips fit.

The rail measures its own overflow and exposes a real, keyboard-operable “Show more trip sections”
control only while content remains to the right. Activating it scrolls the rail; scrolling to the
end removes it. Existing anchor, hash, sticky, and `aria-current` behavior remains authoritative.

### G5 — visa progress calls a checklist subset all steps

The progress denominator intentionally counts only journey steps with checkable documents, so a
four-step Australia journey can truthfully have one completable checklist group. The sentence calls
that subset “steps,” producing “0 of 1 steps” immediately above four numbered steps.

The progress copy names the count as a checklist and separately states the number of guide steps.
English and Spanish messages use singular/plural variants without changing readiness semantics or
the definition of a completable step.

## Sequence

1. `Docs:` commit this plan before implementation.
2. `Web:` add focused regression tests, implement all five fixes, and re-run the audit reproductions.
3. `Docs:` add the user-facing changelog and release notes, then synchronize version 0.8.1 in all
   four required files.
4. Refresh Graphify and verify a scoped query, run the full local release gate, merge the branch to
   `main`, push `main`, tag `v0.8.1`, and wait for the protected release workflow.
5. Inspect and publish the draft only after both platform assets, signatures, checksums,
   `latest.json`, provenance, public URLs, live docs, and tag/main alignment pass.

## Verification

- Theme: both component instances expose Light, System, and Dark names at mobile widths; arrow keys
  still move selection and focus.
- Resource: an invalid tags response marks and focuses Tags, explains the limits, retains values,
  and clears after correction.
- Planning: an end-before-start response marks and focuses End, retains values, and renders no
  Retry; a retryable error still offers Retry.
- Visa error classification: valid `US` never becomes invalid after `transport/failure`; the global
  recovery path remains the single transport owner.
- Section nav: the continuation control exists only when the rail overflows, is named and keyboard
  operable, and disappears at the end or when all chips fit.
- Visa progress: the Australia route distinguishes one checklist group from four guide steps in
  English and Spanish; existing completion calculation remains unchanged.
- Focused Vitest files while iterating, then `make check`, `git diff --check`, `pnpm audit --prod`,
  the credential-string scan from `security-hygiene.yml`, and `scripts/check.sh integration`.
- Real Chromium audit at 320, 375, 768, and 1280 pixels in both themes, plus the exact desktop
  release candidate on macOS after the CI-produced artifact is available.

Not expanded in this patch: contract methods, database migrations, provider behavior, live visa
eligibility, city-pack contents, or autonomous actions.
