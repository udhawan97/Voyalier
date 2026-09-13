//! Locally persisted trip ideas whose dates are still undecided.

use super::*;

impl AppService {
    pub fn save_trip_intent(
        &self,
        input: SaveTripIntentDraftInput,
    ) -> Result<TripIntentDraft, AppError> {
        let input = voyalier_core::validate_trip_intent(input)?;
        let connection = self.connection()?;
        let existing_created_at = input
            .draft_id
            .as_deref()
            .map(|id| {
                connection
                    .query_row(
                        "SELECT created_at FROM trip_intent_drafts WHERE id=?1",
                        params![id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(storage_error)
            })
            .transpose()?
            .flatten();
        if input.draft_id.is_some() && existing_created_at.is_none() {
            return Err(AppError::new(
                ErrorCode::TripNotFound,
                "that trip idea no longer exists",
            ));
        }
        let now = now_rfc3339();
        let draft = TripIntentDraft {
            id: input.draft_id.unwrap_or_else(|| new_id("intent")),
            title: input.title,
            origin: input.origin,
            destination: input.destination,
            start_date: input.start_date,
            end_date: input.end_date,
            party_size: input.party_size,
            selected_area: input.selected_area,
            created_at: existing_created_at.unwrap_or_else(|| now.clone()),
            updated_at: now,
        };
        connection
            .execute(
                "INSERT INTO trip_intent_drafts
                 (id, title, origin, destination, start_date, end_date, party_size, selected_area, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(id) DO UPDATE SET title=?2, origin=?3, destination=?4,
                    start_date=?5, end_date=?6, party_size=?7, selected_area=?8, updated_at=?10",
                params![
                    draft.id,
                    draft.title,
                    draft.origin,
                    draft.destination,
                    draft.start_date,
                    draft.end_date,
                    draft.party_size,
                    draft.selected_area,
                    draft.created_at,
                    draft.updated_at,
                ],
            )
            .map_err(storage_error)?;
        Ok(draft)
    }

    pub fn list_trip_intents(&self) -> Result<Vec<TripIntentDraft>, AppError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT id, title, origin, destination, start_date, end_date,
                        party_size, selected_area, created_at, updated_at
                   FROM trip_intent_drafts ORDER BY updated_at DESC, id DESC",
            )
            .map_err(storage_error)?;
        statement
            .query_map([], |row| {
                Ok(TripIntentDraft {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    origin: row.get(2)?,
                    destination: row.get(3)?,
                    start_date: row.get(4)?,
                    end_date: row.get(5)?,
                    party_size: row.get(6)?,
                    selected_area: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)
    }

    pub fn delete_trip_intent(&self, draft_id: &str) -> Result<(), AppError> {
        let changed = self
            .connection()?
            .execute(
                "DELETE FROM trip_intent_drafts WHERE id=?1",
                params![draft_id],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err(AppError::new(
                ErrorCode::TripNotFound,
                "that trip idea no longer exists",
            ));
        }
        Ok(())
    }

    pub fn convert_trip_intent(&self, input: ConvertTripIntentInput) -> Result<Trip, AppError> {
        let mut connection = self.connection()?;
        let draft = connection
            .query_row(
                "SELECT id, title, origin, destination, start_date, end_date,
                        party_size, selected_area, created_at, updated_at
                   FROM trip_intent_drafts WHERE id=?1",
                params![input.draft_id],
                |row| {
                    Ok(TripIntentDraft {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        origin: row.get(2)?,
                        destination: row.get(3)?,
                        start_date: row.get(4)?,
                        end_date: row.get(5)?,
                        party_size: row.get(6)?,
                        selected_area: row.get(7)?,
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| {
                AppError::new(ErrorCode::TripNotFound, "that trip idea no longer exists")
            })?;
        let party_size = draft.party_size;
        let selected_area = draft.selected_area.clone();
        let validated = voyalier_core::validate_create_trip(CreateTripInput {
            title: draft.title,
            origin: draft.origin,
            destination: draft.destination,
            start_date: input.start_date,
            end_date: input.end_date,
        })?;
        let now = now_rfc3339();
        let trip = Trip {
            id: new_id("trip"),
            title: validated.title,
            origin: validated.origin,
            destination: validated.destination,
            start_date: validated.start_date,
            end_date: validated.end_date,
            status: TripStatus::Draft,
            created_at: now.clone(),
            updated_at: now,
        };
        let transaction = connection.transaction().map_err(storage_error)?;
        transaction
            .execute(
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
                    trip.updated_at,
                ],
            )
            .map_err(storage_error)?;
        let mut profile = ConciergeProfile::empty(&trip.id);
        profile.preferences.party_size = party_size;
        profile.preferences.selected_area = selected_area;
        profile.updated_at = Some(trip.updated_at.clone());
        let profile = profile.validate()?;
        self.records(&transaction)
            .upsert_concierge_profile(&profile, &new_id("concierge"))?;
        transaction
            .execute(
                "DELETE FROM trip_intent_drafts WHERE id=?1",
                params![input.draft_id],
            )
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
        Ok(trip)
    }
}
