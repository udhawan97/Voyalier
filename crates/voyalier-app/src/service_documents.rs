//! `AppService` — imported evidence and the facts confirmed from it.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    pub fn import_document(&self, input: ImportDocumentInput) -> Result<ImportResult, AppError> {
        // Email is input-only. `parse_import` bounds the raw input, extracts the
        // confirmation body, bounds that, and dispatches to the parser for the
        // resulting kind — so everything downstream (dedup, sealing, field
        // spans) sees the extracted body, never the raw email.
        let DocumentParse {
            kind,
            content,
            label_hint: email_subject,
            char_count,
            parser_id,
            parser_version,
            candidates: parsed_candidates,
        } = parse_import(input.kind, &input.content)?;
        let hash = sha256_hex(content.as_bytes());
        let label = input
            .label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .map(str::to_owned)
            .or_else(|| {
                email_subject
                    .map(|subject| subject.trim().to_owned())
                    .filter(|subject| !subject.is_empty())
            })
            .unwrap_or_else(|| {
                match kind {
                    DocumentKind::Html => "Imported HTML",
                    DocumentKind::PastedText => "Pasted text",
                    // Unreachable: email was normalized to a body kind above.
                    DocumentKind::Email => "Imported email",
                }
                .to_owned()
            });
        let now = now_rfc3339();
        let document_id = new_id("doc");
        let parser_run_id = new_id("run");

        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        self.records(&transaction).trip(&input.trip_id)?;

        if let Some(existing_id) = transaction
            .query_row(
                "SELECT id FROM source_documents WHERE trip_id = ?1 AND content_hash = ?2",
                params![input.trip_id, hash],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?
        {
            return Err(AppError::with_detail(
                ErrorCode::DocumentDuplicate,
                "document was already imported for this trip",
                "existingDocumentId",
                existing_id,
            ));
        }

        // The imported body carries the same confirmation codes and traveler
        // names as the parsed facts, so records seals it at rest.
        let document = SourceDocument {
            id: document_id,
            trip_id: input.trip_id.clone(),
            // The normalized body kind that was actually stored (email input
            // becomes html/pasted_text), not the raw input kind.
            kind,
            label,
            content_hash: hash,
            char_count,
            imported_at: now.clone(),
        };
        self.records(&transaction)
            .insert_document(&document, &content)?;
        let active_facts = self.records(&transaction).confirmed_facts(&input.trip_id)?;
        transaction
            .execute(
                "INSERT INTO parser_runs (id, trip_id, document_id, parser_id, parser_version, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    parser_run_id,
                    input.trip_id,
                    document.id,
                    parser_id,
                    parser_version,
                    now
                ],
            )
            .map_err(storage_error)?;

        let mut candidates = Vec::new();
        let mut duplicates_ignored = 0;
        for parsed in parsed_candidates {
            let amends_fact_id =
                match classify_amendment(parsed.fact_type, &parsed.payload, &active_facts) {
                    AmendmentMatch::Ordinary => None,
                    AmendmentMatch::Duplicate { .. } => {
                        duplicates_ignored += 1;
                        continue;
                    }
                    AmendmentMatch::Amendment { fact_id } => Some(fact_id),
                };
            let candidate = CandidateFact {
                id: new_id("cand"),
                trip_id: input.trip_id.clone(),
                document_id: document.id.clone(),
                parser_run_id: parser_run_id.clone(),
                fact_type: parsed.fact_type,
                payload: parsed.payload,
                method: parsed.method,
                field_spans: parsed.field_spans,
                warnings: parsed.warnings,
                status: CandidateStatus::Pending,
                created_at: now.clone(),
                resolved_at: None,
                amends_fact_id,
            };
            self.records(&transaction).insert_candidate(&candidate)?;
            candidates.push(candidate);
        }

        transaction.commit().map_err(storage_error)?;

        // The same record that was stored, so what is returned cannot describe
        // something other than what is on disk.
        Ok(ImportResult {
            document,
            parser_run_id,
            candidates,
            duplicates_ignored,
        })
    }

    pub fn list_candidates(
        &self,
        trip_id: &str,
        status: Option<CandidateStatus>,
    ) -> Result<Vec<CandidateFact>, AppError> {
        let connection = self.connection()?;
        let records = self.records(&connection);
        records.trip(trip_id)?;
        records.candidates(trip_id, status)
    }

    /// Every document imported into a trip, newest first, each with the counts
    /// that make deleting it an informed choice. Bodies are never read here —
    /// this list must stay cheap, and an unsealed body has no business in a
    /// listing.
    pub fn list_documents(&self, trip_id: &str) -> Result<Vec<DocumentSummary>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let mut statement = connection
            .prepare(
                "SELECT d.id, d.trip_id, d.kind, d.label, d.content_hash, d.char_count, d.imported_at,
                        (SELECT COUNT(*) FROM candidate_facts c
                          WHERE c.document_id = d.id AND c.status = 'pending'),
                        (SELECT COUNT(*) FROM candidate_facts c
                          WHERE c.document_id = d.id AND c.status = 'confirmed')
                 FROM source_documents d
                 WHERE d.trip_id = ?1
                 ORDER BY d.imported_at DESC, d.id DESC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok(DocumentSummary {
                    document: SourceDocument {
                        id: row.get(0)?,
                        trip_id: row.get(1)?,
                        kind: sql_to_enum(row.get::<_, String>(2)?)?,
                        label: row.get(3)?,
                        content_hash: row.get(4)?,
                        char_count: row.get(5)?,
                        imported_at: row.get(6)?,
                    },
                    pending_count: row.get(7)?,
                    confirmed_count: row.get(8)?,
                })
            })
            .map_err(storage_error)?;
        collect_rows(rows)
    }

    /// One document's original text, unsealed on demand. This is the only path
    /// that returns an imported body, and it exists so a traveler can see what
    /// they handed over — the same bytes the parser read.
    pub fn get_document(&self, document_id: &str) -> Result<DocumentContent, AppError> {
        let connection = self.connection()?;
        self.records(&connection).document_content(document_id)
    }

    /// Delete an imported document.
    ///
    /// Cascade rules, chosen deliberately (see the audit plan's 6a):
    /// - Still-pending candidates go too — they are unreviewed derivatives of a
    ///   body the traveler just discarded, and reviewing evidence that no longer
    ///   exists is not a flow worth keeping.
    /// - Facts already confirmed from it STAY. The traveler approved those; they
    ///   are part of the itinerary now. They are flagged `source_removed` so the
    ///   UI stops offering evidence it cannot show. The FK does the nulling of
    ///   `candidate_id`; the flag is what keeps that from reading as "manual".
    pub fn delete_document(&self, document_id: &str) -> Result<(), AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        // Flag surviving facts BEFORE the delete: once the candidate rows are
        // gone the join that identifies them is gone too.
        transaction
            .execute(
                "UPDATE confirmed_facts SET source_removed = 1
                 WHERE candidate_id IN
                   (SELECT id FROM candidate_facts WHERE document_id = ?1)",
                params![document_id],
            )
            .map_err(storage_error)?;
        transaction
            .execute(
                "UPDATE confirmed_fact_versions SET source_removed = 1
                 WHERE candidate_id IN
                   (SELECT id FROM candidate_facts WHERE document_id = ?1)",
                params![document_id],
            )
            .map_err(storage_error)?;
        let deleted = transaction
            .execute(
                "DELETE FROM source_documents WHERE id = ?1",
                params![document_id],
            )
            .map_err(storage_error)?;
        if deleted == 0 {
            return Err(AppError::new(
                ErrorCode::DocumentNotFound,
                "that document no longer exists",
            ));
        }
        transaction.commit().map_err(storage_error)?;
        Ok(())
    }

    pub fn confirm_candidate(
        &self,
        input: ConfirmCandidateInput,
    ) -> Result<(CandidateFact, ConfirmedFact), AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let mut candidate = self.records(&transaction).candidate(&input.candidate_id)?;
        ensure_candidate_pending(&candidate)?;

        let payload = input
            .edited_payload
            .unwrap_or_else(|| candidate.payload.clone());
        validate_fact_payload(candidate.fact_type, &payload)?;
        let corrected_fields = changed_payload_fields(&candidate.payload, &payload);
        let mut confirmed = ConfirmedFact {
            id: new_id("fact"),
            trip_id: candidate.trip_id.clone(),
            fact_type: candidate.fact_type,
            payload,
            method: candidate.method,
            candidate_id: Some(candidate.id.clone()),
            corrected_fields,
            confirmed_at: now_rfc3339(),
            source_removed: false,
        };
        // Reclassify the final, possibly edited payload against the current
        // approved state inside the same transaction as the decision. The
        // candidate's stored pointer is only a preview from import time.
        let active_facts = self
            .records(&transaction)
            .confirmed_facts(&candidate.trip_id)?;
        let amendment = classify_amendment(candidate.fact_type, &confirmed.payload, &active_facts);
        match (amendment, input.amendment_action) {
            (AmendmentMatch::Duplicate { .. }, _) => {
                return Err(AppError::new(
                    ErrorCode::ValidationInvalidInput,
                    "this confirmation is already approved",
                ));
            }
            (
                AmendmentMatch::Amendment {
                    fact_id: previous_id,
                },
                Some(AmendmentAction::Replace),
            ) => {
                let version = transaction
                    .query_row(
                        "SELECT version FROM confirmed_facts WHERE id=?1 AND active=1",
                        params![previous_id],
                        |row| row.get::<_, u32>(0),
                    )
                    .optional()
                    .map_err(storage_error)?
                    .ok_or_else(|| {
                        AppError::new(
                            ErrorCode::ValidationInvalidInput,
                            "the matched fact changed; review the latest version",
                        )
                    })?;
                if input.expected_amendment_fact_id.as_deref() != Some(previous_id.as_str())
                    || input.expected_amendment_revision != Some(version)
                {
                    return Err(AppError::new(
                        ErrorCode::ValidationInvalidInput,
                        "the matched fact changed after review; compare the latest version before replacing it",
                    ));
                }
                let snapshot_id = new_id("fact_version");
                self.records(&transaction)
                    .snapshot_confirmed_fact(&previous_id, &snapshot_id)?;
                confirmed.id = previous_id.clone();
                self.records(&transaction).replace_confirmed_fact(
                    &previous_id,
                    version,
                    &confirmed,
                    FactRevisionReason::Amendment,
                    &snapshot_id,
                )?;
            }
            (AmendmentMatch::Ordinary, Some(AmendmentAction::Replace)) => {
                return Err(AppError::new(
                    ErrorCode::ValidationInvalidInput,
                    "this amendment is stale; review the latest approved facts",
                ));
            }
            (AmendmentMatch::Amendment { .. }, Some(AmendmentAction::KeepBoth))
            | (AmendmentMatch::Amendment { .. }, None)
            | (AmendmentMatch::Ordinary, Some(AmendmentAction::KeepBoth))
            | (AmendmentMatch::Ordinary, None) => {
                self.records(&transaction)
                    .insert_confirmed_fact(&confirmed)?;
            }
        }

        candidate.status = CandidateStatus::Confirmed;
        candidate.resolved_at = Some(confirmed.confirmed_at.clone());
        self.records(&transaction)
            .update_candidate_resolution(&candidate)?;
        transaction.commit().map_err(storage_error)?;
        Ok((candidate, confirmed))
    }

    pub fn reject_candidate(&self, candidate_id: &str) -> Result<CandidateFact, AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let mut candidate = self.records(&transaction).candidate(candidate_id)?;
        ensure_candidate_pending(&candidate)?;
        candidate.status = CandidateStatus::Rejected;
        candidate.resolved_at = Some(now_rfc3339());
        self.records(&transaction)
            .update_candidate_resolution(&candidate)?;
        transaction.commit().map_err(storage_error)?;
        Ok(candidate)
    }

    pub fn add_manual_fact(&self, input: AddManualFactInput) -> Result<ConfirmedFact, AppError> {
        validate_fact_payload(input.fact_type, &input.payload)?;
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;
        let confirmed = ConfirmedFact {
            id: new_id("fact"),
            trip_id: input.trip_id,
            fact_type: input.fact_type,
            payload: input.payload,
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: now_rfc3339(),
            source_removed: false,
        };
        self.records(&connection)
            .insert_confirmed_fact(&confirmed)?;
        Ok(confirmed)
    }

    pub fn unconfirm_fact(&self, fact_id: &str) -> Result<(), AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let (candidate_id, active, version) = transaction
            .query_row(
                "SELECT candidate_id, active, version FROM confirmed_facts WHERE id = ?1",
                params![fact_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, u32>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| AppError::new(ErrorCode::FactNotFound, "fact not found"))?;
        if active == 0 || version > 0 {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "amended facts are append-only; restore a previous version instead",
            ));
        }
        transaction
            .execute(
                "DELETE FROM confirmed_facts WHERE id = ?1",
                params![fact_id],
            )
            .map_err(storage_error)?;
        if let Some(candidate_id) = candidate_id {
            transaction
                .execute(
                    "UPDATE candidate_facts SET status = 'pending', resolved_at = NULL WHERE id = ?1",
                    params![candidate_id],
                )
                .map_err(storage_error)?;
        }
        transaction.commit().map_err(storage_error)?;
        Ok(())
    }

    pub fn restore_fact_version(
        &self,
        input: RestoreFactVersionInput,
    ) -> Result<ConfirmedFact, AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let selected = self
            .records(&transaction)
            .confirmed_fact_version(&input.fact_id)?;
        let (current_fact_id, current_version) = transaction
            .query_row(
                "SELECT id, version FROM confirmed_facts WHERE id=?1 AND active=1",
                params![selected.lineage_root_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?)),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| {
                AppError::new(ErrorCode::FactNotFound, "active fact version not found")
            })?;
        if input.expected_current_fact_id.as_deref() != Some(current_fact_id.as_str())
            || input.expected_current_revision != Some(current_version)
        {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "the active fact changed after review; compare the latest version before restoring",
            ));
        }
        let snapshot_id = new_id("fact_version");
        self.records(&transaction)
            .snapshot_confirmed_fact(&selected.lineage_root_id, &snapshot_id)?;
        let mut restored = ConfirmedFact {
            id: selected.lineage_root_id.clone(),
            confirmed_at: now_rfc3339(),
            ..selected.fact
        };
        // The historical row keeps the evidence tombstone, but a deleted
        // candidate cannot be written back through the current table's FK.
        if restored.source_removed {
            restored.candidate_id = None;
        }
        self.records(&transaction).replace_confirmed_fact(
            &restored.id,
            current_version,
            &restored,
            FactRevisionReason::Restore,
            &snapshot_id,
        )?;
        transaction.commit().map_err(storage_error)?;
        Ok(restored)
    }
}
