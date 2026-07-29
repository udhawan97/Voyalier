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
        {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?;
        }
        let retrieved_at = now_rfc3339();

        // Fetch and parse each government independently — no `?` on a fetch, or
        // one government being down would hide the other three. `Ok(None)`
        // means that government publishes nothing for this country; `Err` means
        // we could not read it this time and fall back to what is stored.
        let get = |url: &str| self.fetcher.fetch_text(url);
        let uk = travel_advice(fcdo, &retrieved_at, get)
            .map(|snapshot| Some(entry_from_fcdo(&snapshot)));
        let us = us_state_advisory(country, fcdo.name, &retrieved_at, get);
        let ca = ca_gac_advisory(country, fcdo.name, &retrieved_at, get);
        let de = de_aa_advisory(country, fcdo.name, &retrieved_at, get);
        let notices = cdc_health_notices(fcdo.name, get);

        let connection = self.connection()?;
        let previous = load_advisory_panel(&connection, trip_id)?;
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
                    store_advisory_entry(&connection, trip_id, &entry)?;
                    SourceState::Fresh
                }
                Ok(None) => {
                    delete_advisory_entry(&connection, trip_id, source)?;
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
            &connection,
            trip_id,
            country.slug,
            fcdo.name,
            &health_notices,
            &source_status,
            &retrieved_at,
        )?;

        // Return what a reload shows, not a hand-assembled value.
        load_advisory_panel(&connection, trip_id)?.ok_or_else(|| {
            AppError::new(
                ErrorCode::AdviceFetchFailed,
                "no official source could be reached",
            )
        })
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
                .fetch_text(url)
                .map_err(weather_network_failure)
        })?;

        let mut snapshot = forecast(
            &place,
            &trip.start_date,
            &trip.end_date,
            &now_rfc3339(),
            |url| {
                self.fetcher
                    .fetch_text(url)
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

        let connection = self.connection()?;
        connection
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
            |url| self.fetcher.fetch_text(url),
        )
        .ok()?
    }

    fn fetch_air_quality(&self, place: &GeocodedPlace, trip: &Trip) -> Option<Vec<AirQualityDay>> {
        air_quality(
            place.latitude,
            place.longitude,
            &trip.start_date,
            &trip.end_date,
            |url| self.fetcher.fetch_text(url),
        )
        .ok()
    }

    fn fetch_nws_alerts(&self, place: &GeocodedPlace) -> Option<Vec<WeatherAlert>> {
        nws_alerts(place.latitude, place.longitude, |url| {
            self.fetcher.fetch_text(url)
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
                .fetch_text(url)
                .map_err(weather_network_failure)
        })?;

        // The ECB feed is a small daily file; a failure here leaves the card
        // with the place and its country facts but no rates.
        let (rate_date, currency_rates) = match ecb_rates(|url| self.fetcher.fetch_text(url)) {
            Ok((date, rates)) => (date, rates),
            Err(_) => (String::new(), Vec::new()),
        };

        // Best-effort: geocode the origin too, only to learn its timezone for
        // the destination-vs-home time difference. A blank or unrecognised
        // origin (or a network hiccup) simply leaves the difference unshown —
        // it never fails the fetch the way a missing destination would.
        let (origin_place, origin_utc_offset_minutes) = if trip.origin.trim().is_empty() {
            (None, None)
        } else {
            match geocode(&trip.origin, |url| self.fetcher.fetch_text(url)).ok() {
                Some(origin) => (
                    Some(origin.name),
                    Some(offset_minutes_for(&origin.timezone, &trip.start_date)),
                ),
                None => (None, None),
            }
        };

        let snapshot = DestinationFactsSnapshot {
            place_name: place.name.clone(),
            place_region: place.region.clone(),
            latitude: place.latitude,
            longitude: place.longitude,
            utc_offset_minutes: offset_minutes_for(&place.timezone, &trip.start_date),
            country_code: place.country_code.clone(),
            rate_date,
            currency_rates,
            retrieved_at: now_rfc3339(),
            origin_place,
            origin_utc_offset_minutes,
        };

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO destination_facts_snapshots
                 (trip_id, place_name, place_region, latitude, longitude, utc_offset_minutes,
                  country_code, rate_date, currency_rates, retrieved_at,
                  origin_place, origin_utc_offset_minutes)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
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
                   origin_utc_offset_minutes = excluded.origin_utc_offset_minutes",
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
                ],
            )
            .map_err(storage_error)?;
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
                .fetch_text(url)
                .map_err(weather_network_failure)
        })?;

        let holidays = public_holidays(
            &place.country_code,
            trip_years(&trip.start_date, &trip.end_date),
            |url| self.fetcher.fetch_text(url),
        );

        let snapshot = PublicHolidaysSnapshot {
            country_code: place.country_code.clone(),
            country_name: place.country.clone(),
            holidays,
            retrieved_at: now_rfc3339(),
        };

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO public_holidays_snapshots
                 (trip_id, country_code, country_name, holidays, retrieved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   country_code = excluded.country_code,
                   country_name = excluded.country_name,
                   holidays = excluded.holidays,
                   retrieved_at = excluded.retrieved_at",
                params![
                    trip_id,
                    snapshot.country_code,
                    snapshot.country_name,
                    json_to_sql(&snapshot.holidays)?,
                    snapshot.retrieved_at,
                ],
            )
            .map_err(storage_error)?;
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
                .fetch_text(url)
                .map_err(weather_network_failure)
        })?;

        let connection = self.connection()?;
        connection
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
        Ok(summary)
    }
}
