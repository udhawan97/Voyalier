//! Deterministic preview of the exact request Voyalier would send to an AI
//! provider — the consent step from ADR-0003 — plus the request builders and
//! response parsers for each provider (Ollama, OpenAI, Anthropic). The preview
//! lets the user see precisely what would leave the device before they send it.
//!
//! The preview reuses the same generation-time exclusion as the shareable brief
//! ([`crate::brief`]): confirmation codes and traveler names are stripped from a
//! copy of the plan, so they never enter the preview and therefore could never
//! reach a provider. Only the traveler's own confirmed itinerary is grounded in
//! — never imported document text, which is untrusted. No network happens here;
//! nothing is transmitted.

use serde::{Deserialize, Serialize};

use crate::brief::{RedactionPolicy, TripBrief, build_trip_brief};
use crate::provider::{ProviderId, provider_info};
use crate::types::{AppError, ConfirmedFact, ErrorCode, FactPayload, Trip};

/// The on-device Ollama chat endpoint.
pub const OLLAMA_CHAT_URL: &str = "http://localhost:11434/api/chat";
/// The OpenAI chat-completions endpoint.
pub const OPENAI_CHAT_URL: &str = "https://api.openai.com/v1/chat/completions";
/// The Anthropic messages endpoint.
pub const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
/// The Anthropic API version header value.
pub const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Model used when the user has not chosen one, per provider.
pub const DEFAULT_OLLAMA_MODEL: &str = "llama3.2";
pub const DEFAULT_OPENAI_MODEL: &str = "gpt-4o-mini";
pub const DEFAULT_ANTHROPIC_MODEL: &str = "claude-3-5-haiku-latest";
/// Cap on reply length for providers that require an explicit token budget.
pub const ASSIST_MAX_TOKENS: u32 = 1024;

/// Longest custom AI instruction accepted (well under the app_settings cap).
///
/// Counted in characters (Unicode scalar values), not UTF-16 code units — see
/// `packages/contracts/parity/limits.json`, which holds both languages to this.
pub const MAX_AI_PROMPT_LEN: usize = 6000;

/// The instruction sent with every assist request. Fixed and deterministic so a
/// user can review it once; it forbids inventing high-stakes facts, which
/// Voyalier only ever surfaces from cited sources.
pub const ASSIST_SYSTEM_PROMPT: &str = "You are a careful travel-planning assistant for Voyalier. \
Use only the trip details provided below. Do not invent flights, prices, visa or entry rules, \
health requirements, or safety guidance; if the trip details do not answer a question, say so.";

/// Where a provider's request would go — shown for transparency, never guessed
/// from user data.
pub(crate) fn endpoint_for(id: ProviderId) -> &'static str {
    match id {
        ProviderId::OpenAi => OPENAI_CHAT_URL,
        ProviderId::Anthropic => ANTHROPIC_MESSAGES_URL,
        ProviderId::Ollama => OLLAMA_CHAT_URL,
    }
}

/// A deterministic, redacted preview of the request Voyalier would send to a
/// provider. Built entirely on-device; nothing here is transmitted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistRequestPreview {
    pub provider: ProviderId,
    pub provider_label: String,
    /// The model that would be used, if the user has chosen one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Where the request would go — shown for transparency.
    pub endpoint: String,
    /// True when the request would leave this device (cloud providers); false
    /// for a local provider like Ollama.
    pub leaves_device: bool,
    /// The fixed system instruction.
    pub system_prompt: String,
    /// The exact user message: the traveler's own confirmed itinerary, redacted.
    pub user_content: String,
    /// Field kinds excluded from the request, for transparency.
    pub withheld: Vec<String>,
    /// A citation of what the request is grounded in (e.g. "2 confirmed
    /// flights"). The request carries only these confirmed facts.
    pub grounded_in: Vec<String>,
    /// A rough estimate of the tokens the request would use, for cost awareness.
    pub estimated_tokens: u32,
}

/// Build the preview for `provider`, grounded only in the trip's confirmed facts.
///
/// `model` is the user's chosen model, if any. `generated_at` is supplied by the
/// caller so this stays pure and testable.
pub fn build_assist_preview(
    trip: &Trip,
    facts: &[ConfirmedFact],
    provider: ProviderId,
    model: Option<&str>,
    generated_at: &str,
) -> AssistRequestPreview {
    // Reuse the brief's generation-time exclusion: secrets never enter the copy.
    let brief = build_trip_brief(
        trip,
        facts,
        &[],
        &RedactionPolicy::for_sharing(),
        generated_at,
    );

    let mut withheld = brief.redacted_fields.clone();
    // Only structured, confirmed facts are grounded in — never raw document text.
    withheld.push("Imported document text".to_owned());

    // A plain-language citation of exactly what grounds the request.
    let mut grounded_in = Vec::new();
    if !brief.flights.is_empty() {
        grounded_in.push(format!(
            "{} confirmed {}",
            brief.flights.len(),
            plural(brief.flights.len(), "flight")
        ));
    }
    if !brief.stays.is_empty() {
        grounded_in.push(format!(
            "{} confirmed {}",
            brief.stays.len(),
            plural(brief.stays.len(), "stay")
        ));
    }

    let system_prompt = ASSIST_SYSTEM_PROMPT.to_owned();
    let user_content = format_itinerary(&brief);
    let estimated_tokens = estimate_tokens(&system_prompt, &user_content);

    let info = provider_info(provider);
    AssistRequestPreview {
        provider,
        provider_label: info.label.to_owned(),
        model: model.map(str::to_owned),
        endpoint: endpoint_for(provider).to_owned(),
        leaves_device: !matches!(provider, ProviderId::Ollama),
        estimated_tokens,
        grounded_in,
        system_prompt,
        user_content,
        withheld,
    }
}

pub(crate) fn plural(count: usize, word: &str) -> String {
    if count == 1 {
        word.to_owned()
    } else {
        format!("{word}s")
    }
}

/// A rough token estimate (~4 characters per token) for cost awareness. Not a
/// billing figure — providers tokenize differently — just an order of magnitude.
///
/// Public because a preview's system prompt can be overridden after it is built,
/// and the estimate shown to the traveler has to stay honest — recomputing it
/// with a copy of this formula is how the two drift.
pub fn estimate_tokens(system: &str, user: &str) -> u32 {
    let characters = system.chars().count() + user.chars().count();
    (characters / 4 + 1) as u32
}

/// The model a provider uses when the traveler has not chosen one.
fn default_model(id: ProviderId) -> &'static str {
    match id {
        ProviderId::Ollama => DEFAULT_OLLAMA_MODEL,
        ProviderId::OpenAi => DEFAULT_OPENAI_MODEL,
        ProviderId::Anthropic => DEFAULT_ANTHROPIC_MODEL,
    }
}

/// Everything needed to send one assist call, and nothing more.
///
/// The API key appears only inside `headers` — never stored, logged, or echoed
/// back in any other field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssistRequest {
    pub url: &'static str,
    /// The model actually used, after the provider's default is applied.
    pub model: String,
    pub body: String,
    pub headers: Vec<(String, String)>,
}

/// Build the assist request for `id`: endpoint, model default, body shape, and
/// auth headers, together.
///
/// Which body builder pairs with which endpoint, default, and header set is this
/// module's knowledge — assembling it per provider at the call site is how the
/// endpoint map ended up written twice.
///
/// `key` must be present for providers where `provider_info(id).key_required`;
/// keyless providers (Ollama) ignore it.
pub fn build_assist_request(
    id: ProviderId,
    model: Option<&str>,
    system_prompt: &str,
    user_content: &str,
    key: Option<&str>,
) -> Result<AssistRequest, AppError> {
    if provider_info(id).key_required && key.is_none() {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "this provider needs an API key",
            "field",
            "provider",
        ));
    }
    let model = model
        .map(str::to_owned)
        .unwrap_or_else(|| default_model(id).to_owned());
    let key = key.unwrap_or_default();

    let (body, headers) = match id {
        ProviderId::Ollama => (
            build_ollama_chat_body(&model, system_prompt, user_content),
            Vec::new(),
        ),
        ProviderId::OpenAi => (
            build_openai_chat_body(&model, system_prompt, user_content),
            vec![("Authorization".to_owned(), format!("Bearer {key}"))],
        ),
        ProviderId::Anthropic => (
            build_anthropic_messages_body(&model, system_prompt, user_content),
            vec![
                ("x-api-key".to_owned(), key.to_owned()),
                ("anthropic-version".to_owned(), ANTHROPIC_VERSION.to_owned()),
            ],
        ),
    };

    Ok(AssistRequest {
        url: endpoint_for(id),
        model,
        body,
        headers,
    })
}

/// Extract the reply text from `id`'s response body, using the parser that
/// matches the body builder [`build_assist_request`] used.
pub fn parse_assist_reply(id: ProviderId, body: &str) -> Result<String, AppError> {
    match id {
        ProviderId::Ollama => parse_ollama_chat_reply(body),
        ProviderId::OpenAi => parse_openai_chat_reply(body),
        ProviderId::Anthropic => parse_anthropic_reply(body),
    }
}

/// Render the redacted brief as the plain-text itinerary the model would receive.
fn format_itinerary(brief: &TripBrief) -> String {
    let mut out = String::new();
    out.push_str(&format!("Trip: {}\n", brief.title));
    out.push_str(&format!(
        "Route: {} to {}\n",
        brief.origin, brief.destination
    ));
    out.push_str(&format!(
        "Dates: {} to {}\n",
        brief.start_date, brief.end_date
    ));

    if !brief.flights.is_empty() {
        out.push_str("\nFlights:\n");
        for flight in &brief.flights {
            out.push_str(&format!("- {}\n", format_flight(flight)));
        }
    }
    if !brief.stays.is_empty() {
        out.push_str("\nStays:\n");
        for stay in &brief.stays {
            out.push_str(&format!("- {}\n", format_stay(stay)));
        }
    }
    out
}

fn format_flight(payload: &FactPayload) -> String {
    let mut parts: Vec<String> = Vec::new();
    let carrier: String = [
        payload.airline_name.as_deref(),
        payload.flight_number.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");
    if !carrier.is_empty() {
        parts.push(carrier);
    }
    if let (Some(from), Some(to)) = (
        payload.departure_airport_iata.as_deref(),
        payload.arrival_airport_iata.as_deref(),
    ) {
        parts.push(format!("{from} to {to}"));
    }
    if let Some(departs) = payload.departure_local.as_deref() {
        parts.push(format!("departs {departs}"));
    }
    parts.join(", ")
}

fn format_stay(payload: &FactPayload) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(name) = payload.property_name.as_deref() {
        parts.push(name.to_owned());
    }
    if let Some(address) = payload.address.as_deref() {
        parts.push(address.to_owned());
    }
    match (
        payload.checkin_date.as_deref(),
        payload.checkout_date.as_deref(),
    ) {
        (Some(checkin), Some(checkout)) => parts.push(format!("{checkin} to {checkout}")),
        (Some(checkin), None) => parts.push(format!("from {checkin}")),
        _ => {}
    }
    parts.join(", ")
}

/// The assistant's reply from a completed on-device run. A deterministic
/// wrapper around model output — the `text` is never treated as authoritative,
/// and high-stakes facts are surfaced only from cited sources elsewhere.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistReply {
    pub provider: ProviderId,
    pub model: String,
    pub text: String,
    pub generated_at: String,
}

/// A record that an assist call happened, for a visible per-trip activity log.
/// Metadata only — the prompt and reply text are never stored here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistActivityEntry {
    pub id: String,
    pub provider: ProviderId,
    pub model: String,
    pub created_at: String,
}

/// Build the Ollama `/api/chat` request body (non-streaming) from a preview's
/// system and user content. `serde_json` handles all escaping.
pub fn build_ollama_chat_body(model: &str, system_prompt: &str, user_content: &str) -> String {
    serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_content },
        ],
    })
    .to_string()
}

/// Extract the assistant's message text from an Ollama `/api/chat`
/// (non-streaming) response, or a descriptive [`ErrorCode::AssistFailed`].
pub fn parse_ollama_chat_reply(body: &str) -> Result<String, AppError> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| {
        AppError::new(
            ErrorCode::AssistFailed,
            "the on-device model returned an unreadable response",
        )
    })?;
    if let Some(error) = value.get("error").and_then(|error| error.as_str()) {
        return Err(AppError::new(
            ErrorCode::AssistFailed,
            format!("the on-device model reported: {error}"),
        ));
    }
    let text = value
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .unwrap_or("")
        .trim()
        .to_owned();
    if text.is_empty() {
        return Err(AppError::new(
            ErrorCode::AssistFailed,
            "the on-device model returned an empty reply",
        ));
    }
    Ok(text)
}

/// Build the OpenAI chat-completions request body from a preview's content.
pub fn build_openai_chat_body(model: &str, system_prompt: &str, user_content: &str) -> String {
    serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_content },
        ],
    })
    .to_string()
}

/// Extract the assistant text from an OpenAI chat-completions response.
pub fn parse_openai_chat_reply(body: &str) -> Result<String, AppError> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| {
        AppError::new(
            ErrorCode::AssistFailed,
            "OpenAI returned an unreadable response",
        )
    })?;
    if let Some(message) = value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(|message| message.as_str())
    {
        return Err(AppError::new(
            ErrorCode::AssistFailed,
            format!("OpenAI reported: {message}"),
        ));
    }
    let text = value
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .unwrap_or("")
        .trim()
        .to_owned();
    if text.is_empty() {
        return Err(AppError::new(
            ErrorCode::AssistFailed,
            "OpenAI returned an empty reply",
        ));
    }
    Ok(text)
}

/// Build the Anthropic messages request body. Anthropic takes the system prompt
/// as a top-level field and requires an explicit `max_tokens`.
pub fn build_anthropic_messages_body(
    model: &str,
    system_prompt: &str,
    user_content: &str,
) -> String {
    serde_json::json!({
        "model": model,
        "max_tokens": ASSIST_MAX_TOKENS,
        "system": system_prompt,
        "messages": [
            { "role": "user", "content": user_content },
        ],
    })
    .to_string()
}

/// Extract the assistant text from an Anthropic messages response, whose
/// `content` is an array of typed blocks (we concatenate the text blocks).
pub fn parse_anthropic_reply(body: &str) -> Result<String, AppError> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| {
        AppError::new(
            ErrorCode::AssistFailed,
            "Anthropic returned an unreadable response",
        )
    })?;
    if let Some(message) = value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(|message| message.as_str())
    {
        return Err(AppError::new(
            ErrorCode::AssistFailed,
            format!("Anthropic reported: {message}"),
        ));
    }
    let text = value
        .get("content")
        .and_then(|content| content.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(|text| text.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
        .trim()
        .to_owned();
    if text.is_empty() {
        return Err(AppError::new(
            ErrorCode::AssistFailed,
            "Anthropic returned an empty reply",
        ));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ExtractionMethod, FactType, TripStatus};

    fn trip() -> Trip {
        Trip {
            id: "trip_1".to_owned(),
            title: "Kyoto autumn journey".to_owned(),
            origin: "Chicago".to_owned(),
            destination: "Kyoto".to_owned(),
            start_date: "2026-11-03".to_owned(),
            end_date: "2026-11-12".to_owned(),
            status: TripStatus::Active,
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    fn flight() -> ConfirmedFact {
        ConfirmedFact {
            id: "f1".to_owned(),
            trip_id: "trip_1".to_owned(),
            fact_type: FactType::FlightSegment,
            payload: FactPayload {
                airline_name: Some("Fictional Pacific".to_owned()),
                flight_number: Some("FP18".to_owned()),
                departure_airport_iata: Some("ORD".to_owned()),
                arrival_airport_iata: Some("HND".to_owned()),
                departure_local: Some("2026-11-03T12:40".to_owned()),
                confirmation_code: Some("SECRET-PNR-1".to_owned()),
                passenger_name: Some("Jamie Traveler".to_owned()),
                ..FactPayload::default()
            },
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".to_owned(),
            source_removed: false,
        }
    }

    fn lodging() -> ConfirmedFact {
        ConfirmedFact {
            id: "l1".to_owned(),
            trip_id: "trip_1".to_owned(),
            fact_type: FactType::LodgingStay,
            payload: FactPayload {
                property_name: Some("River Paper Inn".to_owned()),
                address: Some("7 Fictional Paper Street".to_owned()),
                checkin_date: Some("2026-11-04".to_owned()),
                checkout_date: Some("2026-11-12".to_owned()),
                confirmation_code: Some("SECRET-PNR-2".to_owned()),
                guest_name: Some("Jamie Traveler".to_owned()),
                ..FactPayload::default()
            },
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".to_owned(),
            source_removed: false,
        }
    }

    #[test]
    fn preview_excludes_secrets_by_construction() {
        let preview = build_assist_preview(
            &trip(),
            &[flight(), lodging()],
            ProviderId::OpenAi,
            Some("gpt-x"),
            "2026-11-01T00:00:00Z",
        );
        let serialized = serde_json::to_string(&preview).expect("serialize");
        // The guarantee: redacted values never enter the request at all.
        assert!(!serialized.contains("SECRET-PNR-1"));
        assert!(!serialized.contains("SECRET-PNR-2"));
        assert!(!serialized.contains("Jamie Traveler"));
        // Non-sensitive itinerary detail is grounded in.
        assert!(preview.user_content.contains("FP18"));
        assert!(preview.user_content.contains("ORD to HND"));
        assert!(preview.user_content.contains("River Paper Inn"));
        // Transparency: what was withheld is listed.
        assert!(preview.withheld.contains(&"Confirmation codes".to_owned()));
        assert!(preview.withheld.contains(&"Traveler names".to_owned()));
        assert!(
            preview
                .withheld
                .contains(&"Imported document text".to_owned())
        );
        // Citation of the grounding and a non-zero cost estimate.
        assert!(
            preview
                .grounded_in
                .contains(&"1 confirmed flight".to_owned())
        );
        assert!(preview.grounded_in.contains(&"1 confirmed stay".to_owned()));
        assert!(preview.estimated_tokens > 0);
    }

    #[test]
    fn cloud_preview_leaves_the_device() {
        let preview = build_assist_preview(
            &trip(),
            &[flight()],
            ProviderId::Anthropic,
            None,
            "2026-11-01T00:00:00Z",
        );
        assert!(preview.leaves_device);
        assert_eq!(preview.endpoint, "https://api.anthropic.com/v1/messages");
        assert_eq!(preview.provider_label, "Anthropic");
        assert!(preview.model.is_none());
        assert!(preview.system_prompt.contains("Do not invent"));
    }

    #[test]
    fn ollama_preview_stays_on_device() {
        let preview = build_assist_preview(
            &trip(),
            &[flight()],
            ProviderId::Ollama,
            Some("qwen3:4b"),
            "2026-11-01T00:00:00Z",
        );
        assert!(!preview.leaves_device);
        assert_eq!(preview.endpoint, "http://localhost:11434/api/chat");
        assert_eq!(preview.model.as_deref(), Some("qwen3:4b"));
    }

    #[test]
    fn ollama_chat_body_carries_system_and_user_messages() {
        let body = build_ollama_chat_body("llama3.2", "be careful", "Trip: Kyoto");
        let value: serde_json::Value = serde_json::from_str(&body).expect("json");
        assert_eq!(value["model"], "llama3.2");
        assert_eq!(value["stream"], false);
        assert_eq!(value["messages"][0]["role"], "system");
        assert_eq!(value["messages"][0]["content"], "be careful");
        assert_eq!(value["messages"][1]["role"], "user");
        assert_eq!(value["messages"][1]["content"], "Trip: Kyoto");
    }

    #[test]
    fn openai_body_and_reply_round_trip() {
        let body = build_openai_chat_body("gpt-x", "be careful", "Trip: Kyoto");
        let value: serde_json::Value = serde_json::from_str(&body).expect("json");
        assert_eq!(value["model"], "gpt-x");
        assert_eq!(value["messages"][0]["role"], "system");
        assert_eq!(value["messages"][1]["content"], "Trip: Kyoto");

        let reply = parse_openai_chat_reply(
            r#"{ "choices": [{ "message": { "role": "assistant", "content": " All set. " } }] }"#,
        )
        .expect("reply");
        assert_eq!(reply, "All set.");
        assert_eq!(
            parse_openai_chat_reply(r#"{ "error": { "message": "invalid key" } }"#)
                .expect_err("error")
                .code,
            ErrorCode::AssistFailed
        );
    }

    #[test]
    fn anthropic_body_and_reply_round_trip() {
        let body = build_anthropic_messages_body("claude-x", "be careful", "Trip: Kyoto");
        let value: serde_json::Value = serde_json::from_str(&body).expect("json");
        assert_eq!(value["model"], "claude-x");
        assert_eq!(value["system"], "be careful");
        assert_eq!(value["max_tokens"], ASSIST_MAX_TOKENS);
        assert_eq!(value["messages"][0]["role"], "user");

        let reply = parse_anthropic_reply(
            r#"{ "content": [{ "type": "text", "text": "Your " }, { "type": "text", "text": "trip." }] }"#,
        )
        .expect("reply");
        assert_eq!(reply, "Your trip.");
        assert_eq!(
            parse_anthropic_reply(r#"{ "error": { "type": "auth", "message": "bad key" } }"#)
                .expect_err("error")
                .code,
            ErrorCode::AssistFailed
        );
    }

    #[test]
    fn parses_reply_and_reports_failures() {
        let ok = parse_ollama_chat_reply(
            r#"{ "message": { "role": "assistant", "content": "  Your trip looks ready.  " }, "done": true }"#,
        )
        .expect("reply");
        assert_eq!(ok, "Your trip looks ready.");

        // An Ollama error object surfaces as an assist failure.
        assert_eq!(
            parse_ollama_chat_reply(r#"{ "error": "model 'ghost' not found" }"#)
                .expect_err("error")
                .code,
            ErrorCode::AssistFailed
        );
        // Empty content and unparseable bodies both fail cleanly.
        assert_eq!(
            parse_ollama_chat_reply(r#"{ "message": { "content": "" } }"#)
                .expect_err("empty")
                .code,
            ErrorCode::AssistFailed
        );
        assert_eq!(
            parse_ollama_chat_reply("not json")
                .expect_err("garbage")
                .code,
            ErrorCode::AssistFailed
        );
    }

    #[test]
    fn assist_request_pairs_each_provider_with_its_own_endpoint_and_parser() {
        // The endpoint, body shape, and reply parser for a provider must agree.
        // Round-tripping a provider-shaped reply through parse_assist_reply is
        // what proves the pairing, and it is the pairing the call site used to
        // reassemble by hand.
        let cases = [
            (
                ProviderId::Ollama,
                OLLAMA_CHAT_URL,
                r#"{"message":{"content":"hi"}}"#,
            ),
            (
                ProviderId::OpenAi,
                OPENAI_CHAT_URL,
                r#"{"choices":[{"message":{"content":"hi"}}]}"#,
            ),
            (
                ProviderId::Anthropic,
                ANTHROPIC_MESSAGES_URL,
                r#"{"content":[{"type":"text","text":"hi"}]}"#,
            ),
        ];
        for (id, url, reply) in cases {
            let request =
                build_assist_request(id, None, "sys", "user", Some("k")).expect("request builds");
            assert_eq!(request.url, url, "{id:?} endpoint");
            assert_eq!(request.model, default_model(id), "{id:?} default model");
            assert!(
                request.body.contains(default_model(id)),
                "{id:?} body model"
            );
            assert_eq!(
                parse_assist_reply(id, reply).expect("parses"),
                "hi",
                "{id:?}"
            );
        }
    }

    #[test]
    fn a_cloud_assist_request_carries_the_key_only_in_its_headers() {
        let request = build_assist_request(ProviderId::OpenAi, None, "sys", "user", Some("secret"))
            .expect("request builds");
        assert!(
            request
                .headers
                .iter()
                .any(|(name, value)| name == "Authorization" && value == "Bearer secret")
        );
        // The key must never reach the body, the url, or the model.
        assert!(!request.body.contains("secret"));
        assert!(!request.url.contains("secret"));
        assert!(!request.model.contains("secret"));
    }

    #[test]
    fn anthropic_assist_request_sends_the_pinned_api_version() {
        let request =
            build_assist_request(ProviderId::Anthropic, None, "sys", "user", Some("secret"))
                .expect("request builds");
        assert!(
            request
                .headers
                .iter()
                .any(|(name, value)| name == "anthropic-version" && value == ANTHROPIC_VERSION)
        );
        assert!(
            request
                .headers
                .iter()
                .any(|(name, value)| name == "x-api-key" && value == "secret")
        );
    }

    #[test]
    fn a_keyless_provider_needs_no_key_and_sends_no_auth_headers() {
        let request =
            build_assist_request(ProviderId::Ollama, None, "sys", "user", None).expect("builds");
        assert!(request.headers.is_empty());
        assert!(request.url.starts_with("http://localhost"));
    }

    #[test]
    fn a_cloud_assist_request_without_a_key_is_refused() {
        for id in [ProviderId::OpenAi, ProviderId::Anthropic] {
            let error = build_assist_request(id, None, "sys", "user", None).expect_err("refused");
            assert_eq!(error.code, ErrorCode::ValidationInvalidInput);
        }
    }

    #[test]
    fn a_chosen_model_overrides_the_provider_default() {
        let request = build_assist_request(ProviderId::Ollama, Some("mistral"), "s", "u", None)
            .expect("builds");
        assert_eq!(request.model, "mistral");
        assert!(request.body.contains("mistral"));
    }
}
