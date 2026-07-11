//! Provider catalog and validation for optional BYOK AI providers.
//!
//! This module is IO-free and never touches secrets. It defines the supported
//! providers and validates ids, API keys, and model names. **No API key value
//! ever appears in a type defined here** — `ProviderConfig` reports only whether
//! a key is present (`has_key`), never the key itself. Keys live in the OS
//! keychain, set through an input type and never returned or logged.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};

/// The longest API key Voyalier will store — generous, but bounds pathological input.
pub const MAX_API_KEY_LEN: usize = 500;
/// The longest model identifier Voyalier will store.
pub const MAX_MODEL_LEN: usize = 200;

/// A supported AI provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderId {
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "ollama")]
    Ollama,
}

impl ProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderId::OpenAi => "openai",
            ProviderId::Anthropic => "anthropic",
            ProviderId::Ollama => "ollama",
        }
    }
}

/// Static description of a provider (no user data, no secrets).
#[derive(Debug, Clone, Copy)]
pub struct ProviderInfo {
    pub id: ProviderId,
    pub label: &'static str,
    /// Cloud providers need a BYOK key; Ollama runs locally and needs none.
    pub key_required: bool,
}

/// The supported providers. Ollama is local/keyless; the others are BYOK cloud.
pub const PROVIDERS: &[ProviderInfo] = &[
    ProviderInfo {
        id: ProviderId::OpenAi,
        label: "OpenAI",
        key_required: true,
    },
    ProviderInfo {
        id: ProviderId::Anthropic,
        label: "Anthropic",
        key_required: true,
    },
    ProviderInfo {
        id: ProviderId::Ollama,
        label: "Ollama (on-device)",
        key_required: false,
    },
];

/// A provider's current configuration. **Never carries the API key** — only
/// whether one is stored (`has_key`) plus the user-chosen model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: ProviderId,
    pub label: String,
    pub key_required: bool,
    pub has_key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// Resolve a wire string to a provider id, or a validation error.
pub fn validate_provider_id(value: &str) -> Result<ProviderId, AppError> {
    match value {
        "openai" => Ok(ProviderId::OpenAi),
        "anthropic" => Ok(ProviderId::Anthropic),
        "ollama" => Ok(ProviderId::Ollama),
        _ => Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "unknown provider",
            "field",
            "provider",
        )),
    }
}

/// The static description for a provider id.
pub fn provider_info(id: ProviderId) -> &'static ProviderInfo {
    PROVIDERS
        .iter()
        .find(|info| info.id == id)
        .expect("every ProviderId has a catalog entry")
}

/// Validate a submitted API key: non-empty after trimming, bounded length.
/// Format is intentionally not checked — providers vary and Voyalier never
/// interprets the key, only stores it.
pub fn validate_api_key(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "API key is required",
            "field",
            "key",
        ));
    }
    if trimmed.chars().count() > MAX_API_KEY_LEN {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "API key is longer than Voyalier will store",
            "field",
            "key",
        ));
    }
    Ok(trimmed.to_owned())
}

/// Validate a model identifier: non-empty after trimming, bounded length.
pub fn validate_model_name(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "model is required",
            "field",
            "model",
        ));
    }
    if trimmed.chars().count() > MAX_MODEL_LEN {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "model name is too long",
            "field",
            "model",
        ));
    }
    Ok(trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ids_round_trip_on_the_wire() {
        for (id, wire) in [
            (ProviderId::OpenAi, "\"openai\""),
            (ProviderId::Anthropic, "\"anthropic\""),
            (ProviderId::Ollama, "\"ollama\""),
        ] {
            assert_eq!(serde_json::to_string(&id).expect("ser"), wire);
            assert_eq!(id.as_str(), wire.trim_matches('"'));
            assert_eq!(validate_provider_id(id.as_str()).expect("parse"), id);
        }
        assert_eq!(
            validate_provider_id("bard").expect_err("unknown").code,
            ErrorCode::ValidationInvalidInput
        );
    }

    #[test]
    fn catalog_marks_only_cloud_providers_key_required() {
        assert!(provider_info(ProviderId::OpenAi).key_required);
        assert!(provider_info(ProviderId::Anthropic).key_required);
        assert!(!provider_info(ProviderId::Ollama).key_required);
    }

    #[test]
    fn api_key_validation_trims_and_bounds() {
        assert_eq!(
            validate_api_key("  sk-fake-123  ").expect("ok"),
            "sk-fake-123"
        );
        assert_eq!(
            validate_api_key("   ").expect_err("empty").code,
            ErrorCode::ValidationInvalidInput
        );
        assert_eq!(
            validate_api_key(&"k".repeat(MAX_API_KEY_LEN + 1))
                .expect_err("too long")
                .code,
            ErrorCode::ValidationInvalidInput
        );
    }

    #[test]
    fn model_validation_trims_and_bounds() {
        assert_eq!(validate_model_name("  gpt-x  ").expect("ok"), "gpt-x");
        assert_eq!(
            validate_model_name("").expect_err("empty").code,
            ErrorCode::ValidationInvalidInput
        );
    }

    #[test]
    fn provider_config_never_serializes_a_key_field() {
        let config = ProviderConfig {
            id: ProviderId::OpenAi,
            label: "OpenAI".to_owned(),
            key_required: true,
            has_key: true,
            model: Some("gpt-x".to_owned()),
        };
        let json = serde_json::to_string(&config).expect("ser");
        assert!(json.contains("\"hasKey\":true"));
        assert!(!json.to_lowercase().contains("\"key\""));
        assert!(!json.to_lowercase().contains("secret"));
    }
}
