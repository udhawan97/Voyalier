//! `AppService` — traveler-authored records: ADR-0005's planning model.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    /// Persist the deterministic recommendation weights for this trip.
    pub fn set_interest_profile(
        &self,
        input: SetInterestProfileInput,
    ) -> Result<InterestProfile, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;
        let weights = input.weights.validate()?;
        let profile = InterestProfile {
            trip_id: input.trip_id,
            weights,
            updated_at: Some(now_rfc3339()),
        };
        self.records(&connection)
            .upsert_interest_profile(&profile)?;
        Ok(profile)
    }

    /// Snapshot a recommendation and its provenance into the trip shortlist.
    pub fn save_place(&self, input: SavePlaceInput) -> Result<SavedPlace, AppError> {
        let SavePlaceInput {
            trip_id,
            recommendation: requested,
            weights,
            notes,
        } = input;
        let weights = weights.validate()?;
        let requested_name = saved_place_identity(&requested.name);
        let recommendation = self
            .get_recommendations(&trip_id, weights)?
            .into_iter()
            .find(|candidate| {
                candidate.pack_id == requested.pack_id
                    && saved_place_identity(&candidate.name) == requested_name
                    && candidate.lat == requested.lat
                    && candidate.lon == requested.lon
            })
            .ok_or_else(|| {
                AppError::with_detail(
                    ErrorCode::ValidationInvalidInput,
                    "the saved place identity is not a current recommendation from the downloaded pack",
                    "field",
                    "recommendation",
                )
            })?;
        let connection = self.connection()?;
        let source_pack_available = true;
        if let Some(existing) = self
            .records(&connection)
            .saved_places(&trip_id)?
            .into_iter()
            .find(|place| {
                place.pack_id == recommendation.pack_id
                    && saved_place_identity(&place.name)
                        == saved_place_identity(&recommendation.name)
                    && place.lat == recommendation.lat
                    && place.lon == recommendation.lon
            })
        {
            return Ok(existing);
        }
        let now = now_rfc3339();
        let place = SavedPlace {
            id: new_id("place"),
            trip_id,
            pack_id: recommendation.pack_id,
            source_pack_available,
            name: recommendation.name,
            category: recommendation.category,
            dimension: recommendation.dimension,
            lat: recommendation.lat,
            lon: recommendation.lon,
            source: recommendation.source,
            license: recommendation.license,
            reasons: recommendation.reasons,
            wildcard: recommendation.wildcard,
            notes: validate_planning_notes(&notes)?,
            created_at: now.clone(),
            updated_at: now,
        };
        if self.records(&connection).insert_saved_place(&place)? {
            return Ok(place);
        }
        self.records(&connection)
            .saved_places(&place.trip_id)?
            .into_iter()
            .find(|saved| {
                saved.pack_id == place.pack_id
                    && saved_place_identity(&saved.name) == saved_place_identity(&place.name)
                    && saved.lat == place.lat
                    && saved.lon == place.lon
            })
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::InternalUnexpected,
                    "saved place identity conflicted without an existing record",
                )
            })
    }

    pub fn update_saved_place(&self, input: UpdateSavedPlaceInput) -> Result<SavedPlace, AppError> {
        let connection = self.connection()?;
        let trip_id = record_trip_id(&connection, "saved_places", &input.saved_place_id)?;
        self.records(&connection).update_saved_place_notes(
            &input.saved_place_id,
            &validate_planning_notes(&input.notes)?,
            &now_rfc3339(),
        )?;
        self.records(&connection)
            .saved_places(&trip_id)?
            .into_iter()
            .find(|place| place.id == input.saved_place_id)
            .ok_or_else(|| AppError::new(ErrorCode::InternalUnexpected, "saved place disappeared"))
    }

    pub fn delete_saved_place(&self, saved_place_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        self.records(&connection).delete_saved_place(saved_place_id)
    }

    pub fn add_packing_item(&self, input: AddPackingItemInput) -> Result<PackingItem, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;
        let label = validate_packing_label(&input.label)?;
        if let Some(code) = input.suggestion_code.as_deref() {
            if let Some(existing) = self
                .records(&connection)
                .packing_items(&input.trip_id)?
                .into_iter()
                .find(|item| item.suggestion_code.as_deref() == Some(code))
            {
                return Ok(existing);
            }
        }
        let now = now_rfc3339();
        let item = PackingItem {
            id: new_id("packing"),
            trip_id: input.trip_id,
            label,
            checked: false,
            suggestion_code: input.suggestion_code,
            created_at: now.clone(),
            updated_at: now,
        };
        self.records(&connection).insert_packing_item(&item)?;
        Ok(item)
    }

    pub fn update_packing_item(
        &self,
        input: UpdatePackingItemInput,
    ) -> Result<PackingItem, AppError> {
        let connection = self.connection()?;
        let trip_id = record_trip_id(&connection, "packing_items", &input.packing_item_id)?;
        let existing = self
            .records(&connection)
            .packing_items(&trip_id)?
            .into_iter()
            .find(|item| item.id == input.packing_item_id)
            .ok_or_else(|| {
                AppError::new(ErrorCode::ValidationInvalidInput, "packing item not found")
            })?;
        let item = PackingItem {
            label: validate_packing_label(&input.label)?,
            checked: input.checked,
            updated_at: now_rfc3339(),
            ..existing
        };
        self.records(&connection).update_packing_item(&item)?;
        Ok(item)
    }

    pub fn delete_packing_item(&self, packing_item_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        self.records(&connection)
            .delete_packing_item(packing_item_id)
    }

    pub fn create_trip_item(&self, input: CreateTripItemInput) -> Result<TripItem, AppError> {
        let input = validate_create_trip_item(input)?;
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;
        validate_saved_place_trip(&connection, input.saved_place_id.as_deref(), &input.trip_id)?;
        let now = now_rfc3339();
        let item = TripItem {
            id: new_id("item"),
            trip_id: input.trip_id,
            kind: input.kind,
            title: input.title,
            location: input.location,
            start_at: input.start_at,
            end_at: input.end_at,
            notes: input.notes,
            saved_place_id: input.saved_place_id,
            created_at: now.clone(),
            updated_at: now,
        };
        self.records(&connection).insert_trip_item(&item)?;
        Ok(item)
    }

    pub fn update_trip_item(&self, input: UpdateTripItemInput) -> Result<TripItem, AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let trip_id = record_trip_id(&transaction, "trip_items", &input.trip_item_id)?;
        let normalized = validate_create_trip_item(CreateTripItemInput {
            trip_id: trip_id.clone(),
            kind: input.kind,
            title: input.title,
            location: input.location,
            start_at: input.start_at,
            end_at: input.end_at,
            notes: input.notes,
            saved_place_id: input.saved_place_id,
        })?;
        validate_saved_place_trip(&transaction, normalized.saved_place_id.as_deref(), &trip_id)?;
        let existing = self
            .records(&transaction)
            .trip_items(&trip_id)?
            .into_iter()
            .find(|item| item.id == input.trip_item_id)
            .ok_or_else(|| {
                AppError::new(ErrorCode::ValidationInvalidInput, "trip item not found")
            })?;
        let calendar_changed = existing.kind != normalized.kind
            || existing.title != normalized.title
            || existing.location != normalized.location
            || existing.start_at != normalized.start_at
            || existing.end_at != normalized.end_at;
        let semantic_updated_at = now_rfc3339();
        let item = TripItem {
            kind: normalized.kind,
            title: normalized.title,
            location: normalized.location,
            start_at: normalized.start_at,
            end_at: normalized.end_at,
            notes: normalized.notes,
            saved_place_id: normalized.saved_place_id,
            updated_at: semantic_updated_at.clone(),
            ..existing
        };
        self.records(&transaction).update_trip_item(&item)?;
        if calendar_changed {
            self.records(&transaction).bump_itinerary_revision(
                TodayItemTargetSource::TripItem,
                &item.id,
                &semantic_updated_at,
            )?;
        }
        transaction.commit().map_err(storage_error)?;
        Ok(item)
    }

    pub fn delete_trip_item(&self, trip_item_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        self.records(&connection).delete_trip_item(trip_item_id)
    }
}
