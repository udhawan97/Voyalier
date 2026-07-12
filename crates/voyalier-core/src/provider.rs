//! Provider catalog and validation for optional BYOK AI providers.
//!
//! This module is IO-free and never touches secrets. It defines the supported
//! providers and validates ids, API keys, and model names. **No API key value
//! ever appears in a type defined here** — `ProviderConfig` reports only whether
//! a key is present (`has_key`), never the key itself. Keys live in the OS
//! keychain, set through an input type and never returned or logged.

use serde::{Deserialize, Serialize};

use crate::assist::ANTHROPIC_VERSION;
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

/// The verdict of a live check of a BYOK key against its provider. Carries no key
/// and no response body — only a coarse status and a human message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyValidationStatus {
    /// The provider accepted the key.
    Valid,
    /// The provider actively rejected the key (401/403) — a bad or revoked key.
    Rejected,
    /// The provider could not be reached or answered inconclusively — offline, a
    /// transient error, or an unexpected status. The key may still be fine.
    Unreachable,
}

/// The outcome of validating a provider key. Never carries the key itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValidation {
    pub status: KeyValidationStatus,
    pub message: String,
}

/// The cheap, read-only endpoint used to prove a BYOK key works. `None` for
/// keyless providers (Ollama), which have no key to validate.
pub fn provider_validation_endpoint(id: ProviderId) -> Option<&'static str> {
    match id {
        ProviderId::OpenAi => Some("https://api.openai.com/v1/models"),
        ProviderId::Anthropic => Some("https://api.anthropic.com/v1/models"),
        ProviderId::Ollama => None,
    }
}

/// The auth headers to send when validating `id`'s key. Empty for keyless
/// providers. The key is placed only in the returned header value.
pub fn provider_validation_headers(id: ProviderId, key: &str) -> Vec<(String, String)> {
    match id {
        ProviderId::OpenAi => vec![("Authorization".to_owned(), format!("Bearer {key}"))],
        ProviderId::Anthropic => vec![
            ("x-api-key".to_owned(), key.to_owned()),
            ("anthropic-version".to_owned(), ANTHROPIC_VERSION.to_owned()),
        ],
        ProviderId::Ollama => Vec::new(),
    }
}

/// Interpret a validation request's HTTP status into a verdict. A 2xx means the
/// key works; 401/403 is an authoritative rejection; anything else is treated as
/// inconclusive so a transient hiccup never looks like a bad key.
pub fn interpret_key_validation(status: u16) -> KeyValidation {
    match status {
        200..=299 => KeyValidation {
            status: KeyValidationStatus::Valid,
            message: "The provider accepted this key.".to_owned(),
        },
        401 | 403 => KeyValidation {
            status: KeyValidationStatus::Rejected,
            message: "The provider rejected this key. Check it and try again.".to_owned(),
        },
        other => KeyValidation {
            status: KeyValidationStatus::Unreachable,
            message: format!("Could not verify the key (the provider replied {other})."),
        },
    }
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

    #[test]
    fn key_validation_maps_status_to_verdict() {
        assert_eq!(
            interpret_key_validation(200).status,
            KeyValidationStatus::Valid
        );
        assert_eq!(
            interpret_key_validation(204).status,
            KeyValidationStatus::Valid
        );
        assert_eq!(
            interpret_key_validation(401).status,
            KeyValidationStatus::Rejected
        );
        assert_eq!(
            interpret_key_validation(403).status,
            KeyValidationStatus::Rejected
        );
        // A server error is inconclusive, not a rejection.
        assert_eq!(
            interpret_key_validation(500).status,
            KeyValidationStatus::Unreachable
        );
        assert_eq!(
            interpret_key_validation(429).status,
            KeyValidationStatus::Unreachable
        );
    }

    #[test]
    fn validation_targets_only_cloud_providers() {
        assert!(provider_validation_endpoint(ProviderId::OpenAi).is_some());
        assert!(provider_validation_endpoint(ProviderId::Anthropic).is_some());
        assert!(provider_validation_endpoint(ProviderId::Ollama).is_none());
    }

    #[test]
    fn validation_headers_carry_the_key_per_provider() {
        let openai = provider_validation_headers(ProviderId::OpenAi, "sk-abc");
        assert_eq!(
            openai,
            vec![("Authorization".to_owned(), "Bearer sk-abc".to_owned())]
        );

        let anthropic = provider_validation_headers(ProviderId::Anthropic, "sk-ant");
        assert!(anthropic.contains(&("x-api-key".to_owned(), "sk-ant".to_owned())));
        assert!(
            anthropic
                .iter()
                .any(|(name, value)| name == "anthropic-version" && value == ANTHROPIC_VERSION)
        );

        assert!(provider_validation_headers(ProviderId::Ollama, "x").is_empty());
    }

    #[test]
    fn key_validation_status_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&KeyValidationStatus::Valid).expect("ser"),
            "\"valid\""
        );
        assert_eq!(
            serde_json::to_string(&KeyValidationStatus::Rejected).expect("ser"),
            "\"rejected\""
        );
        assert_eq!(
            serde_json::to_string(&KeyValidationStatus::Unreachable).expect("ser"),
            "\"unreachable\""
        );
    }
}
