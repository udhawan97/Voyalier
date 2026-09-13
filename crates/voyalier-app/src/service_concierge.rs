//! Local concierge state and its deterministic read projection.

use super::*;
impl AppService {
    pub fn get_concierge_workspace(&self, trip_id: &str) -> Result<ConciergeWorkspace, AppError> {
        let detail = self.get_trip(trip_id)?;
        let connection = self.connection()?;
        let profile = self
            .records(&connection)
            .concierge_profile(trip_id)?
            .unwrap_or_else(|| ConciergeProfile::empty(trip_id));
        let attachments = self.records(&connection).attachments(trip_id)?;
        Ok(build_concierge_workspace(&detail, profile, attachments))
    }

    pub fn set_concierge_profile(
        &self,
        mut profile: ConciergeProfile,
    ) -> Result<ConciergeWorkspace, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(&profile.trip_id)?;
        let previous = self
            .records(&connection)
            .concierge_profile(&profile.trip_id)?;
        if let Some(previous) = &previous {
            record_progress_history(previous, &mut profile);
            if previous.travelers != profile.travelers {
                invalidate_task_progress(
                    &mut profile,
                    &["complete-party", "review-entry", "collect-documents"],
                    true,
                );
            }
            if previous.preferences.selected_area != profile.preferences.selected_area {
                invalidate_task_progress(&mut profile, &["compare-stays", "plan-local"], false);
            }
            if previous.preferences.area_stays != profile.preferences.area_stays {
                invalidate_task_progress_by_prefix(
                    &mut profile,
                    &["compare-stay-", "plan-transfer-"],
                );
            }
            if previous.preferences.party_size != profile.preferences.party_size
                || previous.preferences.adults != profile.preferences.adults
                || previous.preferences.children != profile.preferences.children
                || previous.preferences.bedrooms != profile.preferences.bedrooms
                || previous.preferences.beds != profile.preferences.beds
                || previous.preferences.rooms != profile.preferences.rooms
                || previous.preferences.kitchen_required != profile.preferences.kitchen_required
                || previous.preferences.laundry_required != profile.preferences.laundry_required
                || previous.preferences.air_conditioning_required
                    != profile.preferences.air_conditioning_required
                || previous.preferences.accessibility_required
                    != profile.preferences.accessibility_required
                || previous.preferences.flexible_cancellation_preferred
                    != profile.preferences.flexible_cancellation_preferred
            {
                invalidate_task_progress(
                    &mut profile,
                    &[
                        "complete-party",
                        "compare-flights",
                        "compare-stays",
                        "review-money",
                    ],
                    false,
                );
            }
            if previous.preferences.travel_mode != profile.preferences.travel_mode
                || previous.preferences.has_foreign_connection
                    != profile.preferences.has_foreign_connection
                || previous.preferences.purpose != profile.preferences.purpose
            {
                invalidate_task_progress(&mut profile, &["review-entry"], true);
            }
            if previous.preferences.pace != profile.preferences.pace
                || previous.preferences.car_preference != profile.preferences.car_preference
            {
                invalidate_task_progress(&mut profile, &["plan-local"], false);
            }
            if previous.preferences.base_currency != profile.preferences.base_currency
                || previous.preferences.budget_min_minor != profile.preferences.budget_min_minor
                || previous.preferences.budget_max_minor != profile.preferences.budget_max_minor
                || previous.preferences.budget_is_per_person
                    != profile.preferences.budget_is_per_person
            {
                invalidate_task_progress(&mut profile, &["review-money"], false);
            }
        } else if !profile.travelers.is_empty() {
            invalidate_task_progress(&mut profile, &["review-entry"], true);
        }
        profile.updated_at = Some(now_rfc3339());
        let profile = profile.validate()?;
        for document_id in profile
            .wallet_links
            .iter()
            .filter_map(|link| link.source_document_id.as_deref())
        {
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM source_documents WHERE id=?1 AND trip_id=?2",
                    params![document_id, profile.trip_id],
                    |row| row.get(0),
                )
                .map_err(storage_error)?;
            if count != 1 {
                return Err(AppError::with_detail(
                    ErrorCode::ValidationInvalidInput,
                    "wallet links can only reference documents imported into this trip",
                    "field",
                    "walletLink.sourceDocumentId",
                ));
            }
        }
        for attachment_id in profile
            .wallet_links
            .iter()
            .filter_map(|link| link.source_attachment_id.as_deref())
        {
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM binary_attachments WHERE id=?1 AND trip_id=?2",
                    params![attachment_id, profile.trip_id],
                    |row| row.get(0),
                )
                .map_err(storage_error)?;
            if count != 1 {
                return Err(AppError::with_detail(
                    ErrorCode::ValidationInvalidInput,
                    "wallet links can only reference attachments imported into this trip",
                    "field",
                    "walletLink.sourceAttachmentId",
                ));
            }
        }
        self.records(&connection)
            .upsert_concierge_profile(&profile, &new_id("concierge"))?;
        drop(connection);
        self.get_concierge_workspace(&profile.trip_id)
    }
}

pub(crate) fn invalidate_task_progress(
    profile: &mut ConciergeProfile,
    task_ids: &[&str],
    include_preparation_steps: bool,
) {
    for progress in &mut profile.task_progress {
        let matches_fixed = task_ids.contains(&progress.task_id.as_str());
        let matches_preparation = include_preparation_steps
            && (progress.task_id.contains("-canada-")
                || progress.task_id.ends_with("-return-route")
                || progress.task_id.contains("-hawaii-"));
        if (matches_fixed || matches_preparation)
            && matches!(
                progress.state,
                ConciergeTaskState::DoneByTraveler
                    | ConciergeTaskState::NotApplicable
                    | ConciergeTaskState::Waiting
            )
        {
            progress.history.push(TaskProgressEvent {
                state: progress.state,
                note: progress.note.clone(),
                context_revision: progress.context_revision.clone(),
                recorded_at: now_rfc3339(),
                reason: "context invalidated".to_owned(),
            });
            if progress.history.len() > 50 {
                progress.history.remove(0);
            }
            progress.state = ConciergeTaskState::NeedsRecheck;
            progress.context_revision = None;
        }
    }
    for task_id in task_ids {
        if *task_id == "review-entry"
            && include_preparation_steps
            && !profile
                .task_progress
                .iter()
                .any(|progress| progress.task_id == *task_id)
        {
            profile.task_progress.push(TaskProgress {
                task_id: (*task_id).to_owned(),
                state: ConciergeTaskState::NeedsRecheck,
                note: String::new(),
                context_revision: None,
                history: vec![],
            });
        }
    }
}

pub(crate) fn invalidate_task_progress_by_prefix(
    profile: &mut ConciergeProfile,
    prefixes: &[&str],
) {
    for progress in &mut profile.task_progress {
        if prefixes
            .iter()
            .any(|prefix| progress.task_id.starts_with(prefix))
            && matches!(
                progress.state,
                ConciergeTaskState::DoneByTraveler
                    | ConciergeTaskState::NotApplicable
                    | ConciergeTaskState::Waiting
            )
        {
            progress.history.push(TaskProgressEvent {
                state: progress.state,
                note: progress.note.clone(),
                context_revision: progress.context_revision.clone(),
                recorded_at: now_rfc3339(),
                reason: "area stays changed".to_owned(),
            });
            if progress.history.len() > 50 {
                progress.history.remove(0);
            }
            progress.state = ConciergeTaskState::NeedsRecheck;
            progress.context_revision = None;
        }
    }
}

fn record_progress_history(previous: &ConciergeProfile, next: &mut ConciergeProfile) {
    let recorded_at = now_rfc3339();
    for current in &mut next.task_progress {
        let Some(prior) = previous
            .task_progress
            .iter()
            .find(|prior| prior.task_id == current.task_id)
        else {
            continue;
        };
        if prior.state == current.state
            && prior.note == current.note
            && prior.context_revision == current.context_revision
        {
            continue;
        }
        current.history = prior.history.clone();
        current.history.push(TaskProgressEvent {
            state: prior.state,
            note: prior.note.clone(),
            context_revision: prior.context_revision.clone(),
            recorded_at: recorded_at.clone(),
            reason: "traveler update".to_owned(),
        });
        if current.history.len() > 50 {
            current.history.remove(0);
        }
    }
}
