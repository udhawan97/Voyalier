//! Encrypted custody for binary travel documents that are not parser inputs.

use super::*;

impl AppService {
    pub fn import_attachment(
        &self,
        input: ImportAttachmentInput,
    ) -> Result<AttachmentSummary, AppError> {
        self.vault.require_active_for_attachments()?;
        let label = input.label.trim();
        if label.is_empty() || label.chars().count() > 240 {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "attachment label must contain 1 to 240 characters",
                "field",
                "label",
            ));
        }
        let mime_type = input.mime_type.trim().to_ascii_lowercase();
        if mime_type.is_empty()
            || mime_type.len() > 120
            || !mime_type
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '-' | '+' | '.'))
        {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "attachment MIME type is invalid",
                "field",
                "mimeType",
            ));
        }
        let bytes = BASE64
            .decode(input.content_base64.as_bytes())
            .map_err(|_| {
                AppError::with_detail(
                    ErrorCode::ValidationInvalidInput,
                    "attachment content is not valid base64",
                    "field",
                    "contentBase64",
                )
            })?;
        if bytes.is_empty() {
            return Err(AppError::new(
                ErrorCode::DocumentEmpty,
                "attachment is empty",
            ));
        }
        if bytes.len() > voyalier_core::MAX_ATTACHMENT_BYTES {
            return Err(AppError::new(
                ErrorCode::DocumentTooLarge,
                "attachment exceeds the 20 MiB limit",
            ));
        }
        let supported_signature = match mime_type.as_str() {
            "application/pdf" => bytes.starts_with(b"%PDF-"),
            "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
            "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
            _ => false,
        };
        if !supported_signature {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "only PDF, JPEG and PNG files whose contents match their type are supported",
                "field",
                "mimeType",
            ));
        }
        let content_hash = sha256_hex(&bytes);
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;
        let attachment_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM binary_attachments WHERE trip_id=?1",
                params![input.trip_id],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        if attachment_count >= voyalier_core::MAX_ATTACHMENTS_PER_TRIP as i64 {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "a trip can hold up to 100 binary attachments",
            ));
        }
        if let Some(existing_id) = connection
            .query_row(
                "SELECT id FROM binary_attachments WHERE trip_id=?1 AND content_hash=?2",
                params![input.trip_id, content_hash],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?
        {
            return Err(AppError::with_detail(
                ErrorCode::DocumentDuplicate,
                "attachment was already imported for this trip",
                "existingDocumentId",
                existing_id,
            ));
        }
        let workspace_bytes: i64 = connection
            .query_row(
                "SELECT COALESCE(SUM(byte_count), 0) FROM binary_attachments",
                [],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        let incoming_bytes = i64::try_from(bytes.len()).map_err(|_| {
            AppError::new(
                ErrorCode::DocumentTooLarge,
                "attachment size cannot be represented safely",
            )
        })?;
        let projected_bytes = workspace_bytes.checked_add(incoming_bytes).ok_or_else(|| {
            AppError::new(
                ErrorCode::DocumentTooLarge,
                "encrypted wallet size would overflow",
            )
        })?;
        if projected_bytes > voyalier_core::MAX_ATTACHMENT_WORKSPACE_BYTES as i64 {
            return Err(AppError::new(
                ErrorCode::DocumentTooLarge,
                "the encrypted wallet can hold up to 500 MiB across this workspace so a portable backup remains available",
            ));
        }
        let attachment = AttachmentSummary {
            id: new_id("attachment"),
            trip_id: input.trip_id,
            label: label.to_owned(),
            mime_type,
            byte_count: bytes.len() as u32,
            content_hash,
            imported_at: now_rfc3339(),
        };
        self.records(&connection)
            .insert_attachment(&attachment, &input.content_base64)?;
        Ok(attachment)
    }

    pub fn list_attachments(&self, trip_id: &str) -> Result<Vec<AttachmentSummary>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        self.records(&connection).attachments(trip_id)
    }

    pub fn get_attachment(&self, attachment_id: &str) -> Result<AttachmentContent, AppError> {
        let connection = self.connection()?;
        self.records(&connection).attachment_content(attachment_id)
    }

    pub fn delete_attachment(&self, attachment_id: &str) -> Result<(), AppError> {
        let mut connection = self.connection()?;
        let trip_id = connection
            .query_row(
                "SELECT trip_id FROM binary_attachments WHERE id=?1",
                params![attachment_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::DocumentNotFound,
                    "that attachment no longer exists",
                )
            })?;
        let transaction = connection.transaction().map_err(storage_error)?;
        if let Some(mut profile) = self.records(&transaction).concierge_profile(&trip_id)? {
            let mut changed_profile = false;
            for link in &mut profile.wallet_links {
                if link.source_attachment_id.as_deref() == Some(attachment_id) {
                    link.source_attachment_id = None;
                    changed_profile = true;
                }
            }
            if changed_profile {
                profile.updated_at = Some(now_rfc3339());
                let profile = profile.validate()?;
                self.records(&transaction)
                    .upsert_concierge_profile(&profile, &new_id("concierge"))?;
            }
        }
        let changed = transaction
            .execute(
                "DELETE FROM binary_attachments WHERE id=?1",
                params![attachment_id],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err(AppError::new(
                ErrorCode::DocumentNotFound,
                "that attachment no longer exists",
            ));
        }
        transaction.commit().map_err(storage_error)
    }
}
