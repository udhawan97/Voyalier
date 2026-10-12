//! `AppService` — optional AI: preview, run, draft, and the activity log.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

fn assist_approval_token(
    trip_id: &str,
    id: ProviderId,
    request: &voyalier_core::AssistRequest,
) -> Result<String, AppError> {
    let identity = serde_json::to_vec(&(
        "voyalier-assist-approval-v1",
        trip_id,
        id.as_str(),
        request.url,
        request.model.as_str(),
        request.body.as_str(),
    ))
    .map_err(storage_error)?;
    Ok(format!("assist_approval_v1_{}", sha256_hex(&identity)))
}

fn assist_approval_error(reason: &str, message: &str) -> AppError {
    AppError {
        code: ErrorCode::ValidationInvalidInput,
        message: message.to_owned(),
        details: Some(std::collections::BTreeMap::from([
            ("field".to_owned(), "approvalToken".to_owned()),
            ("reason".to_owned(), reason.to_owned()),
        ])),
    }
}

impl AppService {
    /// Build a deterministic, redacted preview of the request Voyalier would
    /// send to `provider` for this trip — the consent step before any assist
    /// call exists. Grounded only in confirmed facts, with secrets excluded by
    /// construction. No network happens here and nothing is transmitted.
    pub fn preview_assist(
        &self,
        trip_id: &str,
        provider: &str,
    ) -> Result<AssistRequestPreview, AppError> {
        let id = validate_provider_id(provider)?;
        self.prepare_assist(trip_id, id).map(|(preview, _)| preview)
    }

    /// Read one consistent input set and prepare exact credential-free bytes.
    /// Both preview and run use this; dispatch never rebuilds the body.
    fn prepare_assist(
        &self,
        trip_id: &str,
        id: ProviderId,
    ) -> Result<(AssistRequestPreview, voyalier_core::AssistRequest), AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let trip = self.records(&transaction).trip(trip_id)?;
        let confirmed_facts = self.records(&transaction).confirmed_facts(trip_id)?;
        let model = transaction
            .query_row(
                "SELECT model FROM provider_settings WHERE provider = ?1",
                params![id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        let instruction = effective_ai_prompt(&transaction, AiPromptKind::Assist)?;
        transaction.commit().map_err(storage_error)?;
        drop(connection);
        let mut preview = build_assist_preview(
            &trip,
            &confirmed_facts,
            id,
            model.as_deref(),
            &now_rfc3339(),
        );
        // Include the effective instruction in both displayed content and the
        // prepared-body commitment. No stored provider key is read here.
        apply_prompt_override(&mut preview, instruction);
        let request = build_assist_request(
            id,
            preview.model.as_deref(),
            &preview.system_prompt,
            &preview.user_content,
            Some(""),
        )?;
        preview.approval_token = Some(assist_approval_token(trip_id, id, &request)?);
        Ok((preview, request))
    }

    /// The editable AI instructions with their defaults and any user overrides.
    pub fn get_ai_prompts(&self) -> Result<AiPromptSettings, AppError> {
        let connection = self.connection()?;
        let mut prompts = Vec::new();
        for kind in [AiPromptKind::Assist, AiPromptKind::DraftLodgingDates] {
            prompts.push(AiPrompt {
                kind,
                default_text: ai_prompt_default(kind).to_owned(),
                custom_text: read_app_setting(&connection, ai_prompt_key(kind))?,
            });
        }
        Ok(AiPromptSettings { prompts })
    }

    /// Set (or, with `text = None`, reset to default) one AI instruction. A blank
    /// override is rejected — resetting is the way to return to the default.
    pub fn set_ai_prompt(
        &self,
        kind: &str,
        text: Option<&str>,
    ) -> Result<AiPromptSettings, AppError> {
        let kind = validate_ai_prompt_kind(kind)?;
        match text {
            Some(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return Err(AppError::with_detail(
                        ErrorCode::ValidationInvalidInput,
                        "the instruction can't be empty — reset it to the default instead",
                        "field",
                        "text",
                    ));
                }
                if trimmed.chars().count() > MAX_AI_PROMPT_LEN {
                    return Err(AppError::with_detail(
                        ErrorCode::ValidationInvalidInput,
                        "the instruction is too long",
                        "field",
                        "text",
                    ));
                }
                self.write_app_setting(ai_prompt_key(kind), trimmed)?;
            }
            None => {
                let connection = self.connection()?;
                connection
                    .execute(
                        "DELETE FROM app_settings WHERE key = ?1",
                        params![ai_prompt_key(kind)],
                    )
                    .map_err(storage_error)?;
            }
        }
        self.get_ai_prompts()
    }

    /// Run assist only when current prepared bytes match the displayed preview's
    /// commitment. A changed or missing commitment sends nothing. For
    /// Ollama nothing leaves the device; for a cloud provider the redacted
    /// request goes to that provider using the key stored in the OS keychain —
    /// which is placed only in the outgoing auth header and is never logged,
    /// returned, or stored anywhere else. Every successful call is logged
    /// (metadata only).
    pub fn run_assist(
        &self,
        trip_id: &str,
        provider: &str,
        approval_token: Option<&str>,
    ) -> Result<AssistReply, AppError> {
        let id = validate_provider_id(provider)?;
        // ASCII identifiers make byte/character limits equivalent. Bound and
        // reject malformed legacy input before reading/building trip content.
        let approved = approval_token
            .filter(|token| {
                !token.is_empty()
                    && token
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
                    && token.len() <= 128
            })
            .ok_or_else(|| {
                assist_approval_error(
                    "assist_approval_required",
                    "Preview this request before sending it.",
                )
            })?;
        let (preview, request) = self.prepare_assist(trip_id, id)?;
        if preview.approval_token.as_deref() != Some(approved) {
            return Err(assist_approval_error(
                "assist_preview_changed",
                "The request changed. Refresh the preview and review it before sending.",
            ));
        }
        let (model, text) = self.dispatch_assist(id, request)?;
        let generated_at = now_rfc3339();
        // Log that a call happened — metadata only, never the prompt or reply.
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO assist_activity (id, trip_id, provider, model, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![new_id("act"), trip_id, id.as_str(), model, generated_at],
            )
            .map_err(storage_error)?;
        Ok(AssistReply {
            provider: id,
            model,
            text,
            generated_at,
        })
    }

    /// Gather the inputs a lodging-dates draft needs: the trip, its imported
    /// document texts (decrypted; a locked vault surfaces as `vault/locked`), and
    /// the user's chosen on-device model, if any. Rejects an unknown draft kind.
    fn draft_inputs(
        &self,
        trip_id: &str,
        kind: &str,
    ) -> Result<(Trip, Vec<DocumentText>, Option<String>), AppError> {
        if kind != ASSIST_DRAFT_LODGING_DATES {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "unknown draft kind",
                "field",
                "kind",
            ));
        }
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        let documents = self.records(&connection).trip_document_texts(trip_id)?;
        let model = connection
            .query_row(
                "SELECT model FROM provider_settings WHERE provider = ?1",
                params![ProviderId::Ollama.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        Ok((trip, documents, model))
    }

    /// Build the exact on-device request a lodging-dates draft would send — the
    /// consent step. On-device (Ollama) only, so nothing leaves the device; it is
    /// grounded in the trip's own imported text and dates. Previewing sends
    /// nothing.
    pub fn preview_assist_draft(
        &self,
        trip_id: &str,
        kind: &str,
    ) -> Result<AssistRequestPreview, AppError> {
        let (trip, documents, model) = self.draft_inputs(trip_id, kind)?;
        let doc_pairs: Vec<(String, String)> = documents
            .into_iter()
            .map(|(_, label, text)| (label, text))
            .collect();
        let connection = self.connection()?;
        let system_prompt = effective_ai_prompt(&connection, AiPromptKind::DraftLodgingDates)?;
        Ok(build_draft_preview(
            &trip,
            &doc_pairs,
            model.as_deref(),
            &system_prompt,
        ))
    }

    /// Run a lodging-dates draft: send the previewed request to the on-device
    /// model, strictly validate the reply, and turn each surviving proposal into
    /// a *pending* candidate for review — never a confirmed fact. Ollama-only;
    /// nothing leaves the device. With no imported documents there is nothing to
    /// read, so it returns no candidates without calling the model.
    pub fn run_assist_draft(
        &self,
        trip_id: &str,
        kind: &str,
    ) -> Result<AssistDraftResult, AppError> {
        let (trip, documents, model) = self.draft_inputs(trip_id, kind)?;
        if documents.is_empty() {
            return Ok(AssistDraftResult {
                candidates: Vec::new(),
            });
        }
        let document_id = documents[0].0.clone();
        let doc_pairs: Vec<(String, String)> = documents
            .iter()
            .map(|(_, label, text)| (label.clone(), text.clone()))
            .collect();
        // Read the (possibly customized) instruction in a scoped lock so the
        // storage guard is released before the network call and the later insert.
        let system_prompt = {
            let connection = self.connection()?;
            effective_ai_prompt(&connection, AiPromptKind::DraftLodgingDates)?
        };
        // This separate on-device draft rebuilds its current document inputs.
        // It is not the immutable itinerary-assist approval path (ADR-0029).
        let preview = build_draft_preview(&trip, &doc_pairs, model.as_deref(), &system_prompt);
        // On-device only: Ollama is keyless, so nothing leaves this machine.
        let request = build_assist_request(
            ProviderId::Ollama,
            preview.model.as_deref(),
            &preview.system_prompt,
            &preview.user_content,
            None,
        )?;
        let response =
            self.fetcher
                .post_json_bounded(request.url, &request.body, &[], MAX_AI_REPLY_BYTES)?;
        let text = parse_assist_reply(ProviderId::Ollama, &response)?;
        let proposals = parse_lodging_dates_reply(&text)?;
        if proposals.is_empty() {
            return Ok(AssistDraftResult {
                candidates: Vec::new(),
            });
        }

        let connection = self.connection()?;
        let now = now_rfc3339();
        // Record the draft as its own parser run so candidates satisfy the
        // parser_runs foreign key and the run is traceable, like an import.
        let parser_run_id = new_id("assist");
        connection
            .execute(
                "INSERT INTO parser_runs (id, trip_id, document_id, parser_id, parser_version, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    parser_run_id,
                    trip.id,
                    document_id,
                    "assist_draft_lodging_dates",
                    "v1",
                    now
                ],
            )
            .map_err(storage_error)?;
        let mut candidates = Vec::new();
        for proposal in proposals {
            let warnings = draft_window_warnings(&trip, &proposal);
            let candidate = CandidateFact {
                id: new_id("cand"),
                trip_id: trip.id.clone(),
                document_id: document_id.clone(),
                parser_run_id: parser_run_id.clone(),
                fact_type: FactType::LodgingStay,
                payload: FactPayload {
                    property_name: proposal.property_name,
                    checkin_date: proposal.checkin_date,
                    checkout_date: proposal.checkout_date,
                    ..FactPayload::default()
                },
                method: ExtractionMethod::Assisted,
                field_spans: Vec::new(),
                warnings,
                status: CandidateStatus::Pending,
                created_at: now.clone(),
                resolved_at: None,
                amends_fact_id: None,
            };
            self.records(&connection).insert_candidate(&candidate)?;
            candidates.push(candidate);
        }
        Ok(AssistDraftResult { candidates })
    }

    /// Send a previewed request to `id`'s runtime and return `(model, reply)`.
    /// The BYOK key, when needed, is read from the keychain and used only here.
    /// Send the previewed request to its provider and return `(model, reply)`.
    ///
    /// The provider protocol — endpoint, model default, body shape, headers, and
    /// the matching reply parser — belongs to `voyalier_core::assist`. All this
    /// adds is the two things core cannot do: read the key from the keychain and
    /// perform the fetch.
    fn dispatch_assist(
        &self,
        id: ProviderId,
        prepared: voyalier_core::AssistRequest,
    ) -> Result<(String, String), AppError> {
        let key = if provider_info(id).key_required {
            Some(self.require_provider_key(id)?)
        } else {
            None
        };
        // Preserve the exact URL/model/body committed before key retrieval.
        let request = prepared.with_key(id, key.as_deref())?;
        let header_refs: Vec<(&str, &str)> = request
            .headers
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
            .collect();
        let response = self.fetcher.post_json_bounded(
            request.url,
            &request.body,
            &header_refs,
            MAX_AI_REPLY_BYTES,
        )?;
        Ok((request.model, parse_assist_reply(id, &response)?))
    }

    /// Read the BYOK key for a cloud provider, or a clear "add a key" error.
    fn require_provider_key(&self, id: ProviderId) -> Result<String, AppError> {
        self.secrets
            .get(&provider_key_account(&self.database_path, id))?
            .ok_or_else(|| {
                AppError::with_detail(
                    ErrorCode::ValidationInvalidInput,
                    "add an API key for this provider under AI providers, then try again",
                    "field",
                    "provider",
                )
            })
    }

    /// The visible per-trip log of assist calls, most recent first. Metadata
    /// only — prompts and replies are never stored.
    pub fn list_assist_activity(
        &self,
        trip_id: &str,
    ) -> Result<Vec<AssistActivityEntry>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let mut statement = connection
            .prepare(
                "SELECT id, provider, model, created_at
                 FROM assist_activity
                 WHERE trip_id = ?1
                 ORDER BY created_at DESC, id DESC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(storage_error)?;
        let mut entries = Vec::new();
        for row in rows {
            let (id, provider, model, created_at) = row.map_err(storage_error)?;
            entries.push(AssistActivityEntry {
                id,
                provider: validate_provider_id(&provider)?,
                model,
                created_at,
            });
        }
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voyalier_core::{FactPayload, FactType};

    #[test]
    fn approval_rejects_changed_cloud_content_before_dispatch_and_renewed_preview_succeeds() {
        for change in ["fact", "model", "instruction"] {
            let database = crate::tests::temp_database(&format!("assist-approval-{change}"));
            let fetcher = Arc::new(FakeFetcher::offline().route(
                "https://api.openai.com/v1/chat/completions",
                r#"{"choices":[{"message":{"content":"Synthetic response"}}]}"#,
            ));
            let secrets = Arc::new(MemorySecretStore::default());
            let first =
                AppService::open_path_with_deps(&database, fetcher.clone(), secrets.clone())
                    .unwrap();
            let trip = first
                .create_trip(CreateTripInput {
                    title: Some("Synthetic assist".into()),
                    origin: "Paris".into(),
                    destination: "Kyoto".into(),
                    start_date: "2027-01-01".into(),
                    end_date: "2027-01-08".into(),
                })
                .unwrap();
            first
                .add_manual_fact(AddManualFactInput {
                    trip_id: trip.id.clone(),
                    fact_type: FactType::FlightSegment,
                    payload: FactPayload {
                        flight_number: Some("SYN101".into()),
                        confirmation_code: Some("SYNTHETIC-PNR-WITHHOLD".into()),
                        passenger_name: Some("Synthetic Private Passenger".into()),
                        ..FactPayload::default()
                    },
                })
                .unwrap();
            first
                .set_provider_key("openai", "synthetic-only-no-real-authority")
                .unwrap();
            first
                .set_provider_model("openai", "synthetic-model-before")
                .unwrap();
            let preview = first.preview_assist(&trip.id, "openai").unwrap();
            let token = preview.approval_token.as_deref().unwrap();
            assert_eq!(
                first
                    .preview_assist(&trip.id, "openai")
                    .unwrap()
                    .approval_token,
                preview.approval_token
            );
            assert!(fetcher.calls().is_empty());
            assert_eq!(
                first
                    .run_assist(&trip.id, "openai", None)
                    .unwrap_err()
                    .details
                    .unwrap()["reason"],
                "assist_approval_required"
            );
            assert_eq!(
                first
                    .run_assist(&trip.id, "ollama", Some(token))
                    .unwrap_err()
                    .details
                    .unwrap()["reason"],
                "assist_preview_changed"
            );
            let second =
                AppService::open_path_with_deps(&database, fetcher.clone(), secrets).unwrap();
            match change {
                "fact" => {
                    second
                        .add_manual_fact(AddManualFactInput {
                            trip_id: trip.id.clone(),
                            fact_type: FactType::FlightSegment,
                            payload: FactPayload {
                                flight_number: Some("SYN202".into()),
                                ..FactPayload::default()
                            },
                        })
                        .unwrap();
                }
                "model" => {
                    second
                        .set_provider_model("openai", "synthetic-model-after")
                        .unwrap();
                }
                "instruction" => {
                    second
                        .set_ai_prompt("assist", Some("Synthetic changed instruction"))
                        .unwrap();
                }
                _ => unreachable!(),
            }
            assert_eq!(
                first
                    .run_assist(&trip.id, "openai", Some(token))
                    .unwrap_err()
                    .details
                    .unwrap()["reason"],
                "assist_preview_changed"
            );
            assert!(fetcher.posted().is_empty());
            assert!(first.list_assist_activity(&trip.id).unwrap().is_empty());
            let renewed = first.preview_assist(&trip.id, "openai").unwrap();
            assert_ne!(renewed.approval_token, preview.approval_token);
            let reply = first
                .run_assist(&trip.id, "openai", renewed.approval_token.as_deref())
                .unwrap();
            let posted = fetcher.posted();
            assert_eq!(posted.len(), 1);
            let sent: serde_json::Value = serde_json::from_str(&posted[0]).unwrap();
            assert_eq!(sent["messages"][0]["content"], renewed.system_prompt);
            assert_eq!(sent["messages"][1]["content"], renewed.user_content);
            assert_eq!(sent["model"], reply.model);
            for private in [
                "SYNTHETIC-PNR-WITHHOLD",
                "Synthetic Private Passenger",
                "synthetic-only-no-real-authority",
            ] {
                assert!(!posted[0].contains(private));
            }
            if change == "fact" {
                assert!(posted[0].contains("SYN202"));
            }
            if change == "model" {
                assert_eq!(reply.model, "synthetic-model-after");
            }
            if change == "instruction" {
                assert_eq!(
                    sent["messages"][0]["content"],
                    "Synthetic changed instruction"
                );
            }
            assert_eq!(first.list_assist_activity(&trip.id).unwrap().len(), 1);
            assert_eq!(
                fetcher.calls(),
                vec!["https://api.openai.com/v1/chat/completions".to_owned()]
            );
            drop(second);
            drop(first);
            crate::tests::cleanup_database(database);
        }
    }
}
