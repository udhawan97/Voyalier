//! `AppService` — search across one trip and across the workspace.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    /// Deterministic search over this trip's stored documents and confirmed
    /// facts. Purely local; ranking is transparent occurrence counting.
    pub fn search_trip(&self, trip_id: &str, query: &str) -> Result<Vec<SearchHit>, AppError> {
        let query = validate_search_query(query)?;
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let documents = self.records(&connection).trip_document_texts(trip_id)?;
        let searchable: Vec<SearchableDocument<'_>> = documents
            .iter()
            .map(|(id, label, content)| SearchableDocument { id, label, content })
            .collect();
        let facts = self.records(&connection).confirmed_facts(trip_id)?;
        Ok(search_trip_corpus(&query, &searchable, &facts, &[]))
    }

    /// Search traveler-visible local records across every trip. Pending parser
    /// candidates are intentionally excluded; extracted text becomes searchable
    /// only as a source document or after explicit confirmation.
    pub fn search_workspace(&self, query: &str) -> Result<Vec<WorkspaceSearchHit>, AppError> {
        let query = validate_search_query(query)?;
        let connection = self.connection()?;
        let trips = self.records(&connection).trip_summaries()?;
        let mut owned = Vec::new();
        for summary in trips {
            let trip = summary.trip;
            for (id, label, content) in self.records(&connection).trip_document_texts(&trip.id)? {
                owned.push(OwnedWorkspaceSearchRecord {
                    source: WorkspaceSearchSource::Document,
                    trip_id: trip.id.clone(),
                    trip_title: trip.title.clone(),
                    trip_status: trip.status,
                    trip_updated_at: trip.updated_at.clone(),
                    record_id: id,
                    label,
                    text: content,
                });
            }
            for fact in self.records(&connection).confirmed_facts(&trip.id)? {
                // The traveler's own identifying data, not a product noun. The
                // interface already prints "Confirmed fact" beside this line,
                // and saying it twice cost the result its only chance to name
                // which flight or stay actually matched. Empty when the fact
                // has nothing identifying: the noun is prose, so the interface
                // supplies it, localized.
                let label = fact_identity(&fact).unwrap_or_default();
                let text = fact_search_text(&fact);
                owned.push(OwnedWorkspaceSearchRecord {
                    source: WorkspaceSearchSource::ConfirmedFact,
                    trip_id: trip.id.clone(),
                    trip_title: trip.title.clone(),
                    trip_status: trip.status,
                    trip_updated_at: trip.updated_at.clone(),
                    record_id: fact.id,
                    label,
                    text,
                });
            }
            let notes = self.records(&connection).trip_notes(&trip.id)?;
            if !notes.body.is_empty() {
                owned.push(OwnedWorkspaceSearchRecord {
                    source: WorkspaceSearchSource::Note,
                    trip_id: trip.id.clone(),
                    trip_title: trip.title.clone(),
                    trip_status: trip.status,
                    trip_updated_at: trip.updated_at.clone(),
                    record_id: trip.id.clone(),
                    label: "Trip notes".to_owned(),
                    text: notes.body,
                });
            }
            for place in self.records(&connection).saved_places(&trip.id)? {
                owned.push(OwnedWorkspaceSearchRecord {
                    source: WorkspaceSearchSource::SavedPlace,
                    trip_id: trip.id.clone(),
                    trip_title: trip.title.clone(),
                    trip_status: trip.status,
                    trip_updated_at: trip.updated_at.clone(),
                    record_id: place.id,
                    label: place.name,
                    // The name and notes are source/traveler text. Category and
                    // recommendation reasons are product-owned English labels
                    // and must not leak into search or localized snippets.
                    text: place.notes,
                });
            }
            for item in self.records(&connection).trip_items(&trip.id)? {
                owned.push(OwnedWorkspaceSearchRecord {
                    source: WorkspaceSearchSource::TripItem,
                    trip_id: trip.id.clone(),
                    trip_title: trip.title.clone(),
                    trip_status: trip.status,
                    trip_updated_at: trip.updated_at.clone(),
                    record_id: item.id,
                    label: item.title,
                    text: [item.location, item.notes, item.start_at, item.end_at]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>()
                        .join(" "),
                });
            }
        }
        let borrowed: Vec<WorkspaceSearchRecord<'_>> = owned
            .iter()
            .map(|record| WorkspaceSearchRecord {
                source: record.source,
                trip_id: &record.trip_id,
                trip_title: &record.trip_title,
                trip_status: record.trip_status,
                trip_updated_at: &record.trip_updated_at,
                record_id: &record.record_id,
                label: &record.label,
                text: &record.text,
            })
            .collect();
        Ok(search_workspace_corpus(&query, &borrowed))
    }

    /// Typeahead term suggestions for a search query, from this trip's corpus.
    /// Local only. An empty or over-long query yields no suggestions (never an
    /// error — this drives as-you-type autocomplete).
    pub fn suggest_search_terms(
        &self,
        trip_id: &str,
        query: &str,
    ) -> Result<Vec<String>, AppError> {
        let Ok(query) = validate_search_query(query) else {
            return Ok(Vec::new());
        };
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let documents = self.records(&connection).trip_document_texts(trip_id)?;
        let searchable: Vec<SearchableDocument<'_>> = documents
            .iter()
            .map(|(id, label, content)| SearchableDocument { id, label, content })
            .collect();
        let facts = self.records(&connection).confirmed_facts(trip_id)?;
        Ok(suggest_search_terms(
            &query,
            &searchable,
            &facts,
            SEARCH_SUGGESTION_LIMIT,
        ))
    }
}
