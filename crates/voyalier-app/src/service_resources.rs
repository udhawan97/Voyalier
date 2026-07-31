//! `AppService` — research the traveler kept to read.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into.
//!
//! The network rule is the interesting part. Saving is local and instant, so
//! capture never waits on a site. Fetching what a page *says* is a request to
//! that site, which needs consent — taken once as a reversible preference
//! rather than per link, because a per-link prompt is what makes people stop
//! saving things. `fetch_resource_details` is the only method here that can
//! reach the network, and it refuses unless the preference is on.

use super::*;

/// The stored preference that lets saving a link also fetch what it says.
const AUTO_FETCH_SETTING: &str = "research.auto_fetch_details";
/// A page is read for its words; anything past this is not prose worth storing.
const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;

impl AppService {
    pub fn get_research_settings(&self) -> Result<ResearchSettings, AppError> {
        let connection = self.connection()?;
        Ok(ResearchSettings {
            auto_fetch_details: read_app_setting(&connection, AUTO_FETCH_SETTING)?
                .is_some_and(|value| value == "1"),
        })
    }

    /// Turn the standing fetch consent on or off. Reversible by construction:
    /// the whole record of it is one row, and turning it off deletes that row.
    pub fn set_research_settings(
        &self,
        input: SetResearchSettingsInput,
    ) -> Result<ResearchSettings, AppError> {
        if input.auto_fetch_details {
            self.set_app_setting(AUTO_FETCH_SETTING, "1")?;
        } else {
            self.connection()?
                .execute(
                    "DELETE FROM app_settings WHERE key = ?1",
                    params![AUTO_FETCH_SETTING],
                )
                .map_err(storage_error)?;
        }
        Ok(ResearchSettings {
            auto_fetch_details: input.auto_fetch_details,
        })
    }

    pub fn list_resources(&self, trip_id: &str) -> Result<Vec<Resource>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        self.records(&connection).resources(trip_id)
    }

    /// Keep a link or file with the trip. Saving the same address twice returns
    /// what is already there instead of a second copy.
    pub fn create_resource(&self, input: CreateResourceInput) -> Result<Resource, AppError> {
        let input = validate_create_resource(input)?;
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;

        let identity = input.url.as_deref().map(resource_url_identity);
        let now = now_rfc3339();
        let resource = Resource {
            id: new_id("res"),
            trip_id: input.trip_id,
            kind: input.kind,
            url: input.url,
            file_name: input.file_name,
            title: input.title,
            note: input.note,
            tags: input.tags,
            snapshot: None,
            created_at: now.clone(),
            updated_at: now,
        };
        if self
            .records(&connection)
            .insert_resource(&resource, identity.as_deref())?
        {
            return Ok(resource);
        }
        // The unique index refused it: this address is already kept here.
        let identity = identity.unwrap_or_default();
        self.records(&connection)
            .resources(&resource.trip_id)?
            .into_iter()
            .find(|existing| {
                existing
                    .url
                    .as_deref()
                    .is_some_and(|url| resource_url_identity(url) == identity)
            })
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::InternalUnexpected,
                    "resource identity conflicted without an existing record",
                )
            })
    }

    pub fn update_resource(&self, input: UpdateResourceInput) -> Result<Resource, AppError> {
        let input = validate_update_resource(input)?;
        let connection = self.connection()?;
        let existing = self.records(&connection).resource(&input.resource_id)?;
        let resource = Resource {
            title: input.title,
            note: input.note,
            tags: input.tags,
            updated_at: now_rfc3339(),
            ..existing
        };
        self.records(&connection).update_resource(&resource)?;
        Ok(resource)
    }

    pub fn delete_resource(&self, resource_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        self.records(&connection).delete_resource(resource_id)
    }

    /// Fetch what a saved link says and keep it as a dated snapshot.
    ///
    /// The stored text is public web material, so it is not sealed and it is
    /// searchable. It is also never evidence: no candidate fact comes out of
    /// it, and nothing here touches readiness.
    pub fn fetch_resource_details(&self, resource_id: &str) -> Result<Resource, AppError> {
        let (resource, url) = {
            let connection = self.connection()?;
            if !read_app_setting(&connection, AUTO_FETCH_SETTING)?.is_some_and(|value| value == "1")
            {
                return Err(AppError::with_detail(
                    ErrorCode::ValidationInvalidInput,
                    "fetching page details is turned off",
                    "field",
                    "autoFetchDetails",
                ));
            }
            let resource = self.records(&connection).resource(resource_id)?;
            let Some(url) = resource.url.clone() else {
                return Err(AppError::with_detail(
                    ErrorCode::ValidationInvalidInput,
                    "only a link has a page to fetch",
                    "field",
                    "resourceId",
                ));
            };
            (resource, url)
        };

        // Re-validate the stored address before it reaches the fetcher. It was
        // checked on the way in, but this is the call that leaves the machine.
        let url = validate_resource_url(&url)?;
        let body = self.fetcher.fetch_bytes(&url, MAX_PAGE_BYTES)?;
        let html = String::from_utf8_lossy(&body);
        let page = extract_readable_page(&html);

        let now = now_rfc3339();
        let snapshot = ResourceSnapshot {
            title: page.title.clone(),
            description: page.description,
            content_hash: sha256_hex(page.text.as_bytes()),
            text: page.text,
            fetched_at: now.clone(),
            truncated: page.truncated,
        };
        // A title the traveler chose stays theirs; only a derived one is
        // replaced by what the page calls itself.
        let title = match (&page.title, resource.url.as_deref()) {
            (Some(fetched), Some(url)) if resource.title == derived_link_title(url) => {
                fetched.clone()
            }
            _ => resource.title.clone(),
        };

        let connection = self.connection()?;
        self.records(&connection)
            .set_resource_snapshot(resource_id, &snapshot, &title, &now)?;
        Ok(Resource {
            title,
            snapshot: Some(snapshot),
            updated_at: now,
            ..resource
        })
    }
}
