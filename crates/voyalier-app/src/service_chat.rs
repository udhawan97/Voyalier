//! `AppService` — the on-device conversation about one trip.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into.
//!
//! Local only, deliberately. The existing assist path is preview → consent →
//! one send, which works because there is exactly one send; a conversation is
//! many, and a standing "always send to the cloud" consent is a change to the
//! trust contract rather than a feature. Ollama needs neither, because nothing
//! leaves the machine. Cloud chat is refused here and needs its own ADR.
//!
//! Grounding runs through the ordinary deterministic search rather than a
//! bigger prompt, so a small local model keeps room for the trip itself and
//! "why did it know that" stays a mechanical question.

use super::*;

/// How much of one retrieved record is quoted into a prompt. Wider than a
/// search snippet, which is sized to be read in a list rather than reasoned over.
const CHAT_EXCERPT_CHARS: usize = MAX_CHAT_EXCERPT_CHARS;

impl AppService {
    pub fn list_chat_messages(&self, trip_id: &str) -> Result<Vec<ChatMessage>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        self.records(&connection).chat_messages(trip_id)
    }

    pub fn clear_chat(&self, trip_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        self.records(&connection).delete_chat_messages(trip_id)
    }

    /// Answer one question about the trip, on this machine.
    ///
    /// The traveler's message is stored before the model runs, so a failed or
    /// unreachable model leaves the thread showing what was asked rather than
    /// silently swallowing it.
    pub fn send_chat_message(&self, trip_id: &str, message: &str) -> Result<ChatMessage, AppError> {
        let message = validate_chat_message(message)?;
        let pointers = high_stakes_topics(&message);

        let (trip, facts, history, model, contexts) = {
            let connection = self.connection()?;
            let trip = self.records(&connection).trip(trip_id)?;
            let facts = self.records(&connection).confirmed_facts(trip_id)?;
            let history = self.records(&connection).chat_messages(trip_id)?;
            let model: Option<String> = connection
                .query_row(
                    "SELECT model FROM provider_settings WHERE provider = ?1",
                    params!["ollama"],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()
                .map_err(storage_error)?
                .flatten();
            let contexts = self.chat_context(&connection, trip_id, &message)?;
            (trip, facts, history, model, contexts)
        };

        let now = now_rfc3339();
        {
            let connection = self.connection()?;
            self.records(&connection)
                .insert_chat_message(&ChatMessage {
                    id: new_id("chat"),
                    trip_id: trip_id.to_owned(),
                    role: ChatRole::User,
                    text: message.clone(),
                    created_at: now.clone(),
                    grounding: Vec::new(),
                    pointers: pointers.clone(),
                    itinerary_facts: 0,
                })?;
        }

        let borrowed: Vec<ChatContext<'_>> = contexts
            .iter()
            .map(|context| ChatContext {
                source: context.source,
                record_id: &context.record_id,
                label: &context.label,
                excerpt: &context.excerpt,
            })
            .collect();
        let prompt = build_chat_prompt(&trip, &facts, &borrowed, &history, &message, &now);

        // Ollama is keyless and on-device, so this is the whole network story.
        let request = build_assist_request(
            ProviderId::Ollama,
            model.as_deref(),
            &prompt.system_prompt,
            &prompt.user_content,
            None,
        )?;
        let response =
            self.fetcher
                .post_json_bounded(request.url, &request.body, &[], MAX_AI_REPLY_BYTES)?;
        let text = parse_assist_reply(ProviderId::Ollama, &response)?;

        let reply = ChatMessage {
            id: new_id("chat"),
            trip_id: trip_id.to_owned(),
            role: ChatRole::Assistant,
            text,
            created_at: now_rfc3339(),
            grounding: prompt.grounding,
            pointers,
            itinerary_facts: prompt.itinerary_facts,
        };
        let connection = self.connection()?;
        self.records(&connection).insert_chat_message(&reply)?;
        // The same metadata-only record every other model run leaves. The
        // transcript is the traveler's copy; this is the audit trail, and it
        // stays free of both the question and the answer.
        connection
            .execute(
                "INSERT INTO assist_activity (id, trip_id, provider, model, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    new_id("assist"),
                    trip_id,
                    "ollama",
                    request.model,
                    reply.created_at,
                ],
            )
            .map_err(storage_error)?;
        Ok(reply)
    }

    /// Retrieve the records this question should be answered from.
    ///
    /// Runs the ordinary trip search, then reads each hit's full text back so
    /// the model reasons over the record rather than a list-sized snippet.
    /// Chat transcripts are absent by construction — they are not in the search
    /// corpus, so an earlier answer can never be retrieved as local knowledge.
    fn chat_context(
        &self,
        connection: &Connection,
        trip_id: &str,
        message: &str,
    ) -> Result<Vec<OwnedChatContext>, AppError> {
        let Ok(query) = validate_search_query(message) else {
            return Ok(Vec::new());
        };
        // The same corpus `search_trip` ranks, by construction rather than by
        // a second reading of it: what the traveler can find and what the model
        // may be grounded in must not be able to drift apart.
        let corpus = self.trip_corpus(connection, trip_id)?;
        Ok(corpus
            .search(&query)
            .into_iter()
            .take(MAX_CHAT_CONTEXT_RECORDS)
            .filter_map(|hit| {
                // A confirmed fact yields no stored text, and is already in the
                // redacted itinerary baseline; quoting it would only spend
                // context.
                let excerpt = corpus.stored_text(&hit)?;
                Some(OwnedChatContext {
                    source: hit.source,
                    record_id: hit.record_id,
                    label: hit.label,
                    excerpt: truncate_for_context(&excerpt),
                })
            })
            .collect())
    }
}

/// A retrieved record, owned so it can outlive the connection that read it.
pub(crate) struct OwnedChatContext {
    pub(crate) source: SearchHitSource,
    pub(crate) record_id: String,
    pub(crate) label: String,
    pub(crate) excerpt: String,
}

fn truncate_for_context(value: &str) -> String {
    value.chars().take(CHAT_EXCERPT_CHARS).collect()
}

/// What of a resource the deterministic scan may match on.
///
/// The traveler's note, their tags, and the page's own words — never the URL,
/// which would make every link match a search for "https".
pub(crate) fn resource_search_text(resource: &Resource) -> String {
    let mut parts: Vec<&str> = vec![resource.note.as_str()];
    for tag in &resource.tags {
        parts.push(tag);
    }
    if let Some(snapshot) = &resource.snapshot {
        if let Some(description) = &snapshot.description {
            parts.push(description);
        }
        parts.push(&snapshot.text);
    }
    parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
