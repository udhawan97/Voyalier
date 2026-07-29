//! `AppService` — visa preparation: ADR-0006's pointers, never answers.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    /// Replace a trip's notes. Clearing them removes the row rather than storing
    /// an empty string, so "no notes" is one state and not two.
    /// A trip's visa preparation: the curated journey for the stored passport,
    /// plus the traveler's own progress.
    ///
    /// The two are returned together so a caller cannot pair a journey with
    /// another trip's checkboxes. Nothing here decides whether a visa is needed
    /// -- per ADR-0006 the entry path is quoted from the destination authority
    /// with its source and date, and an uncurated or conditional pair yields no
    /// journey rather than a guess.
    pub fn get_visa_prep(&self, trip_id: &str) -> Result<VisaPrep, AppError> {
        let connection = self.connection()?;
        let records = self.records(&connection);
        let trip = records.trip(trip_id)?;
        let items = records.visa_prep_items(trip_id)?;
        let Some(nationality_iso2) = records.visa_nationality(trip_id)? else {
            return Ok(VisaPrep {
                trip_id: trip_id.to_owned(),
                nationality_iso2: None,
                suggested_nationality_iso2: records.latest_visa_nationality()?,
                entry_path: None,
                journey: None,
                items,
            });
        };

        let destination = self.destination_country(&connection, &trip)?;
        let (entry_path, journey) = match destination {
            // Core now answers `None` for an uncurated destination too, so the
            // two ways of having no authority to quote — we could not work out
            // the country, and we have not curated the country we did work out
            // — arrive here as the same absence rather than one of them wearing
            // Canada's name (ADR-0006, amended 2026-07-29).
            Some(ref code) => (
                voyalier_core::entry_path(code, &nationality_iso2),
                voyalier_core::visa_journey(code, &nationality_iso2),
            ),
            // Without a resolved destination country there is nothing to quote,
            // and inventing one would be the exact overreach ADR-0006 forbids.
            None => (None, None),
        };

        Ok(VisaPrep {
            trip_id: trip_id.to_owned(),
            nationality_iso2: Some(nationality_iso2),
            suggested_nationality_iso2: None,
            entry_path,
            journey,
            items,
        })
    }

    /// The traveler's own visa-prep tally for the readiness line, or `None` when
    /// no journey resolves. Counts steps whose documents are all ticked, so it
    /// matches what the cockpit shows rather than counting documents twice.
    /// `pub(crate)` rather than private only because ADR-0010 put its one
    /// caller, `get_trip`, in a sibling module. Still crate-internal: the
    /// public surface is unchanged.
    pub(crate) fn visa_self_report(
        &self,
        connection: &Connection,
        trip: &Trip,
    ) -> Result<Option<VisaSelfReport>, AppError> {
        let records = self.records(connection);
        let Some(nationality) = records.visa_nationality(&trip.id)? else {
            return Ok(None);
        };
        let Some(destination) = self.destination_country(connection, trip)? else {
            return Ok(None);
        };
        let Some(journey) = voyalier_core::visa_journey(&destination, &nationality) else {
            return Ok(None);
        };
        let checked: std::collections::HashSet<String> = records
            .visa_prep_items(&trip.id)?
            .into_iter()
            .filter(|item| item.checked)
            .map(|item| item.document_id)
            .collect();
        let done = journey
            .steps
            .iter()
            .filter(|step| {
                !step.documents.is_empty()
                    && step
                        .documents
                        .iter()
                        .all(|document| checked.contains(&document.id))
            })
            .count();
        Ok(Some(VisaSelfReport {
            done: u32::try_from(done).unwrap_or(u32::MAX),
            total: u32::try_from(journey.steps.len()).unwrap_or(u32::MAX),
        }))
    }

    /// The destination's country code: the geocoded snapshot when the traveler
    /// has fetched one, else the bundled gazetteer so the cockpit works offline.
    fn destination_country(
        &self,
        connection: &Connection,
        trip: &Trip,
    ) -> Result<Option<String>, AppError> {
        if let Some(snapshot) = load_destination_facts_snapshot(connection, &trip.id)? {
            return Ok(Some(snapshot.country_code));
        }
        Ok(voyalier_core::resolve_country_code(&trip.destination))
    }

    /// Set the passport a trip's visa preparation is resolved against.
    pub fn set_visa_nationality(
        &self,
        input: SetVisaNationalityInput,
    ) -> Result<VisaPrep, AppError> {
        let nationality_iso2 = voyalier_core::validate_nationality(&input.nationality_iso2)?;
        {
            let connection = self.connection()?;
            let records = self.records(&connection);
            records.trip(&input.trip_id)?;
            records.upsert_visa_nationality(
                &new_id("visa-prep"),
                &input.trip_id,
                &nationality_iso2,
                &now_rfc3339(),
            )?;
        }
        self.get_visa_prep(&input.trip_id)
    }

    /// Record one checklist tick or note.
    ///
    /// Following ADR-0005 a row exists only after an explicit action, so
    /// clearing both the tick and the note removes it rather than leaving an
    /// empty row behind -- "untouched" stays one state instead of two.
    pub fn set_visa_item_progress(
        &self,
        input: SetVisaItemProgressInput,
    ) -> Result<VisaPrep, AppError> {
        let note = input.note.as_deref().map(str::trim).unwrap_or_default();
        voyalier_core::validate_visa_note(note)?;
        {
            let connection = self.connection()?;
            let records = self.records(&connection);
            records.trip(&input.trip_id)?;
            if !input.checked && note.is_empty() {
                records.delete_visa_prep_item(&input.trip_id, &input.document_id)?;
            } else {
                records.upsert_visa_prep_item(
                    &new_id("visa"),
                    &input.trip_id,
                    &input.document_id,
                    input.checked,
                    (!note.is_empty()).then_some(note),
                    &now_rfc3339(),
                )?;
            }
        }
        self.get_visa_prep(&input.trip_id)
    }
}
