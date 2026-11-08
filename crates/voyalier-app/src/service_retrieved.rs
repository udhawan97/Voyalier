//! `AppService` — everything fetched on the traveler's explicit request.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    /// Fetch every government's advice for one curated country on one click.
    ///
    /// Called only from an explicit user action — the click is the consent for
    /// this named set of keyless fetches. Each source is stored verbatim with
    /// its own retrieval time; a source that fails never destroys what it
    /// stored before, and never blocks the sources that succeeded.
    pub fn fetch_advisories(
        &self,
        trip_id: &str,
        country_slug: &str,
    ) -> Result<AdvisoryPanel, AppError> {
        let country = advisory_country(country_slug)?;
        let fcdo = validate_country_slug(country_slug)?;
        // Validate the trip before any network call.
        let trip = {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?
        };
        let retrieved_at = now_rfc3339();

        // Fetch and parse each government independently — no `?` on a fetch, or
        // one government being down would hide the other three. `Ok(None)`
        // means that government publishes nothing for this country; `Err` means
        // we could not read it this time and fall back to what is stored.
        let get = |url: &str| {
            self.fetcher
                .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
        };
        let uk = travel_advice(fcdo, &retrieved_at, get)
            .map(|snapshot| Some(entry_from_fcdo(&snapshot)));
        let us = us_state_advisory(country, fcdo.name, &retrieved_at, get);
        let ca = ca_gac_advisory(country, fcdo.name, &retrieved_at, get);
        let de = de_aa_advisory(country, fcdo.name, &retrieved_at, get);
        let notices = cdc_health_notices(fcdo.name, get);

        let mut connection = self.connection()?;
        let transaction = snapshots::ADVICE.publication(self, &mut connection, &trip)?;
        let previous = load_advisory_panel(&transaction, trip_id)?;
        let stored_before = |source| {
            previous
                .as_ref()
                .is_some_and(|panel| panel.entries.iter().any(|entry| entry.source == source))
        };

        // Resolve every source before storing anything: a total failure must
        // leave the database exactly as it was.
        let resolved = [
            (AdvisorySource::UkFcdo, uk),
            (AdvisorySource::UsState, us),
            (AdvisorySource::CaGac, ca),
            (AdvisorySource::DeAa, de),
        ];
        if resolved
            .iter()
            .all(|(source, result)| result.is_err() && !stored_before(*source))
        {
            // Nothing fetched and nothing stored. An empty panel would read as
            // "no government has anything to say about this destination", which
            // is a different and false claim.
            return Err(AppError::new(
                ErrorCode::AdviceFetchFailed,
                "no official source could be reached",
            ));
        }

        let mut source_status = Vec::with_capacity(resolved.len());
        for (source, result) in resolved {
            let state = match result {
                Ok(Some(entry)) => {
                    store_advisory_entry(&transaction, trip_id, &entry)?;
                    SourceState::Fresh
                }
                Ok(None) => {
                    delete_advisory_entry(&transaction, trip_id, source)?;
                    SourceState::NotPublished
                }
                Err(_) if stored_before(source) => SourceState::Kept,
                Err(_) => SourceState::Unavailable,
            };
            source_status.push(SourceStatus { source, state });
        }

        // A CDC failure leaves the last good notices in place.
        let health_notices = notices.unwrap_or_else(|_| {
            previous
                .as_ref()
                .map(|panel| panel.health_notices.clone())
                .unwrap_or_default()
        });

        store_advisory_panel_meta(
            &transaction,
            trip_id,
            country.slug,
            fcdo.name,
            &health_notices,
            &source_status,
            &retrieved_at,
        )?;

        // Return what a reload shows, not a hand-assembled value.
        let panel = load_advisory_panel(&transaction, trip_id)?.ok_or_else(|| {
            AppError::new(
                ErrorCode::AdviceFetchFailed,
                "no official source could be reached",
            )
        })?;
        transaction.commit().map_err(storage_error)?;
        Ok(panel)
    }

    /// Fetch and store a dated weather outlook for the trip's destination.
    /// Called only from an explicit user action — the click is the consent for
    /// two keyless requests to open-meteo.com (geocode the destination name,
    /// then the daily forecast). The snapshot replaces the trip's previous one.
    pub fn fetch_weather(&self, trip_id: &str) -> Result<WeatherSnapshot, AppError> {
        let trip = {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?
        };

        let place = geocode(&trip.destination, |url| {
            self.fetcher
                .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
                .map_err(weather_network_failure)
        })?;

        let mut snapshot = forecast(
            &place,
            &trip.start_date,
            &trip.end_date,
            &now_rfc3339(),
            |url| {
                self.fetcher
                    .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
                    .map_err(weather_network_failure)
            },
        )?;

        // The forecast is what the user clicked for; the layers below are
        // extras. Each is attempted independently and a failure leaves that one
        // layer empty rather than costing the outlook — so a slow archive or a
        // down NWS never turns into "no weather".
        snapshot.normals = self.fetch_climate_normals(&place, &trip);
        snapshot.air_quality = self.fetch_air_quality(&place, &trip).unwrap_or_default();
        // The NWS only covers the United States. Elsewhere Voyalier does not
        // ask, so an empty list there means "not covered", never "all clear".
        if place.country_code == "US" {
            snapshot.alerts = self.fetch_nws_alerts(&place).unwrap_or_default();
        }

        let mut connection = self.connection()?;
        let transaction = snapshots::WEATHER.publication(self, &mut connection, &trip)?;
        transaction
            .execute(
                "INSERT INTO weather_snapshots
                 (trip_id, place_name, place_region, latitude, longitude, days, coverage,
                  source_url, retrieved_at, normals, air_quality, alerts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   place_name = excluded.place_name,
                   place_region = excluded.place_region,
                   latitude = excluded.latitude,
                   longitude = excluded.longitude,
                   days = excluded.days,
                   coverage = excluded.coverage,
                   source_url = excluded.source_url,
                   retrieved_at = excluded.retrieved_at,
                   normals = excluded.normals,
                   air_quality = excluded.air_quality,
                   alerts = excluded.alerts",
                params![
                    trip_id,
                    snapshot.place_name,
                    snapshot.place_region,
                    snapshot.latitude,
                    snapshot.longitude,
                    json_to_sql(&snapshot.days)?,
                    enum_to_sql(snapshot.coverage)?,
                    snapshot.source_url,
                    snapshot.retrieved_at,
                    snapshot.normals.as_ref().map(json_to_sql).transpose()?,
                    json_to_sql(&snapshot.air_quality)?,
                    json_to_sql(&snapshot.alerts)?,
                ],
            )
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
        Ok(snapshot)
    }

    /// What the trip's dates have usually been like here, from observed
    /// history. `None` when the source is unreachable or the history is too
    /// thin to call anything typical.
    fn fetch_climate_normals(&self, place: &GeocodedPlace, trip: &Trip) -> Option<ClimateNormals> {
        climate_normals(
            place.latitude,
            place.longitude,
            &trip.start_date,
            &trip.end_date,
            NORMALS_YEARS,
            |url| {
                self.fetcher
                    .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
            },
        )
        .ok()?
    }

    fn fetch_air_quality(&self, place: &GeocodedPlace, trip: &Trip) -> Option<Vec<AirQualityDay>> {
        air_quality(
            place.latitude,
            place.longitude,
            &trip.start_date,
            &trip.end_date,
            |url| {
                self.fetcher
                    .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
            },
        )
        .ok()
    }

    fn fetch_nws_alerts(&self, place: &GeocodedPlace) -> Option<Vec<WeatherAlert>> {
        nws_alerts(place.latitude, place.longitude, |url| {
            self.fetcher
                .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
        })
        .ok()
    }

    /// Fetch the destination's practical facts on one click: a geocode (name,
    /// coordinates, country, timezone) and today's ECB reference rates.
    ///
    /// The country facts and the sun/moon days are derived from the stored
    /// snapshot on read, not fetched — so this makes exactly two requests, and
    /// a failed rate fetch still keeps the geocoded place.
    pub fn fetch_destination_facts(
        &self,
        trip_id: &str,
    ) -> Result<DestinationFactsSnapshot, AppError> {
        let trip = {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?
        };

        let place = geocode(&trip.destination, |url| {
            self.fetcher
                .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
                .map_err(weather_network_failure)
        })?;

        // The ECB feed is a small daily file; a failure here leaves the card
        // with the place and its country facts but no rates.
        let (rate_date, currency_rates) = match ecb_rates(|url| {
            self.fetcher
                .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
        }) {
            Ok((date, rates)) => (date, rates),
            Err(_) => (String::new(), Vec::new()),
        };

        // Best-effort: geocode the origin too, only to learn its timezone for
        // the destination-vs-home time difference. A blank or unrecognised
        // origin (or a network hiccup) simply leaves the difference unshown —
        // it never fails the fetch the way a missing destination would.
        let (origin_place, origin_utc_offset_minutes, origin_timezone) =
            if trip.origin.trim().is_empty() {
                (None, None, None)
            } else {
                match geocode(&trip.origin, |url| {
                    self.fetcher
                        .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
                })
                .ok()
                {
                    Some(origin) => (
                        Some(origin.name),
                        Some(offset_minutes_for(&origin.timezone, &trip.start_date)),
                        Some(origin.timezone),
                    ),
                    None => (None, None, None),
                }
            };

        let snapshot = DestinationFactsSnapshot {
            place_name: place.name.clone(),
            place_region: place.region.clone(),
            latitude: place.latitude,
            longitude: place.longitude,
            utc_offset_minutes: offset_minutes_for(&place.timezone, &trip.start_date),
            // The zone itself, not just the offset it resolved to today: the
            // offset is only true for the trip's first day, and a window
            // spanning a DST transition needs the zone to find the second one.
            timezone: place.timezone.clone(),
            country_code: place.country_code.clone(),
            rate_date,
            currency_rates,
            retrieved_at: now_rfc3339(),
            origin_place,
            origin_utc_offset_minutes,
            origin_timezone,
        };

        let mut connection = self.connection()?;
        let transaction = snapshots::FACTS.publication(self, &mut connection, &trip)?;
        transaction
            .execute(
                "INSERT INTO destination_facts_snapshots
                 (trip_id, place_name, place_region, latitude, longitude, utc_offset_minutes,
                  country_code, rate_date, currency_rates, retrieved_at,
                  origin_place, origin_utc_offset_minutes, timezone, origin_timezone)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   place_name = excluded.place_name,
                   place_region = excluded.place_region,
                   latitude = excluded.latitude,
                   longitude = excluded.longitude,
                   utc_offset_minutes = excluded.utc_offset_minutes,
                   country_code = excluded.country_code,
                   rate_date = excluded.rate_date,
                   currency_rates = excluded.currency_rates,
                   retrieved_at = excluded.retrieved_at,
                   origin_place = excluded.origin_place,
                   origin_utc_offset_minutes = excluded.origin_utc_offset_minutes,
                   timezone = excluded.timezone,
                   origin_timezone = excluded.origin_timezone",
                params![
                    trip_id,
                    snapshot.place_name,
                    snapshot.place_region,
                    snapshot.latitude,
                    snapshot.longitude,
                    snapshot.utc_offset_minutes,
                    snapshot.country_code,
                    snapshot.rate_date,
                    json_to_sql(&snapshot.currency_rates)?,
                    snapshot.retrieved_at,
                    snapshot.origin_place,
                    snapshot.origin_utc_offset_minutes,
                    snapshot.timezone,
                    snapshot.origin_timezone,
                ],
            )
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
        Ok(snapshot)
    }

    /// Fetch the destination country's public holidays for the trip's years
    /// from Nager.Date (keyless), stored as a dated snapshot. The trip detail
    /// narrows them to the travel window on read, so a date edit re-filters
    /// without a re-fetch. A year Nager does not cover simply contributes
    /// nothing rather than failing the whole fetch.
    pub fn fetch_public_holidays(&self, trip_id: &str) -> Result<PublicHolidaysSnapshot, AppError> {
        let trip = {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?
        };

        // Geocode the destination to its country — the lookup weather and facts
        // already use; Nager keys on the ISO-3166-1 alpha-2 code.
        let place = geocode(&trip.destination, |url| {
            self.fetcher
                .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
                .map_err(weather_network_failure)
        })?;

        let holidays = public_holidays(
            &place.country_code,
            trip_years(&trip.start_date, &trip.end_date),
            |url| {
                self.fetcher
                    .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
            },
        );

        // School terms, from a second source that covers fewer countries. It is
        // asked for the same year span, and an uncovered country costs no
        // request — the coverage list answers before the network does.
        let covered = school_holidays_covered(&place.country_code);
        let school = school_holidays(
            &place.country_code,
            &format!("{}-01-01", year_of(&trip.start_date)),
            &format!("{}-12-31", year_of(&trip.end_date)),
            |url| {
                self.fetcher
                    .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
            },
        );

        let snapshot = PublicHolidaysSnapshot {
            country_code: place.country_code.clone(),
            country_name: place.country.clone(),
            holidays,
            school_holidays: school,
            school_holidays_covered: covered,
            retrieved_at: now_rfc3339(),
        };

        let mut connection = self.connection()?;
        let transaction = snapshots::HOLIDAYS.publication(self, &mut connection, &trip)?;
        transaction
            .execute(
                "INSERT INTO public_holidays_snapshots
                 (trip_id, country_code, country_name, holidays, school_holidays,
                  school_holidays_covered, retrieved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   country_code = excluded.country_code,
                   country_name = excluded.country_name,
                   holidays = excluded.holidays,
                   school_holidays = excluded.school_holidays,
                   school_holidays_covered = excluded.school_holidays_covered,
                   retrieved_at = excluded.retrieved_at",
                params![
                    trip_id,
                    snapshot.country_code,
                    snapshot.country_name,
                    json_to_sql(&snapshot.holidays)?,
                    json_to_sql(&snapshot.school_holidays)?,
                    snapshot.school_holidays_covered,
                    snapshot.retrieved_at,
                ],
            )
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
        Ok(snapshot)
    }

    /// Fetch a Wikipedia summary of the destination from the Wikimedia REST API
    /// on an explicit click, stored as a dated snapshot. The text stays
    /// Wikipedia's, shown under CC BY-SA with attribution; a place with no clear
    /// article (a miss or a disambiguation page) surfaces as an error.
    pub fn fetch_place_summary(&self, trip_id: &str) -> Result<PlaceSummary, AppError> {
        let trip = {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?
        };
        let summary = place_summary(&trip.destination, &now_rfc3339(), |url| {
            self.fetcher
                .fetch_text_bounded(url, MAX_SOURCE_RESPONSE_BYTES)
                .map_err(weather_network_failure)
        })?;

        let mut connection = self.connection()?;
        let transaction = snapshots::SUMMARY.publication(self, &mut connection, &trip)?;
        transaction
            .execute(
                "INSERT INTO place_summaries
                 (trip_id, title, description, extract, url, retrieved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   title = excluded.title,
                   description = excluded.description,
                   extract = excluded.extract,
                   url = excluded.url,
                   retrieved_at = excluded.retrieved_at",
                params![
                    trip_id,
                    summary.title,
                    summary.description,
                    summary.extract,
                    summary.url,
                    summary.retrieved_at,
                ],
            )
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
        Ok(summary)
    }
}

#[cfg(test)]
mod publication_tests {
    use super::*;
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::time::Duration;

    /// Delegate all response contents to the shipped fake. Hold its first
    /// completed geocode until the test has saved the edit and newer result.
    struct PausedResponse {
        fake: FakeFetcher,
        first: Mutex<Option<(Sender<()>, Receiver<()>)>>,
    }

    impl AdviceFetcher for PausedResponse {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            let response = self.fake.fetch_text(url);
            let first = self.first.lock().unwrap().take();
            if let Some((started, resume)) = first {
                started.send(()).unwrap();
                resume.recv_timeout(Duration::from_secs(10)).unwrap();
            }
            response
        }
    }

    #[test]
    fn snapshot_publication_respects_changed_and_unchanged_context_after_reopen() {
        for rename_only in [false, true] {
            let database = crate::tests::temp_database("snapshot-publication");
            let (started, ready) = mpsc::channel();
            let (resume, paused) = mpsc::channel();
            let old_geocode = r#"{"results":[{"name":"Kyoto","latitude":35,"longitude":135,"country":"Japan","country_code":"JP"}]}"#;
            let fetcher = Arc::new(PausedResponse {
                first: Mutex::new(Some((started, paused))),
                fake: FakeFetcher::new()
                    .route("name=Kyoto", old_geocode)
                    .route("name=Osaka", &old_geocode.replace("Kyoto", "Osaka"))
                    .route("api.open-meteo.com/v1/forecast", r#"{"daily":{"time":["2027-04-01"],"temperature_2m_max":[18],"temperature_2m_min":[8],"weather_code":[0],"precipitation_probability_max":[0]}}"#),
            });
            let secrets = Arc::new(MemorySecretStore::default());
            let open = || {
                AppService::open_path_with_deps(&database, fetcher.clone(), secrets.clone())
                    .unwrap()
            };
            let service = Arc::new(open());
            let trip = service
                .create_trip(CreateTripInput {
                    title: Some("Spring".into()),
                    origin: "Chicago".into(),
                    destination: "Kyoto".into(),
                    start_date: "2027-04-01".into(),
                    end_date: "2027-04-02".into(),
                })
                .unwrap();
            let worker = service.clone();
            let id = trip.id.clone();
            let handle = std::thread::spawn(move || worker.fetch_weather(&id));
            ready.recv_timeout(Duration::from_secs(10)).unwrap();
            service
                .update_trip(
                    &trip.id,
                    UpdateTripInput {
                        title: Some("Spring visit".into()),
                        origin: None,
                        destination: (!rename_only).then(|| "Osaka".into()),
                        start_date: None,
                        end_date: None,
                    },
                )
                .unwrap();
            if !rename_only {
                assert_eq!(service.fetch_weather(&trip.id).unwrap().place_name, "Osaka");
            }
            resume.send(()).unwrap();
            let delayed = handle.join().unwrap();
            if rename_only {
                assert_eq!(delayed.unwrap().place_name, "Kyoto");
            } else {
                assert_eq!(
                    delayed.unwrap_err().details.unwrap()["reason"],
                    "snapshot_context_changed"
                );
            }
            drop(service);
            let reopened = open();
            let weather = reopened.get_trip(&trip.id).unwrap().weather.unwrap();
            assert_eq!(
                weather.place_name,
                if rename_only { "Kyoto" } else { "Osaka" }
            );
            assert!(!weather.source_url.is_empty() && !weather.retrieved_at.is_empty());
            drop(reopened);
            crate::tests::cleanup_database(database);
        }
    }
}
