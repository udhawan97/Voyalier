//! `AppService` — optional AI: preview, run, draft, and the activity log.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

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
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        let confirmed_facts = self.records(&connection).confirmed_facts(trip_id)?;
        let model = connection
            .query_row(
                "SELECT model FROM provider_settings WHERE provider = ?1",
                params![id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        let mut preview = build_assist_preview(
            &trip,
            &confirmed_facts,
            id,
            model.as_deref(),
            &now_rfc3339(),
        );
        // Apply the user's custom assist instruction, if they set one. Run reuses
        // this preview, so the sent request matches exactly what is shown.
        apply_prompt_override(
            &mut preview,
            effective_ai_prompt(&connection, AiPromptKind::Assist)?,
        );
        Ok(preview)
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
                self.set_app_setting(ai_prompt_key(kind), trimmed)?;
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

    /// Run assist for a trip: build the same redacted request the preview shows
    /// and send it to the chosen provider. The explicit call is the consent. For
    /// Ollama nothing leaves the device; for a cloud provider the redacted
    /// request goes to that provider using the key stored in the OS keychain —
    /// which is placed only in the outgoing auth header and is never logged,
    /// returned, or stored anywhere else. Every successful call is logged
    /// (metadata only).
    pub fn run_assist(&self, trip_id: &str, provider: &str) -> Result<AssistReply, AppError> {
        let id = validate_provider_id(provider)?;
        // Reuse the preview: identical redaction, grounding, and system prompt.
        let preview = self.preview_assist(trip_id, provider)?;
        let (model, text) = self.dispatch_assist(id, &preview)?;
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
        // Reuse the preview, exactly as run_assist does: the consent step and
        // the bytes actually sent are then the same object, not two builds that
        // happen to agree.
        let preview = build_draft_preview(&trip, &doc_pairs, model.as_deref(), &system_prompt);
        // On-device only: Ollama is keyless, so nothing leaves this machine.
        let request = build_assist_request(
            ProviderId::Ollama,
            preview.model.as_deref(),
            &preview.system_prompt,
            &preview.user_content,
            None,
        )?;
        let response = self.fetcher.post_json(request.url, &request.body, &[])?;
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
        preview: &AssistRequestPreview,
    ) -> Result<(String, String), AppError> {
        let key = if provider_info(id).key_required {
            Some(self.require_provider_key(id)?)
        } else {
            None
        };
        let request = build_assist_request(
            id,
            preview.model.as_deref(),
            &preview.system_prompt,
            &preview.user_content,
            key.as_deref(),
        )?;
        let header_refs: Vec<(&str, &str)> = request
            .headers
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
            .collect();
        let response = self
            .fetcher
            .post_json(request.url, &request.body, &header_refs)?;
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
