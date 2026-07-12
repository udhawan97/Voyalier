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

/// The localhost endpoint that pulls (downloads) a model into a running Ollama.
pub const OLLAMA_PULL_URL: &str = "http://localhost:11434/api/pull";

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

/// The outcome of an in-app model download (an Ollama `/api/pull`). Reports
/// success plus a human message; never carries the raw runtime response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelPullResult {
    /// True when the model finished downloading and is ready to use.
    pub ok: bool,
    /// A short, human-readable status — a confirmation or the reason it failed.
    pub message: String,
}

/// Build the `/api/pull` request body for `model`. Non-streaming so the runtime
/// answers once, when the download is complete.
pub fn build_pull_body(model: &str) -> String {
    serde_json::json!({ "model": model, "stream": false }).to_string()
}

/// Interpret Ollama's non-streaming `/api/pull` response. Ollama reports a final
/// `{"status":"success"}` on completion and an `{"error":"…"}` on failure; a
/// non-streaming response can also arrive as newline-delimited JSON, so the last
/// non-empty line is authoritative. Anything unrecognized is treated as a failure
/// so a partial/garbled response is never mistaken for success.
pub fn interpret_pull_response(body: &str) -> Result<(), String> {
    let last = body
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .unwrap_or("");
    let Ok(value) = serde_json::from_str::<serde_json::Value>(last) else {
        return Err("The download did not complete. Please try again.".to_owned());
    };
    if let Some(error) = value.get("error").and_then(|error| error.as_str()) {
        return Err(error.to_owned());
    }
    match value.get("status").and_then(|status| status.as_str()) {
        Some("success") => Ok(()),
        _ => Err("The download did not complete. Please try again.".to_owned()),
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

    #[test]
    fn pull_body_names_the_model_and_disables_streaming() {
        let body = build_pull_body("gemma4:12b-it-qat");
        let value: serde_json::Value = serde_json::from_str(&body).expect("json");
        assert_eq!(value["model"], "gemma4:12b-it-qat");
        assert_eq!(value["stream"], false);
    }

    #[test]
    fn a_success_status_is_a_completed_pull() {
        assert!(interpret_pull_response(r#"{"status":"success"}"#).is_ok());
        // Non-streaming can still arrive as several JSON lines; the last wins.
        assert!(
            interpret_pull_response(
                "{\"status\":\"pulling manifest\"}\n{\"status\":\"success\"}\n"
            )
            .is_ok()
        );
    }

    #[test]
    fn an_error_or_garbled_pull_is_a_failure() {
        assert_eq!(
            interpret_pull_response(r#"{"error":"model not found"}"#),
            Err("model not found".to_owned())
        );
        // In-progress-only (never reached success) is a failure, not success.
        assert!(interpret_pull_response(r#"{"status":"pulling manifest"}"#).is_err());
        assert!(interpret_pull_response("not json").is_err());
        assert!(interpret_pull_response("").is_err());
    }
}
