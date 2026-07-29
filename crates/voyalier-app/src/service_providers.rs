//! `AppService` — BYOK providers, models, on-device AI, and app settings.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    /// The configured state of every supported AI provider. Reports only whether
    /// a key is stored (`has_key`) plus the chosen model — never the key itself.
    pub fn list_providers(&self) -> Result<Vec<ProviderConfig>, AppError> {
        let connection = self.connection()?;
        PROVIDERS
            .iter()
            .map(|info| self.build_provider_config(&connection, info.id))
            .collect()
    }

    /// Store a BYOK API key for a cloud provider in the OS keychain. The key is
    /// consumed here and never returned, logged, or written to the database.
    pub fn set_provider_key(&self, provider: &str, key: &str) -> Result<ProviderConfig, AppError> {
        let id = validate_provider_id(provider)?;
        if !provider_info(id).key_required {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "this provider runs locally and does not use an API key",
                "field",
                "provider",
            ));
        }
        let key = validate_api_key(key)?;
        self.secrets.set(&key_account(id), &key)?;
        let connection = self.connection()?;
        self.build_provider_config(&connection, id)
    }

    /// Remove a provider's stored API key from the keychain.
    pub fn clear_provider_key(&self, provider: &str) -> Result<ProviderConfig, AppError> {
        let id = validate_provider_id(provider)?;
        self.secrets.delete(&key_account(id))?;
        let connection = self.connection()?;
        self.build_provider_config(&connection, id)
    }

    /// Check a BYOK key against its provider before storing it, by issuing a
    /// cheap read-only request with the key in the auth header. Nothing is stored
    /// or logged — the key is consumed here and only placed in the outgoing
    /// header. A clear rejection (401/403) is authoritative; any reach failure or
    /// odd status is reported as `unreachable` so a transient hiccup never looks
    /// like a bad key. Keyless providers (Ollama) are rejected as invalid input.
    pub fn validate_provider_key(
        &self,
        provider: &str,
        key: &str,
    ) -> Result<KeyValidation, AppError> {
        // Which endpoint, which headers, what a keyless provider means, and what
        // a reply is worth all belong to core. This adds only the fetch.
        let id = validate_provider_id(provider)?;
        let request = build_key_validation_request(id, key)?;
        let header_refs: Vec<(&str, &str)> = request
            .headers
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
            .collect();
        Ok(interpret_key_validation(
            self.fetcher
                .get_status(request.url, &header_refs)
                .map_err(|_| ()),
        ))
    }

    /// Download (pull) an on-device model into a running Ollama. Best-effort and
    /// self-contained: the request goes only to localhost, and a failure — Ollama
    /// not running, an unknown tag — is returned as `ok: false` with a readable
    /// message rather than an error the UI has to decode. The download can take
    /// several minutes for a multi-gigabyte model.
    pub fn pull_local_model(&self, model: &str) -> Result<LocalModelPullResult, AppError> {
        let model = validate_model_name(model)?;
        let body = build_pull_body(&model);
        match self.fetcher.post_json_long(OLLAMA_PULL_URL, &body) {
            Ok(response) => match interpret_pull_response(&response) {
                Ok(()) => Ok(LocalModelPullResult {
                    ok: true,
                    message: format!("{model} is downloaded and ready."),
                }),
                Err(reason) => Ok(LocalModelPullResult {
                    ok: false,
                    message: reason,
                }),
            },
            Err(_) => Ok(LocalModelPullResult {
                ok: false,
                message:
                    "Could not reach Ollama. Make sure it is installed and running, then try again."
                        .to_owned(),
            }),
        }
    }

    /// Set a provider's chosen model (stored locally in the database).
    pub fn set_provider_model(
        &self,
        provider: &str,
        model: &str,
    ) -> Result<ProviderConfig, AppError> {
        let id = validate_provider_id(provider)?;
        let model = validate_model_name(model)?;
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO provider_settings (provider, model) VALUES (?1, ?2)
                 ON CONFLICT(provider) DO UPDATE SET model = excluded.model",
                params![id.as_str(), model],
            )
            .map_err(storage_error)?;
        self.build_provider_config(&connection, id)
    }

    fn build_provider_config(
        &self,
        connection: &Connection,
        id: ProviderId,
    ) -> Result<ProviderConfig, AppError> {
        let info = provider_info(id);
        let model = connection
            .query_row(
                "SELECT model FROM provider_settings WHERE provider = ?1",
                params![id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        let has_key = info.key_required && self.secrets.has(&key_account(id));
        Ok(ProviderConfig {
            id,
            label: info.label.to_owned(),
            key_required: info.key_required,
            has_key,
            model,
        })
    }

    /// Read a durable app-level setting from the KV store, or `None` if unset.
    /// Values are opaque strings; callers own any JSON encoding. Used for the
    /// updater's one-time auto-check consent and skipped/staged/last-seen
    /// versions — never trip content or secrets.
    pub fn get_app_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        let key = validate_setting_key(key)?;
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)
    }

    /// Write a durable app-level setting to the KV store (upsert). The value is
    /// stored verbatim and its `updated_at` refreshed on every write.
    pub fn set_app_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let key = validate_setting_key(key)?;
        let value = validate_setting_value(value)?;
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![key, value, now_rfc3339()],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    /// Detect an optional on-device AI runtime (Ollama) by probing its localhost
    /// `/api/tags` endpoint. Best-effort and infallible: an unreachable runtime
    /// reports `available: false`. No inference runs and nothing leaves the
    /// device — Voyalier stays fully usable whatever this returns.
    pub fn detect_local_ai(&self) -> LocalAiStatus {
        match self.fetcher.fetch_text(OLLAMA_TAGS_URL) {
            Ok(body) => LocalAiStatus::from_tags_body(&body),
            Err(_) => LocalAiStatus::unavailable(),
        }
    }
}
