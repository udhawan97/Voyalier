//! Detection of an optional on-device AI runtime (Ollama).
//!
//! Voyalier never requires AI. This module only *detects* whether the user has
//! a local Ollama running and which models are installed, by parsing the
//! response of its `/api/tags` endpoint. Detection is best-effort: anything
//! unparseable means "no models found", never an error. No inference happens
//! here and nothing leaves the device — the probe is a localhost GET.

use serde::{Deserialize, Serialize};

/// The localhost endpoint Voyalier probes for a running Ollama.
pub const OLLAMA_TAGS_URL: &str = "http://localhost:11434/api/tags";

/// One locally-installed model reported by the runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModel {
    /// The model tag, e.g. `llama3.2:latest`, verbatim from the runtime.
    pub name: String,
}

/// Whether an on-device AI runtime was detected, and its installed models.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiStatus {
    /// The runtime probed. Currently always `ollama`.
    pub provider: String,
    /// True when the runtime answered the probe.
    pub available: bool,
    /// Installed models (may be empty even when available).
    pub models: Vec<LocalAiModel>,
}

impl LocalAiStatus {
    /// The status when no runtime is reachable.
    pub fn unavailable() -> Self {
        Self {
            provider: "ollama".to_owned(),
            available: false,
            models: Vec::new(),
        }
    }

    /// The status when the runtime answered with the given raw `/api/tags` body.
    pub fn from_tags_body(body: &str) -> Self {
        Self {
            provider: "ollama".to_owned(),
            available: true,
            models: parse_ollama_models(body),
        }
    }
}

/// Parse Ollama's `/api/tags` response into installed models. Total over
/// malformed input: unparseable JSON yields an empty list. Model order is
/// preserved as sent; duplicates by name are collapsed.
pub fn parse_ollama_models(json: &str) -> Vec<LocalAiModel> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let mut models: Vec<LocalAiModel> = value
        .get("models")
        .and_then(|models| models.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.get("name").and_then(|name| name.as_str()))
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(|name| LocalAiModel {
                    name: name.to_owned(),
                })
                .collect()
        })
        .unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    models.retain(|model| seen.insert(model.name.clone()));
    models
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_installed_models_in_order_without_duplicates() {
        let body = r#"{
            "models": [
                { "name": "llama3.2:latest", "size": 2019393189 },
                { "name": "qwen2.5:7b", "size": 4683087332 },
                { "name": "llama3.2:latest", "size": 2019393189 }
            ]
        }"#;
        let models = parse_ollama_models(body);
        assert_eq!(
            models,
            vec![
                LocalAiModel {
                    name: "llama3.2:latest".to_owned()
                },
                LocalAiModel {
                    name: "qwen2.5:7b".to_owned()
                },
            ]
        );
    }

    #[test]
    fn a_reachable_runtime_with_no_models_is_available_but_empty() {
        let status = LocalAiStatus::from_tags_body(r#"{ "models": [] }"#);
        assert!(status.available);
        assert!(status.models.is_empty());
        assert_eq!(status.provider, "ollama");
    }

    #[test]
    fn malformed_bodies_never_panic_and_yield_no_models() {
        assert!(parse_ollama_models("not json").is_empty());
        assert!(parse_ollama_models(r#"{ "models": "nope" }"#).is_empty());
        assert!(parse_ollama_models("{}").is_empty());
        // A reachable-but-garbage response is still "available", just empty.
        assert!(LocalAiStatus::from_tags_body("garbage").available);
    }

    #[test]
    fn the_unavailable_status_reports_no_models() {
        let status = LocalAiStatus::unavailable();
        assert!(!status.available);
        assert!(status.models.is_empty());
    }
}
