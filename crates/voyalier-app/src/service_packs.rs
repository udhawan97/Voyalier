//! `AppService` — city packs, offline maps, and the suggestions drawn from them.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    /// The curated list of fetchable FCDO country pages.
    pub fn list_advice_countries(&self) -> Vec<FcdoCountry> {
        FCDO_COUNTRIES.to_vec()
    }

    /// The catalog of downloadable city packs. Static curated metadata — no
    /// network and no pack contents; downloading a pack is a separate consented
    /// step.
    pub fn list_packs(&self) -> Vec<PackInfo> {
        pack_catalog()
    }

    /// Suggest catalog packs for a trip's destination, best match first.
    ///
    /// A local, deterministic read: it matches the trip's stored destination
    /// against the compiled-in catalog and makes no network request. Downloading
    /// a suggested pack stays a separate, explicit user action.
    pub fn suggest_packs(&self, trip_id: &str) -> Result<Vec<PackSuggestion>, AppError> {
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        Ok(suggest_packs(&trip.destination))
    }

    /// Suggest values for a lodging form field from local data only.
    ///
    /// Sources are the trip's downloaded pack place names (for `propertyName`)
    /// and the user's previously confirmed lodging values. There is no external
    /// geocoding or per-keystroke network call. Confirmed values live in the
    /// encrypted vault; when it is locked that source is skipped rather than
    /// erroring, so the field still offers pack-based suggestions.
    pub fn suggest_field_values(
        &self,
        trip_id: &str,
        field: &str,
        query: &str,
    ) -> Result<Vec<FieldSuggestion>, AppError> {
        if !matches!(
            field,
            "address" | "propertyName" | "departureAirportIata" | "arrivalAirportIata"
        ) {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "suggestions are only available for lodging address and property name, \
                 and for the two flight airport codes",
                "field",
                "field",
            ));
        }
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;

        // The airport fields are matched on two keys — the code and the airport
        // name — so they cannot go through `rank_field_suggestions`, which ranks
        // a query against the stored value alone and would drop every match a
        // traveler found by typing "heathrow". Core ranks and caps them instead,
        // where the two-key rule is written down.
        if matches!(field, "departureAirportIata" | "arrivalAirportIata") {
            return Ok(matching_airports(query, FIELD_SUGGESTION_LIMIT)
                .into_iter()
                .map(|airport| {
                    FieldSuggestion::new(airport.iata, SuggestionSource::Airport)
                        .with_detail(airport.name)
                })
                .collect());
        }

        let mut candidates: Vec<FieldSuggestion> = Vec::new();

        // Values the user already confirmed on THIS trip. Scoped to the current
        // trip so a past trip's address never surfaces while entering a new one.
        // Reading needs the vault; a locked vault simply omits this source.
        match self
            .records(&connection)
            .confirmed_lodging_values(field, trip_id)
        {
            Ok(values) => {
                for value in values {
                    candidates.push(
                        FieldSuggestion::new(value, SuggestionSource::ConfirmedFact)
                            .with_detail("from this trip"),
                    );
                }
            }
            Err(error) if error.code == ErrorCode::VaultLocked => {}
            Err(error) => return Err(error),
        }

        // Place names from this trip's downloaded packs. Pack places carry a
        // name but no address, so they only inform the property-name field.
        if field == "propertyName" {
            for name in downloaded_pack_place_names(&connection, trip_id)? {
                candidates.push(
                    FieldSuggestion::new(name, SuggestionSource::PackPlace)
                        .with_detail("from a downloaded city pack"),
                );
            }
        }

        Ok(rank_field_suggestions(query, candidates))
    }

    /// Suggest place names for the origin/destination fields, from local data
    /// only: the bundled offline gazetteer, the pack catalog, and the user's own
    /// past trips. Not trip-scoped — it works in the create-trip dialog before a
    /// trip exists — and never geocodes over the network.
    ///
    /// The user's own places (trip history, then packs) are offered before the
    /// gazetteer, so when a prefix matches both, `rank_field_suggestions`'
    /// stable dedup keeps the familiar one.
    pub fn suggest_places(&self, query: &str) -> Result<Vec<FieldSuggestion>, AppError> {
        let mut candidates: Vec<FieldSuggestion> = Vec::new();

        // The origins and destinations of the user's existing trips.
        let connection = self.connection()?;
        for trip in self.records(&connection).trip_summaries()? {
            for place in [trip.trip.origin, trip.trip.destination] {
                candidates.push(
                    FieldSuggestion::new(place, SuggestionSource::TripHistory)
                        .with_detail("from a previous trip"),
                );
            }
        }

        // The offline pack catalog (city/region names).
        for pack in pack_catalog() {
            candidates.push(FieldSuggestion::new(pack.name, SuggestionSource::Catalog));
        }

        // The bundled gazetteer — the world's cities, offline.
        for city in search_cities(query, FIELD_SUGGESTION_LIMIT) {
            candidates.push(
                FieldSuggestion::new(city.name, SuggestionSource::Gazetteer)
                    .with_detail(city.country),
            );
        }

        Ok(rank_field_suggestions(query, candidates))
    }

    /// Download a city pack's contents for a trip. Called only from an explicit
    /// user action — the click is the consent for this single, named fetch. The
    /// download pulls place data and travel notes *in* from GitHub; nothing
    /// about the trip is sent. Contents are stored locally and replace any
    /// earlier copy of the same pack for this trip.
    pub fn download_pack(&self, trip_id: &str, pack_id: &str) -> Result<DownloadedPack, AppError> {
        let info = validate_pack_id(pack_id)?;
        {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?;
        }
        let url = pack_download_url(pack_id);
        let body = self
            .fetcher
            .fetch_text(&url)
            .map_err(|error| AppError::new(ErrorCode::PackDownloadFailed, error.message))?;
        let content = parse_pack_content(pack_id, &body)?;
        let place_count = content.places.len() as u32;
        let amenity_count = content.amenities.len() as u32;
        let article_count = content.articles.len() as u32;
        let offline_map_ready = if let Some(descriptor) = &content.offline_map {
            if !offline_map_is_ready(&self.database_path, pack_id, descriptor) {
                let url = offline_map_download_url(&descriptor.asset_name);
                let bytes = self
                    .fetcher
                    .fetch_bytes(&url, MAX_OFFLINE_MAP_BYTES as usize)?;
                store_offline_map(&self.database_path, pack_id, descriptor, &bytes)?;
            }
            true
        } else {
            false
        };
        // Store the re-serialized parsed content, not the raw body — so only
        // known fields are kept and the stored size can't diverge from what we
        // counted.
        let stored = serde_json::to_string(&content).map_err(|_| {
            AppError::new(
                ErrorCode::InternalUnexpected,
                "could not store the downloaded pack",
            )
        })?;
        let downloaded_at = now_rfc3339();

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO downloaded_packs
                 (trip_id, pack_id, name, region, place_count, article_count, content, downloaded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(trip_id, pack_id) DO UPDATE SET
                   name = excluded.name,
                   region = excluded.region,
                   place_count = excluded.place_count,
                   article_count = excluded.article_count,
                   content = excluded.content,
                   downloaded_at = excluded.downloaded_at",
                params![
                    trip_id,
                    pack_id,
                    info.name,
                    info.region,
                    place_count,
                    article_count,
                    stored,
                    downloaded_at
                ],
            )
            .map_err(storage_error)?;

        Ok(DownloadedPack {
            pack_id: pack_id.to_owned(),
            name: info.name,
            region: info.region,
            place_count,
            amenity_count,
            article_count,
            downloaded_at,
            offline_map_ready,
        })
    }

    /// The packs downloaded for a trip, most recent first.
    pub fn list_downloaded_packs(&self, trip_id: &str) -> Result<Vec<DownloadedPack>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let mut statement = connection
            .prepare(
                "SELECT pack_id, name, region, place_count, article_count, downloaded_at, content
                 FROM downloaded_packs
                 WHERE trip_id = ?1
                 ORDER BY downloaded_at DESC, pack_id ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                let pack_id: String = row.get(0)?;
                let content: String = row.get(6)?;
                let parsed = serde_json::from_str::<PackContent>(&content).ok();
                let offline_map_ready = parsed
                    .as_ref()
                    .and_then(|content| content.offline_map.as_ref())
                    .is_some_and(|descriptor| {
                        offline_map_is_ready(&self.database_path, &pack_id, descriptor)
                    });
                // Counted off the stored content rather than kept in its own
                // column: the content is already parsed here, so a derived count
                // needs no migration and cannot drift from what it counts. A
                // pack downloaded before the amenities layer shipped counts zero,
                // which is what it has.
                let amenity_count = parsed
                    .as_ref()
                    .map(|content| content.amenities.len() as u32)
                    .unwrap_or(0);
                Ok(DownloadedPack {
                    pack_id,
                    name: row.get(1)?,
                    region: row.get(2)?,
                    place_count: row.get(3)?,
                    amenity_count,
                    article_count: row.get(4)?,
                    downloaded_at: row.get(5)?,
                    offline_map_ready,
                })
            })
            .map_err(storage_error)?;
        collect_rows(rows)
    }

    /// Remove a downloaded pack from a trip.
    pub fn delete_downloaded_pack(&self, trip_id: &str, pack_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        let descriptor = connection
            .query_row(
                "SELECT content FROM downloaded_packs WHERE trip_id = ?1 AND pack_id = ?2",
                params![trip_id, pack_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?
            .and_then(|content| serde_json::from_str::<PackContent>(&content).ok())
            .and_then(|content| content.offline_map);
        connection
            .execute(
                "DELETE FROM downloaded_packs WHERE trip_id = ?1 AND pack_id = ?2",
                params![trip_id, pack_id],
            )
            .map_err(storage_error)?;
        if let Some(descriptor) = descriptor {
            let remaining: u32 = connection
                .query_row(
                    "SELECT COUNT(*) FROM downloaded_packs WHERE pack_id = ?1",
                    params![pack_id],
                    |row| row.get(0),
                )
                .map_err(storage_error)?;
            if remaining == 0 {
                let _ =
                    fs::remove_file(offline_map_path(&self.database_path, pack_id, &descriptor)?);
            }
        }
        Ok(())
    }

    /// The newest downloaded pack for this trip that has a verified local
    /// PMTiles archive. Reading this metadata is local-only and does not imply a
    /// tile request or any network consent.
    pub fn get_offline_map(&self, trip_id: &str) -> Result<Option<OfflineMapArchive>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let mut statement = connection
            .prepare(
                "SELECT pack_id, name, content FROM downloaded_packs
                 WHERE trip_id = ?1 ORDER BY downloaded_at DESC, pack_id ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(storage_error)?;
        for row in rows {
            let (pack_id, name, content) = row.map_err(storage_error)?;
            let Some(descriptor) = serde_json::from_str::<PackContent>(&content)
                .ok()
                .and_then(|content| content.offline_map)
            else {
                continue;
            };
            if offline_map_is_ready(&self.database_path, &pack_id, &descriptor) {
                let bbox = validate_pack_id(&pack_id)?.bbox;
                return Ok(Some(OfflineMapArchive {
                    pack_id,
                    name,
                    bbox,
                    byte_length: descriptor.byte_length,
                    sha256: descriptor.sha256,
                    source_name: descriptor.source_name,
                    source_url: descriptor.source_url,
                    license: descriptor.license,
                    attribution: descriptor.attribution,
                    fetched_at: descriptor.fetched_at,
                    min_zoom: descriptor.min_zoom,
                    max_zoom: descriptor.max_zoom,
                }));
            }
        }
        Ok(None)
    }

    /// Read one bounded range from a trip-authorized local PMTiles archive.
    /// This narrow seam avoids exposing arbitrary filesystem paths or granting
    /// the webview general filesystem capability.
    pub fn read_offline_map_range(
        &self,
        trip_id: &str,
        pack_id: &str,
        offset: u64,
        length: u32,
    ) -> Result<OfflineMapChunk, AppError> {
        validate_pack_id(pack_id)?;
        if length == 0 || length > MAX_OFFLINE_MAP_RANGE {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "offline map range length is invalid",
                "field",
                "length",
            ));
        }
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let content = connection
            .query_row(
                "SELECT content FROM downloaded_packs WHERE trip_id = ?1 AND pack_id = ?2",
                params![trip_id, pack_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::PackDownloadFailed,
                    "the offline map is not downloaded for this trip",
                )
            })?;
        drop(connection);
        let descriptor = serde_json::from_str::<PackContent>(&content)
            .ok()
            .and_then(|content| content.offline_map)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::PackDownloadFailed,
                    "the downloaded pack has no offline map",
                )
            })?;
        if offset >= descriptor.byte_length {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "offline map range starts beyond the archive",
                "field",
                "offset",
            ));
        }
        let actual_length = u64::from(length).min(descriptor.byte_length - offset) as usize;
        let path = offline_map_path(&self.database_path, pack_id, &descriptor)?;
        let mut file = fs::File::open(path).map_err(storage_error)?;
        file.seek(SeekFrom::Start(offset)).map_err(storage_error)?;
        let mut bytes = vec![0; actual_length];
        file.read_exact(&mut bytes).map_err(storage_error)?;
        Ok(OfflineMapChunk {
            data_base64: BASE64.encode(bytes),
            etag: descriptor.sha256,
        })
    }

    /// Rank the places in this trip's downloaded packs against the persona
    /// `weights`. Deterministic and transparent — no model, no network — and
    /// grounded only in already-downloaded open place data. Empty until a pack
    /// with places has been downloaded for the trip.
    pub fn get_recommendations(
        &self,
        trip_id: &str,
        weights: PersonaWeights,
    ) -> Result<Vec<Recommendation>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let mut statement = connection
            .prepare("SELECT pack_id, content FROM downloaded_packs WHERE trip_id = ?1")
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(storage_error)?;

        let mut places = Vec::new();
        for row in rows {
            let (pack_id, content) = row.map_err(storage_error)?;
            // Stored content is our own re-serialized PackContent; skip anything
            // unreadable rather than failing the whole request.
            if let Ok(pack) = serde_json::from_str::<PackContent>(&content) {
                places.extend(pack.places.into_iter().map(|place| AttributedPackPlace {
                    pack_id: pack_id.clone(),
                    place,
                }));
            }
        }
        Ok(recommend_attributed_places(
            &places,
            &weights,
            RECOMMENDATION_LIMIT,
        ))
    }
}
