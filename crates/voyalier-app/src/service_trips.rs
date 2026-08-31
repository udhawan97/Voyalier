//! `AppService` — trip lifecycle, and the two views derived from a whole trip.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    pub fn create_trip(&self, input: CreateTripInput) -> Result<Trip, AppError> {
        let input = validate_create_trip(input)?;
        let trip = Trip {
            id: new_id("trip"),
            title: input.title,
            origin: input.origin,
            destination: input.destination,
            start_date: input.start_date,
            end_date: input.end_date,
            status: TripStatus::Draft,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        };

        self.connection()?.execute(
            "INSERT INTO trips (id, title, origin, destination, start_date, end_date, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                trip.id,
                trip.title,
                trip.origin,
                trip.destination,
                trip.start_date,
                trip.end_date,
                enum_to_sql(trip.status)?,
                trip.created_at,
                trip.updated_at
            ],
        ).map_err(storage_error)?;

        Ok(trip)
    }

    pub fn list_trips(&self) -> Result<Vec<TripSummary>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip_summaries()
    }

    pub fn get_trip(&self, trip_id: &str) -> Result<TripDetail, AppError> {
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        let confirmed_facts = self.records(&connection).confirmed_facts(trip_id)?;
        let pending_candidate_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM candidate_facts WHERE trip_id = ?1 AND status = 'pending'",
                params![trip_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(storage_error)?;
        let pending_candidate_count = pending_candidate_count as u32;
        let trip_items = self.records(&connection).trip_items(trip_id)?;
        let journey_board = build_journey_board(&trip, &confirmed_facts, &trip_items);
        let TripAssessment {
            conflicts: mut itinerary_conflicts,
            readiness,
        } = assess_trip(&trip, &confirmed_facts, pending_candidate_count);
        itinerary_conflicts.extend(detect_planned_item_conflicts(&trip_items, &confirmed_facts));
        let advisory_panel = load_advisory_panel(&connection, trip_id)?;
        let weather = fetch_weather_snapshot(&connection, trip_id)?;
        // Derived, not fetched: the same stored evidence, read a second way.
        let packing_list = build_packing_list(&trip, &confirmed_facts, weather.as_ref());
        let destination_facts = load_destination_facts_snapshot(&connection, trip_id)?;
        // Country facts are bundled and re-resolved from the stored country
        // code, so a corrected value is never frozen into an old row; astro is
        // computed from the stored coordinates for each day of the trip window.
        let country_facts = destination_facts
            .as_ref()
            .and_then(|snapshot| country_facts(&snapshot.country_code))
            .cloned();
        let astro = destination_facts
            .as_ref()
            .map(|snapshot| derive_astro(snapshot, &trip))
            .unwrap_or_default();
        // The nearest airports fall out of the same stored coordinates — bundled
        // data, no fetch.
        let nearest_airports = destination_facts
            .as_ref()
            .map(|snapshot| nearest_airports(snapshot.latitude, snapshot.longitude, 4))
            .unwrap_or_default();
        // World Heritage sites within 150 km of the destination — bundled data,
        // no fetch, from the same stored coordinates.
        let world_heritage = destination_facts
            .as_ref()
            .map(|snapshot| world_heritage_near(snapshot.latitude, snapshot.longitude, 150.0, 5))
            .unwrap_or_default();
        let place_summary = load_place_summary(&connection, trip_id)?;
        // A tipping note for the destination country — bundled, resolved fresh
        // from the same country code as the country facts.
        let tipping = destination_facts
            .as_ref()
            .and_then(|snapshot| tipping_guidance(&snapshot.country_code))
            .map(str::to_owned);
        // Derived on read from the snapshot's two stored offsets: present only
        // once the origin was geocoded on the last fetch.
        let time_difference = destination_facts.as_ref().and_then(|snapshot| {
            Some(time_difference(
                snapshot.origin_place.as_deref()?,
                snapshot.origin_utc_offset_minutes?,
                snapshot.utc_offset_minutes,
            ))
        });
        // Bundled and date-only: no snapshot, no fetch, no coordinates. An
        // eclipse falls on a date whether or not the traveler fetched anything.
        let sky_events = sky_events_within(&trip.start_date, &trip.end_date);
        // Both ends of the trip can move their clocks mid-stay, and the gap
        // above is anchored to the start date, so the change is stated rather
        // than folded into that one number. Destination first: it is the one a
        // traveler is standing in when it happens.
        let clock_changes = destination_facts
            .as_ref()
            .map(|snapshot| {
                let mut changes = clock_changes_for(
                    &snapshot.timezone,
                    &trip.start_date,
                    &trip.end_date,
                    &snapshot.place_name,
                );
                if let (Some(zone), Some(place)) = (
                    snapshot.origin_timezone.as_deref(),
                    snapshot.origin_place.as_deref(),
                ) {
                    changes.extend(clock_changes_for(
                        zone,
                        &trip.start_date,
                        &trip.end_date,
                        place,
                    ));
                }
                changes
            })
            .unwrap_or_default();
        // Public holidays, narrowed to the trip window on read — a date edit
        // re-filters the stored snapshot without a re-fetch.
        let public_holidays =
            load_public_holidays_snapshot(&connection, trip_id)?.map(|snapshot| {
                PublicHolidaysSnapshot {
                    holidays: holidays_within(&snapshot.holidays, &trip.start_date, &trip.end_date),
                    // Overlap, not containment: a six-week summer break is
                    // never *inside* a one-week trip.
                    school_holidays: school_holidays_within(
                        &snapshot.school_holidays,
                        &trip.start_date,
                        &trip.end_date,
                    ),
                    ..snapshot
                }
            });
        // The carbon estimate is derived from the confirmed flights themselves,
        // not from the destination snapshot — a trip with no facts fetch still
        // gets one, and it needs no network or stored row of its own.
        let flight_emissions = estimate_flight_emissions(
            confirmed_facts
                .iter()
                .filter(|fact| fact.fact_type == FactType::FlightSegment)
                .map(|fact| {
                    (
                        fact.payload.departure_airport_iata.as_deref(),
                        fact.payload.arrival_airport_iata.as_deref(),
                    )
                }),
        );
        // Where the plan leans on the previous thing having gone right. Derived
        // from the confirmed legs themselves plus bundled tables — no fetch, no
        // row of its own — and advisory only: `assess_trip` above never sees it
        // (ADR-0016 §2). The pointers are assembled from what the workspace
        // already holds, so an empty mission list simply offers fewer of them.
        let nationality = self.records(&connection).visa_nationality(trip_id)?;
        let missions = match (nationality, self.destination_country(&connection, &trip)?) {
            (Some(nationality), Some(destination)) => missions_in(&destination, &nationality),
            _ => Vec::new(),
        };
        let disruption_plan = build_disruption_plan(
            &confirmed_facts,
            DisruptionContext {
                nearest_airports: &nearest_airports,
                missions: &missions,
            },
        );
        let interest_profile = self.records(&connection).interest_profile(trip_id)?;
        let saved_places = self.records(&connection).saved_places(trip_id)?;
        let packing_items = self.records(&connection).packing_items(trip_id)?;
        let visa_self_report = self.visa_self_report(&connection, &trip)?;
        Ok(TripDetail {
            trip,
            confirmed_facts,
            pending_candidate_count,
            itinerary_conflicts,
            readiness,
            visa_self_report,
            advisory_panel,
            weather,
            packing_list,
            destination_facts,
            country_facts,
            astro,
            nearest_airports,
            flight_emissions,
            time_difference,
            clock_changes,
            sky_events,
            public_holidays,
            world_heritage,
            place_summary,
            tipping,
            interest_profile,
            saved_places,
            packing_items,
            trip_items,
            journey_board,
            disruption_plan,
        })
    }

    pub fn update_trip(&self, trip_id: &str, input: UpdateTripInput) -> Result<Trip, AppError> {
        let mut connection = self.connection()?;
        let current = self.records(&connection).trip(trip_id)?;
        let input = validate_update_trip(&current, input)?;
        let updated_at = now_rfc3339();
        let transaction = connection.transaction().map_err(storage_error)?;
        transaction
            .execute(
                "UPDATE trips
                 SET title = ?1, origin = ?2, destination = ?3, start_date = ?4, end_date = ?5, updated_at = ?6
                 WHERE id = ?7",
                params![
                    input.title,
                    input.origin,
                    input.destination,
                    input.start_date,
                    input.end_date,
                    updated_at,
                    trip_id
                ],
            )
            .map_err(storage_error)?;
        invalidate_after_trip_edit(&transaction, trip_id, &current, &input)?;
        transaction.commit().map_err(storage_error)?;
        self.records(&connection).trip(trip_id)
    }

    pub fn archive_trip(&self, trip_id: &str) -> Result<Trip, AppError> {
        self.set_trip_status(trip_id, TripStatus::Archived)
    }

    /// Bring an archived trip back into the active workspace. Restores it to
    /// draft (the state a trip starts in), the reverse of [`Self::archive_trip`].
    pub fn unarchive_trip(&self, trip_id: &str) -> Result<Trip, AppError> {
        self.set_trip_status(trip_id, TripStatus::Draft)
    }

    pub fn delete_trip(&self, trip_id: &str) -> Result<(), AppError> {
        let changed = self
            .connection()?
            .execute("DELETE FROM trips WHERE id = ?1", params![trip_id])
            .map_err(storage_error)?;
        if changed == 0 {
            return Err(AppError::new(ErrorCode::TripNotFound, "trip not found"));
        }
        Ok(())
    }

    fn set_trip_status(&self, trip_id: &str, status: TripStatus) -> Result<Trip, AppError> {
        let connection = self.connection()?;
        let changed = connection
            .execute(
                "UPDATE trips SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![enum_to_sql(status)?, now_rfc3339(), trip_id],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err(AppError::new(ErrorCode::TripNotFound, "trip not found"));
        }
        self.records(&connection).trip(trip_id)
    }

    /// Build a redacted, shareable brief from the confirmed plan. The brief is
    /// produced by generation-time exclusion in the core, so secrets never
    /// enter the returned structure.
    pub fn get_trip_brief(&self, trip_id: &str) -> Result<TripBrief, AppError> {
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        let confirmed_facts = self.records(&connection).confirmed_facts(trip_id)?;
        let trip_items = self.records(&connection).trip_items(trip_id)?;
        Ok(build_trip_brief(
            &trip,
            &confirmed_facts,
            &trip_items,
            &RedactionPolicy::for_sharing(),
            &now_rfc3339(),
        ))
    }

    /// The Today view for a trip against the current date: where the trip
    /// stands, what happens today, and what's next. Deterministic and offline.
    pub fn get_today(&self, trip_id: &str) -> Result<TodayView, AppError> {
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        let facts = self.records(&connection).confirmed_facts(trip_id)?;
        let trip_items = self.records(&connection).trip_items(trip_id)?;
        let now = now_rfc3339();
        let today = now.get(..10).unwrap_or(now.as_str());
        Ok(build_today_view(&trip, &facts, &trip_items, today))
    }

    /// A trip's notes. Absent notes are an empty body, not an error — "nothing
    /// written yet" is the normal first state, not a failure.
    pub fn get_trip_notes(&self, trip_id: &str) -> Result<TripNotes, AppError> {
        let connection = self.connection()?;
        let records = self.records(&connection);
        records.trip(trip_id)?;
        records.trip_notes(trip_id)
    }

    pub fn set_trip_notes(&self, trip_id: &str, body: &str) -> Result<TripNotes, AppError> {
        if body.chars().count() > MAX_NOTES_CHARS {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "those notes are too long to store",
            ));
        }
        let connection = self.connection()?;
        let records = self.records(&connection);
        records.trip(trip_id)?;
        if body.is_empty() {
            records.delete_trip_notes(trip_id)?;
            return Ok(TripNotes {
                trip_id: trip_id.to_owned(),
                body: String::new(),
                updated_at: None,
            });
        }
        let updated_at = now_rfc3339();
        records.upsert_trip_notes(trip_id, body, &new_id("notes"), &updated_at)?;
        Ok(TripNotes {
            trip_id: trip_id.to_owned(),
            body: body.to_owned(),
            updated_at: Some(updated_at),
        })
    }
}
