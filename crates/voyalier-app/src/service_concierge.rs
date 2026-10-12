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
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        self.records(&transaction).trip(&profile.trip_id)?;
        let previous = self
            .records(&transaction)
            .concierge_profile(&profile.trip_id)?;
        let revision_matches = match &previous {
            Some(current) => profile.revision.is_some() && profile.revision == current.revision,
            None => profile.revision.is_none(),
        };
        if !revision_matches {
            return Err(AppError {
                code: ErrorCode::ValidationInvalidInput,
                message: "The saved profile changed. Reload it and review your draft before saving again.".to_owned(),
                details: Some(std::collections::BTreeMap::from([
                    ("field".to_owned(), "revision".to_owned()),
                    ("reason".to_owned(), if profile.revision.is_none() { "profile_revision_required" } else { "profile_changed" }.to_owned()),
                ])),
            });
        }
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
            let count: i64 = transaction
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
            let count: i64 = transaction
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
        self.records(&transaction)
            .upsert_concierge_profile(&profile, &new_id("concierge"))?;
        // Acknowledge this accepted row, including the revision minted by
        // Records. A later writer cannot replace it between commit and reply.
        let acknowledged = self
            .records(&transaction)
            .concierge_profile(&profile.trip_id)?
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::InternalUnexpected,
                    "the accepted profile is unavailable",
                )
            })?;
        let attachments = self.records(&transaction).attachments(&profile.trip_id)?;
        transaction.commit().map_err(storage_error)?;
        drop(connection);
        let detail = self.get_trip(&profile.trip_id)?;
        Ok(build_concierge_workspace(
            &detail,
            acknowledged,
            attachments,
        ))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn trip(service: &AppService) -> Trip {
        service
            .create_trip(CreateTripInput {
                title: Some("Synthetic profile".into()),
                origin: "Paris".into(),
                destination: "Kyoto".into(),
                start_date: "2027-01-01".into(),
                end_date: "2027-01-08".into(),
            })
            .unwrap()
    }

    #[test]
    fn stale_and_omitted_profiles_preserve_accepted_state_then_explicit_retry_succeeds() {
        let database = crate::tests::temp_database("profile-cas");
        let service = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            Arc::new(MemorySecretStore::default()),
        )
        .unwrap();
        let trip = trip(&service);
        let mut first = service.get_concierge_workspace(&trip.id).unwrap().profile;
        let initial = first.clone();
        first.preferences.selected_area = Some("Gion".into());
        let accepted = service.set_concierge_profile(first).unwrap().profile;
        assert!(accepted.revision.is_some());
        assert_eq!(
            service
                .set_concierge_profile(initial)
                .unwrap_err()
                .details
                .unwrap()["reason"],
            "profile_revision_required"
        );
        let mut newer = accepted.clone();
        newer.preferences.pace = voyalier_core::TripPace::Slow;
        let saved = service.set_concierge_profile(newer).unwrap().profile;
        let payload_before: String = service
            .connection()
            .unwrap()
            .query_row(
                "SELECT payload FROM concierge_profiles WHERE trip_id=?1",
                params![trip.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            service
                .set_concierge_profile(accepted)
                .unwrap_err()
                .details
                .unwrap()["reason"],
            "profile_changed"
        );
        assert_eq!(
            service.get_concierge_workspace(&trip.id).unwrap().profile,
            saved
        );
        let payload_after: String = service
            .connection()
            .unwrap()
            .query_row(
                "SELECT payload FROM concierge_profiles WHERE trip_id=?1",
                params![trip.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            payload_before, payload_after,
            "rejection changes no timestamp, history or sealed bytes"
        );
        let mut retry = service.get_concierge_workspace(&trip.id).unwrap().profile;
        retry.preferences.car_preference = voyalier_core::CarPreference::Avoid;
        let latest = service.set_concierge_profile(retry).unwrap().profile;
        assert_eq!(latest.preferences.selected_area.as_deref(), Some("Gion"));
        assert_eq!(latest.preferences.pace, voyalier_core::TripPace::Slow);
        assert_ne!(latest.revision, saved.revision);
        assert_eq!(
            latest.revision,
            service
                .records(&service.connection().unwrap())
                .concierge_profile(&trip.id)
                .unwrap()
                .unwrap()
                .revision
        );
        drop(service);
        crate::tests::cleanup_database(database);
    }

    #[test]
    fn legacy_profile_reads_have_stable_revision_without_rewriting_payload() {
        let database = crate::tests::temp_database("profile-legacy-cas");
        let service = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            Arc::new(MemorySecretStore::default()),
        )
        .unwrap();
        let trip = trip(&service);
        let legacy = ConciergeProfile::empty(&trip.id);
        let json = serde_json::to_string(&legacy).unwrap();
        service
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO concierge_profiles(id,trip_id,payload,updated_at) VALUES(?1,?2,?3,?4)",
                params!["legacy_profile", trip.id, json, "2026-01-01T00:00:00Z"],
            )
            .unwrap();
        let a = service.get_concierge_workspace(&trip.id).unwrap().profile;
        let b = service.get_concierge_workspace(&trip.id).unwrap().profile;
        assert_eq!(a.revision, b.revision);
        assert!(
            a.revision
                .as_deref()
                .unwrap()
                .starts_with("legacy_profile_v1_")
        );
        assert_eq!(
            service
                .set_concierge_profile(legacy)
                .unwrap_err()
                .details
                .unwrap()["reason"],
            "profile_revision_required"
        );
        let unchanged: String = service
            .connection()
            .unwrap()
            .query_row(
                "SELECT payload FROM concierge_profiles WHERE trip_id=?1",
                params![trip.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(unchanged, json);
        let saved = service.set_concierge_profile(a).unwrap().profile;
        assert!(
            saved
                .revision
                .as_deref()
                .unwrap()
                .starts_with("concierge_revision_")
        );
        assert_ne!(saved.revision, b.revision);
        drop(service);
        crate::tests::cleanup_database(database);
    }

    #[test]
    fn independent_connections_accept_only_one_write_for_the_same_revision() {
        let database = crate::tests::temp_database("profile-cas-concurrent");
        let secrets = Arc::new(MemorySecretStore::default());
        let service = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            secrets.clone(),
        )
        .unwrap();
        let trip = trip(&service);
        let baseline = service
            .set_concierge_profile(ConciergeProfile::empty(&trip.id))
            .unwrap()
            .profile;
        let first = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            secrets.clone(),
        )
        .unwrap();
        let second =
            AppService::open_path_with_deps(&database, Arc::new(FakeFetcher::offline()), secrets)
                .unwrap();
        let mut area = baseline.clone();
        area.preferences.selected_area = Some("Gion".into());
        let mut pace = baseline;
        pace.preferences.pace = voyalier_core::TripPace::Slow;
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let a_barrier = barrier.clone();
        let a = std::thread::spawn(move || {
            a_barrier.wait();
            first.set_concierge_profile(area)
        });
        let b = std::thread::spawn(move || {
            barrier.wait();
            second.set_concierge_profile(pace)
        });
        let results = [a.join().unwrap(), b.join().unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let rejected = results
            .iter()
            .find_map(|result| result.as_ref().err())
            .unwrap();
        assert_eq!(
            rejected.details.as_ref().unwrap()["reason"],
            "profile_changed"
        );
        let saved = results
            .iter()
            .find_map(|result| result.as_ref().ok())
            .unwrap();
        assert_eq!(
            service.get_concierge_workspace(&trip.id).unwrap().profile,
            saved.profile
        );
        drop(service);
        crate::tests::cleanup_database(database);
    }
}
