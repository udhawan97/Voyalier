# Use Voyalier in Spanish

Status: ready for implementation

## Trigger

The app starts with a supported system language or the traveler changes the
language in Settings.

## Outcome

The complete application interface renders in reviewed Spanish or English while
dates, numbers, plurals, accessibility labels, and stored trip data remain
correct and unchanged.

## Confirmed behavior

- v0.5.0 ships English and Spanish. Spanish is a complete catalog with the exact
  same message keys, interpolation variables, and plural bases as English.
- Default selection follows the system/browser language on first launch. A
  Settings choice of **System**, **English**, or **Español** persists locally and
  applies immediately without restarting.
- Locale choice is interface preference, not trip data. It uses local browser/
  webview storage, is excluded from workspace backups, and triggers no network.
- Dates, times, numbers, and plural selection use the chosen locale. Stored
  source text, traveler-entered text, airport codes, provider model names, and
  official-source wording are never translated.
- Missing keys fail tests. Runtime fallback to English remains defensive, not a
  way to ship an incomplete locale.
- Language selection is keyboard/screen-reader accessible and keeps focus after
  the interface rerenders.

## Boundaries

- Voyalier does not machine-translate government advisories, documents, model
  output, pack prose, or traveler content.
- Spanish copy preserves the same authority limits and consent language; it does
  not soften warnings or add capabilities.
- The public docs remain English in this release; only application UI is in
  scope, and the docs state that boundary.

## Checkpoint

The Settings selection is the only checkpoint. System-language detection occurs
locally and requires no consent.

## Verification

- Type tests enforce complete key and placeholder parity.
- Plural/date/number tests use literal Spanish examples and a fixed UTC date.
- React tests switch languages, verify immediate visible copy, keyboard focus,
  persistence after remount, and unchanged source/traveler text.
- The browser workflow exercises both languages at 200% zoom; packaged desktop
  smoke testing verifies the persisted selection.

## Definition of done

Every application message is available in reviewed Spanish, the choice is local
and persistent, formatting follows the selected locale, untranslated evidence
stays verbatim, and accessibility/release gates pass.
