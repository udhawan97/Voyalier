use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use serde_json::Value;

// The fixture corpus drives each parser directly by id, so it reaches into the
// parser module rather than going through `parse_import`.
use crate::parser::{ConfirmationParser, JsonLdParser, NormalizedDocument, PlaintextParser};
use crate::types::validate_document_content;
use crate::{
    AddManualFactInput, AppError, CandidateFact, CandidateStatus, ConfirmCandidateInput,
    ConfirmedFact, CreateTripInput, DocumentKind, ErrorCode, ExtractionMethod, FactPayload,
    FactType, FieldSpan, HealthResponse, ImportDocumentInput, ImportResult, IntelligenceMode,
    ReadinessStatus, SourceDocument, Trip, TripItem, TripStatus, WarningCode,
    changed_payload_fields, new_id, schema_validation::SchemaSet, validate_create_trip,
    validate_fact_payload,
};

#[test]
fn data_source_register_has_unique_rows_and_a_pinned_count() {
    let register: serde_json::Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/parity/data-sources.json"
    ))
    .expect("data source register");
    let sources = register["sources"].as_array().expect("sources");
    assert_eq!(sources.len() as u64, register["count"].as_u64().unwrap());
    let ids: std::collections::BTreeSet<&str> = sources
        .iter()
        .map(|source| source["id"].as_str().expect("source id"))
        .collect();
    assert_eq!(ids.len(), sources.len(), "source ids must be unique");
    assert_eq!(
        ids,
        BTreeSet::from([
            "anthropic",
            "ca-gac",
            "ca-ircc",
            "de-aa",
            "ecb",
            "geonames",
            "nager-date",
            "nasa-eclipse",
            "nws",
            "ollama",
            "open-meteo",
            "openai",
            "openfreemap",
            "openholidays",
            "ourairports",
            "overture",
            "protomaps-osm",
            "uk-fcdo",
            "uk-ukvi",
            "us-cdc",
            "us-state",
            "wikidata-heritage",
            "wikidata-missions",
            "wikimedia",
            "wikivoyage",
        ])
    );
    assert!(sources.iter().all(|source| {
        [
            "name",
            "category",
            "url",
            "use",
            "endpoint",
            "license",
            "attribution",
            "network",
            "authority",
        ]
        .iter()
        .all(|field| {
            source[*field]
                .as_str()
                .is_some_and(|value| !value.trim().is_empty())
        })
    }));
    assert!(sources.iter().all(|source| {
        matches!(
            source["category"].as_str(),
            Some("built_in" | "consent_fetched" | "offline_download" | "optional_ai")
        ) && source["url"]
            .as_str()
            .is_some_and(|url| url.starts_with("https://"))
    }));

    let by_id: BTreeMap<&str, &Value> = sources
        .iter()
        .map(|source| (source["id"].as_str().unwrap(), source))
        .collect();
    assert_eq!(by_id["ollama"]["endpoint"], crate::assist::OLLAMA_CHAT_URL);
    assert_eq!(by_id["openai"]["endpoint"], crate::assist::OPENAI_CHAT_URL);
    assert_eq!(
        by_id["anthropic"]["endpoint"],
        crate::assist::ANTHROPIC_MESSAGES_URL
    );
}

#[test]
fn rejects_a_missing_destination() {
    let error = validate_create_trip(CreateTripInput {
        title: None,
        origin: "Chicago".to_owned(),
        destination: " ".to_owned(),
        start_date: "2027-04-01".to_owned(),
        end_date: "2027-04-10".to_owned(),
    })
    .expect_err("destination must be required");

    assert_eq!(error.code, ErrorCode::ValidationInvalidInput);
    // The interface marks the offending input from this detail, so a message
    // that merely mentions the word would not be enough to place the error.
    assert_eq!(
        error
            .details
            .as_ref()
            .and_then(|details| details.get("field")),
        Some(&"destination".to_owned())
    );
}

#[test]
fn serializes_create_trip_input_with_camel_case_wire_fields() {
    // ADR-0019: `ValidatedTripInput` never crosses a wire, so the camelCase
    // guarantee on the create path belongs to the payload a client sends.
    let json = serde_json::to_value(CreateTripInput {
        title: None,
        origin: "Chicago".to_owned(),
        destination: "Kyoto".to_owned(),
        start_date: "2027-04-01".to_owned(),
        end_date: "2027-04-10".to_owned(),
    })
    .expect("serialize create trip input");

    assert_eq!(json["startDate"], "2027-04-01");
    assert!(json.get("start_date").is_none());
}

#[test]
fn validates_trip_inputs_with_contract_rules() {
    let validated = validate_create_trip(CreateTripInput {
        title: None,
        origin: " Chicago ".to_owned(),
        destination: " Kyoto ".to_owned(),
        start_date: "2027-04-01".to_owned(),
        end_date: "2027-04-10".to_owned(),
    })
    .expect("valid input");

    // The stored default name uses the same arrow the interface draws
    // everywhere else, so a card never shows "A -> B" above the route "A → B".
    assert_eq!(validated.title, "Chicago → Kyoto");
    assert_eq!(validated.origin, "Chicago");
    assert_eq!(validated.destination, "Kyoto");

    let error = validate_create_trip(CreateTripInput {
        title: None,
        origin: "Chicago".to_owned(),
        destination: "Kyoto".to_owned(),
        start_date: "2027-04-11".to_owned(),
        end_date: "2027-04-10".to_owned(),
    })
    .expect_err("date range must fail");
    assert_eq!(error.code, ErrorCode::ValidationInvalidDateRange);
}

#[test]
fn validates_document_size_and_fact_payload_shape() {
    assert_eq!(validate_document_content("hello").expect("content"), 5);
    assert_eq!(
        validate_document_content("").expect_err("empty").code,
        ErrorCode::DocumentEmpty
    );

    let mixed_payload = FactPayload {
        departure_airport_iata: Some("SFO".to_owned()),
        property_name: Some("Wrong Surface".to_owned()),
        ..FactPayload::default()
    };
    assert_eq!(
        validate_fact_payload(FactType::FlightSegment, &mixed_payload)
            .expect_err("mixed payload")
            .code,
        ErrorCode::ValidationInvalidInput
    );
}

#[test]
fn changed_payload_fields_are_contract_field_paths() {
    let original = FactPayload {
        confirmation_code: Some("ABC123".to_owned()),
        departure_airport_iata: Some("SFO".to_owned()),
        ..FactPayload::default()
    };
    let edited = FactPayload {
        confirmation_code: Some("ABC123".to_owned()),
        departure_airport_iata: Some("NRT".to_owned()),
        ..FactPayload::default()
    };

    assert_eq!(
        changed_payload_fields(&original, &edited),
        vec!["payload.departureAirportIata"]
    );
}

#[test]
fn parser_fixture_corpus_matches_declared_fields() {
    let root = fixture_root();
    let cases = fs::read_dir(&root).expect("fixtures");
    let mut fixture_count = 0;
    let mut jsonld_cases = 0;

    for entry in cases {
        let case_dir = entry.expect("fixture dir").path();
        if !case_dir.is_dir() {
            continue;
        }
        fixture_count += 1;
        let expected = read_expectation(&case_dir);
        let input_path = if case_dir.join("input.html").exists() {
            case_dir.join("input.html")
        } else {
            case_dir.join("input.txt")
        };
        let raw = fs::read_to_string(&input_path).expect("fixture input");
        let document_kind = if input_path.extension().and_then(|ext| ext.to_str()) == Some("html") {
            DocumentKind::Html
        } else {
            DocumentKind::PastedText
        };
        let document = NormalizedDocument::new(document_kind, raw.clone());
        let outcome = match expected.parser.as_str() {
            "jsonld.v1" => {
                jsonld_cases += 1;
                JsonLdParser.parse(&document)
            }
            "plaintext.v1" => PlaintextParser.parse(&document),
            other => panic!("unknown fixture parser {other}"),
        };

        for expected_code in &expected.expected_diagnostics {
            assert!(
                outcome
                    .warnings
                    .iter()
                    .any(|warning| warning.code == *expected_code),
                "{} missing diagnostic {expected_code}; got {:?}",
                case_dir.display(),
                outcome.warnings
            );
        }

        if expected.exact {
            let (precision, recall, f1) = field_scores(&expected, &outcome);
            assert_eq!(precision, 1.0, "{} precision", case_dir.display());
            assert_eq!(recall, 1.0, "{} recall", case_dir.display());
            assert_eq!(f1, 1.0, "{} f1", case_dir.display());
            assert!(
                outcome
                    .candidates
                    .iter()
                    .flat_map(|candidate| &candidate.field_spans)
                    .all(|span| span.start <= span.end
                        && span.end <= raw.chars().count()
                        && !span.excerpt.contains('<')),
                "{} spans must be raw character offsets with plain excerpts",
                case_dir.display()
            );
        } else {
            assert_expected_subset(&case_dir, &expected, &outcome);
        }
    }

    assert!(
        fixture_count >= 10,
        "expected at least 10 parser fixtures, saw {fixture_count}"
    );
    assert!(jsonld_cases >= 4, "expected multiple JSON-LD fixtures");
}

#[test]
fn injection_fixture_stays_inert() {
    let raw = fs::read_to_string(fixture_root().join("injection-inert/input.txt"))
        .expect("fixture input");
    let outcome = PlaintextParser.parse(&NormalizedDocument::new(DocumentKind::PastedText, raw));

    assert!(outcome.candidates.is_empty());
    assert!(
        !outcome
            .warnings
            .iter()
            .any(|warning| warning.code.contains("ready"))
    );
}

/// The limits both languages enforce live in one file, and this holds Rust to
/// it. `apps/web/src/parity.test.ts` holds TypeScript to the same file.
///
/// Before this, each limit was a Rust `pub const` and an unrelated magic number
/// in `mock.ts` — and the mock counted UTF-16 code units where the core counts
/// characters, so it rejected input the real service accepts.
#[test]
fn parity_limits_match_the_contract() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/contracts/parity/limits.json");
    let raw = fs::read_to_string(&path).expect("parity/limits.json");
    let limits: Value = serde_json::from_str(&raw).expect("valid json");

    let expected = [
        ("maxLocationLen", crate::types::MAX_LOCATION_LEN),
        ("maxDocumentChars", crate::types::MAX_DOCUMENT_CHARS),
        ("maxNotesChars", crate::types::MAX_NOTES_CHARS),
        ("maxQueryLen", crate::search::MAX_QUERY_LEN),
        ("maxAiPromptLen", crate::MAX_AI_PROMPT_LEN),
        ("maxChatMessageChars", crate::MAX_CHAT_MESSAGE_CHARS),
        ("maxResourceTitleChars", crate::MAX_RESOURCE_TITLE_CHARS),
        ("maxResourceNoteChars", crate::MAX_RESOURCE_NOTE_CHARS),
        ("maxResourceUrlChars", crate::MAX_RESOURCE_URL_CHARS),
    ];
    for (key, value) in expected {
        assert_eq!(
            limits.get(key).and_then(Value::as_u64),
            Some(value as u64),
            "{key} disagrees with the core"
        );
    }

    // Nothing in the file goes unchecked, so an entry cannot be added here and
    // silently enforced nowhere.
    let declared: Vec<&String> = limits
        .as_object()
        .expect("object")
        .keys()
        .filter(|key| !key.starts_with('$'))
        .collect();
    assert_eq!(
        declared.len(),
        expected.len(),
        "every limit in parity/limits.json must be checked here; saw {declared:?}"
    );
}

/// Place folding is implemented twice — here and in the mock gateway — and a
/// destination is user-typed free text, so a disagreement means a pack matches
/// in one and not the other. Both sides answer to this file.
///
/// Both had bugs, in opposite directions: the core sent accented capitals to a
/// word separator ("REYKJAVÍK" -> "reykjav k"), and the mock dropped ø and ß
/// ("Tromsø" -> "troms").
#[test]
fn parity_normalize_place_matches_the_contract() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/parity/normalize-place.json");
    let raw = fs::read_to_string(&path).expect("parity/normalize-place.json");
    let golden: Value = serde_json::from_str(&raw).expect("valid json");

    let cases = golden["cases"].as_array().expect("cases array");
    let mut checked = 0;
    for case in cases {
        let (Some(input), Some(expected)) = (
            case.get("input").and_then(Value::as_str),
            case.get("expected").and_then(Value::as_str),
        ) else {
            continue; // a "$why" annotation
        };
        assert_eq!(
            crate::packs::normalize_place(input),
            expected,
            "normalize_place({input:?})"
        );
        checked += 1;
    }
    // Exact, not a floor: a ">= 20" guard on 23 cases lets three quietly
    // disappear. Bump this when you add a case.
    assert_eq!(checked, 23, "every golden case must be checked");
}

#[test]
fn parity_saved_place_identity_matches_the_contract() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/parity/saved-place-identity.json");
    let raw = fs::read_to_string(&path).expect("parity/saved-place-identity.json");
    let golden: Value = serde_json::from_str(&raw).expect("valid json");
    let cases = golden["cases"].as_array().expect("cases array");

    for case in cases {
        let input = case["input"].as_str().expect("input");
        let expected = case["expected"].as_str().expect("expected");
        assert_eq!(
            crate::packs::saved_place_identity(input),
            expected,
            "saved_place_identity({input:?})"
        );
    }
    assert_eq!(cases.len(), 14, "every golden case must be checked");
}

/// Pack discovery uses the same local catalog and matching rule in core and in
/// the shipped in-memory gateway. The catalog itself is pinned here so the mock
/// cannot quietly exercise only a stale subset of destinations.
#[test]
fn parity_pack_suggestions_match_the_contract() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/parity/pack-suggestions.json");
    let raw = fs::read_to_string(&path).expect("parity/pack-suggestions.json");
    let mut golden: Value = serde_json::from_str(&raw).expect("valid json");
    let regenerate = std::env::var("VOYALIER_REGENERATE_GOLDEN").is_ok();
    let cases = golden["cases"].as_array().expect("cases array").clone();
    let mut regenerated = Vec::with_capacity(cases.len());

    for case in &cases {
        let name = case["name"].as_str().expect("name");
        let input = case["input"].as_str().expect("input");
        let actual = Value::Array(
            crate::suggest_packs(input)
                .into_iter()
                .map(|suggestion| {
                    serde_json::json!({
                        "packId": suggestion.pack.id,
                        "matchKind": suggestion.match_kind,
                        "matchedText": suggestion.matched_text,
                    })
                })
                .collect(),
        );
        if regenerate {
            let mut updated = case.clone();
            updated["expected"] = actual;
            regenerated.push(updated);
            continue;
        }
        assert_eq!(
            actual, case["expected"],
            "pack suggestions disagree for {name:?}"
        );
    }

    if regenerate {
        golden["cases"] = Value::Array(regenerated);
        let mut written = serde_json::to_string_pretty(&golden).expect("serializable");
        written.push('\n');
        fs::write(&path, written).expect("rewrite golden");
        panic!("golden regenerated — review the diff, then run without the flag");
    }
    assert_eq!(
        cases.len(),
        31,
        "every pack-suggestion case must be checked"
    );
}

/// Local field suggestions are ranked in core and mirrored by the mock. This
/// pins trimming, stable source priority, de-duplication, and the result cap.
#[test]
fn parity_field_suggestions_match_the_contract() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/parity/field-suggestions.json");
    let raw = fs::read_to_string(&path).expect("parity/field-suggestions.json");
    let mut golden: Value = serde_json::from_str(&raw).expect("valid json");
    let regenerate = std::env::var("VOYALIER_REGENERATE_GOLDEN").is_ok();
    let cases = golden["cases"].as_array().expect("cases array").clone();
    let mut regenerated = Vec::with_capacity(cases.len());

    for case in &cases {
        let name = case["name"].as_str().expect("name");
        let query = case["query"].as_str().expect("query");
        let candidates: Vec<crate::FieldSuggestion> =
            serde_json::from_value(case["candidates"].clone()).expect("candidates");
        let actual = serde_json::to_value(crate::rank_field_suggestions(query, candidates))
            .expect("serializable suggestions");
        if regenerate {
            let mut updated = case.clone();
            updated["expected"] = actual;
            regenerated.push(updated);
            continue;
        }
        assert_eq!(
            actual, case["expected"],
            "field suggestions disagree for {name:?}"
        );
    }

    if regenerate {
        golden["cases"] = Value::Array(regenerated);
        let mut written = serde_json::to_string_pretty(&golden).expect("serializable");
        written.push('\n');
        fs::write(&path, written).expect("rewrite golden");
        panic!("golden regenerated — review the diff, then run without the flag");
    }
    assert_eq!(
        cases.len(),
        9,
        "every field-suggestion case must be checked"
    );
}

/// Every `ErrorCode` appears in the contract's AppError schema.
///
/// `rust_examples_validate_against_contract_schemas` validates one hardcoded
/// error, so it stayed green while the schema went eight codes stale between
/// Phase 0 and Phase 3 — including `document/not_found`, added by the very
/// commit whose message says it updated the schema. Enumerating every variant is
/// what makes the check mean something.
#[test]
fn every_error_code_is_in_the_contract_schema() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/schemas/AppError.schema.json");
    let raw = fs::read_to_string(&path).expect("AppError.schema.json");
    let schema: Value = serde_json::from_str(&raw).expect("valid json");
    let declared: BTreeSet<String> = schema["properties"]["code"]["enum"]
        .as_array()
        .expect("code enum")
        .iter()
        .filter_map(|value| value.as_str().map(str::to_owned))
        .collect();

    let all = [
        ErrorCode::ValidationInvalidInput,
        ErrorCode::ValidationInvalidDateRange,
        ErrorCode::TripNotFound,
        ErrorCode::CandidateNotFound,
        ErrorCode::CandidateAlreadyResolved,
        ErrorCode::FactNotFound,
        ErrorCode::DocumentNotFound,
        ErrorCode::DocumentTooLarge,
        ErrorCode::DocumentDuplicate,
        ErrorCode::DocumentEmpty,
        ErrorCode::AdviceFetchFailed,
        ErrorCode::WeatherFetchFailed,
        ErrorCode::AssistFailed,
        ErrorCode::AssistUnreachable,
        ErrorCode::PackDownloadFailed,
        ErrorCode::VaultLocked,
        ErrorCode::VaultPassphraseIncorrect,
        ErrorCode::VaultUnreadable,
        ErrorCode::StorageFailure,
        ErrorCode::TransportFailure,
        ErrorCode::InternalUnexpected,
    ];

    // A list is only as good as its completeness, and a list is exactly what
    // went stale. Adding a variant makes this match non-exhaustive, so the
    // compiler stops here and points at `all` above — which is the one thing the
    // old single-code test could never do.
    fn _every_variant_is_listed_above(code: ErrorCode) {
        match code {
            ErrorCode::ValidationInvalidInput
            | ErrorCode::ValidationInvalidDateRange
            | ErrorCode::TripNotFound
            | ErrorCode::CandidateNotFound
            | ErrorCode::CandidateAlreadyResolved
            | ErrorCode::FactNotFound
            | ErrorCode::DocumentNotFound
            | ErrorCode::DocumentTooLarge
            | ErrorCode::DocumentDuplicate
            | ErrorCode::DocumentEmpty
            | ErrorCode::AdviceFetchFailed
            | ErrorCode::WeatherFetchFailed
            | ErrorCode::AssistFailed
            | ErrorCode::AssistUnreachable
            | ErrorCode::PackDownloadFailed
            | ErrorCode::VaultLocked
            | ErrorCode::VaultPassphraseIncorrect
            | ErrorCode::VaultUnreadable
            | ErrorCode::StorageFailure
            | ErrorCode::TransportFailure
            | ErrorCode::InternalUnexpected => {}
        }
    }

    let actual: BTreeSet<String> = all
        .iter()
        .map(|code| {
            serde_json::to_value(code)
                .expect("serializable")
                .as_str()
                .expect("string")
                .to_owned()
        })
        .collect();

    assert_eq!(
        actual, declared,
        "AppError.schema.json disagrees with ErrorCode"
    );
}

/// The default AI instructions are shown to the traveler as editable
/// `defaultText`, so the mock paraphrasing them means the settings UI shows a
/// materially different instruction in mock mode than the one production sends.
/// The draft prompt's mock copy dropped the JSON shape and the whole prohibition
/// on prices, codes, guest names, and visa/health/safety content.
#[test]
fn parity_prompts_match_the_contract() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/contracts/parity/prompts.json");
    let raw = fs::read_to_string(&path).expect("parity/prompts.json");
    let golden: Value = serde_json::from_str(&raw).expect("valid json");

    assert_eq!(
        golden["assist"].as_str(),
        Some(crate::ASSIST_SYSTEM_PROMPT),
        "assist prompt"
    );
    assert_eq!(
        golden["draftLodgingDates"].as_str(),
        Some(crate::DRAFT_LODGING_DATES_SYSTEM_PROMPT),
        "draft prompt"
    );
}

/// The high-stakes table decides when a chat reply gets a pointer at the real
/// authority above it. The mock carried a hand-written copy that knew 20 of the
/// 48 words and none of the 6 phrases, so in mock mode a question about entry
/// requirements, customs, quarantine, or terrorism got the model's answer with
/// nothing above it — the one thing the feature exists to prevent. The only
/// test on it asked "Do I need a visa", a word inside the intersection.
///
/// Both counts are pinned here and in `apps/web/src/parity.test.ts`, so a term
/// added on one side fails until the other is told about it.
#[test]
fn parity_chat_topics_match_the_contract() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/parity/chat-topics.json");
    let raw = fs::read_to_string(&path).expect("parity/chat-topics.json");
    let golden: Value = serde_json::from_str(&raw).expect("valid json");
    let topics = golden["topics"].as_array().expect("topics array");

    assert_eq!(
        topics.len(),
        crate::chat::HIGH_STAKES_WORDS.len(),
        "chat-topics.json declares a different set of topics than HIGH_STAKES_WORDS"
    );

    let mut words_seen = 0usize;
    let mut phrases_seen = 0usize;

    for (index, entry) in topics.iter().enumerate() {
        let (topic, words) = crate::chat::HIGH_STAKES_WORDS[index];
        // Topic order is the order the pointer cards appear, so it is part of
        // the contract rather than an artifact of how the table is written.
        assert_eq!(
            entry["topic"].as_str(),
            serde_json::to_value(topic).expect("topic").as_str(),
            "topic {index} is out of order"
        );

        let golden_words: Vec<&str> = entry["words"]
            .as_array()
            .expect("words array")
            .iter()
            .map(|word| word.as_str().expect("word is a string"))
            .collect();
        assert_eq!(golden_words, words, "words for {topic:?}");
        words_seen += words.len();

        let golden_phrases: Vec<&str> = entry["phrases"]
            .as_array()
            .expect("phrases array")
            .iter()
            .map(|phrase| phrase.as_str().expect("phrase is a string"))
            .collect();
        let phrases: Vec<&str> = crate::chat::HIGH_STAKES_PHRASES
            .iter()
            .filter(|(candidate, _)| candidate == &topic)
            .map(|(_, phrase)| *phrase)
            .collect();
        assert_eq!(golden_phrases, phrases, "phrases for {topic:?}");
        phrases_seen += phrases.len();
    }

    assert_eq!(
        phrases_seen,
        crate::chat::HIGH_STAKES_PHRASES.len(),
        "a phrase names a topic the words table does not"
    );
    // The golden groups phrases under their topic; the core keeps one flat
    // table. A reader flattening the golden in topic order has to land on the
    // core's order, because that order decides which pointer card comes first.
    let flattened: Vec<&str> = topics
        .iter()
        .flat_map(|entry| entry["phrases"].as_array().expect("phrases array"))
        .map(|phrase| phrase.as_str().expect("phrase is a string"))
        .collect();
    let flat_core: Vec<&str> = crate::chat::HIGH_STAKES_PHRASES
        .iter()
        .map(|(_, phrase)| *phrase)
        .collect();
    assert_eq!(
        flattened, flat_core,
        "HIGH_STAKES_PHRASES is no longer grouped by topic, so flattening the golden reorders it"
    );
    assert_eq!(
        words_seen as u64,
        golden["wordCount"].as_u64().expect("wordCount"),
        "wordCount must be bumped in chat-topics.json and in both tests"
    );
    assert_eq!(
        phrases_seen as u64,
        golden["phraseCount"].as_u64().expect("phraseCount"),
        "phraseCount must be bumped in chat-topics.json and in both tests"
    );
}

/// The curated official-source links are the product's whole claim on entry and
/// health: it never asserts those rules, it points at the source. They were
/// hand-maintained in Rust and TypeScript with nothing holding them together,
/// and the only Rust test on them checked that each URL starts with "https".
#[test]
fn parity_readiness_links_match_the_contract() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/parity/readiness-links.json");
    let raw = fs::read_to_string(&path).expect("parity/readiness-links.json");
    let golden: Value = serde_json::from_str(&raw).expect("valid json");

    let summary = crate::assess_trip(
        &Trip {
            id: "trip_links".to_owned(),
            title: "T".to_owned(),
            origin: "Chicago".to_owned(),
            destination: "Kyoto".to_owned(),
            start_date: "2027-04-01".to_owned(),
            end_date: "2027-04-05".to_owned(),
            status: TripStatus::Active,
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        },
        &[],
        0,
    )
    .readiness;

    for (key, check) in [
        (
            "entry_requirements",
            crate::ReadinessCheck::EntryRequirements,
        ),
        ("health_notices", crate::ReadinessCheck::HealthNotices),
    ] {
        let item = summary
            .items
            .iter()
            .find(|item| item.id == check)
            .expect("item present");
        let expected: Vec<(String, String)> = golden[key]
            .as_array()
            .expect("array")
            .iter()
            .map(|link| {
                (
                    link["label"].as_str().expect("label").to_owned(),
                    link["url"].as_str().expect("url").to_owned(),
                )
            })
            .collect();
        let actual: Vec<(String, String)> = item
            .links
            .iter()
            .map(|link| (link.label.clone(), link.url.clone()))
            .collect();
        assert_eq!(actual, expected, "{key} links");
    }
}

/// Itinerary conflicts and the readiness rollup are implemented twice — here and
/// in the mock gateway that every component test runs against. This holds the
/// core to the golden; `apps/web/src/parity.test.ts` holds the mock to the same
/// one, so the two cannot disagree about what a trip's plan says.
///
/// This one pins rule *output*, not just constants: the earlier goldens would
/// not have caught a mirror that computed a different verdict.
#[test]
fn parity_assess_trip_matches_the_contract() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/parity/assess-trip.json");
    let raw = fs::read_to_string(&path).expect("parity/assess-trip.json");
    let mut golden: Value = serde_json::from_str(&raw).expect("valid json");
    // ADR-0004: expected output here is generated from the core and then
    // reviewed, because hand-writing a nested `ReadinessSummary` twelve times
    // would be transcription rather than thought. `VOYALIER_REGENERATE_GOLDEN=1`
    // is that regeneration, kept beside the assertion so the two cannot compute
    // it differently. Deliberate, never to turn a red test green: read the diff.
    let regenerate = std::env::var("VOYALIER_REGENERATE_GOLDEN").is_ok();

    let cases = golden["cases"].as_array().expect("cases array").clone();
    let mut regenerated = Vec::with_capacity(cases.len());
    for case in &cases {
        let name = case["name"].as_str().expect("name");
        let trip: Trip = serde_json::from_value(case["trip"].clone()).expect("trip");
        let facts: Vec<ConfirmedFact> =
            serde_json::from_value(case["facts"].clone()).expect("facts");
        let pending = case["pendingCandidateCount"].as_u64().expect("count") as u32;

        let assessment = crate::assess_trip(&trip, &facts, pending);
        let actual = serde_json::json!({
            "conflicts": assessment.conflicts,
            "readiness": assessment.readiness,
        });
        if regenerate {
            let mut updated = case.clone();
            updated["expected"] = actual;
            regenerated.push(updated);
            continue;
        }
        assert_eq!(
            actual, case["expected"],
            "assess_trip disagrees for {name:?}"
        );
    }
    if regenerate {
        golden["cases"] = Value::Array(regenerated);
        let mut written = serde_json::to_string_pretty(&golden).expect("serializable");
        written.push('\n');
        fs::write(&path, written).expect("rewrite golden");
        panic!("golden regenerated — review the diff, then run without the flag");
    }
    assert_eq!(cases.len(), 13, "every golden case must be checked");
}

/// Packing suggestions are implemented twice — here and in the mock gateway.
/// This holds the core to the golden; `apps/web/src/parity.test.ts` holds the
/// mock to the same one.
///
/// The thresholds are the interesting half. They used to be six Rust constants
/// and six unrelated magic numbers in `mock.ts`, added *after* ADR-0004 asked
/// for a golden per mirrored rule, with nothing connecting them. Now the file
/// is the declaration and the mock imports it, so only this side needs holding.
#[test]
fn parity_packing_matches_the_contract() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/contracts/parity/packing.json");
    let raw = fs::read_to_string(&path).expect("parity/packing.json");
    let golden: Value = serde_json::from_str(&raw).expect("valid json");

    let thresholds = golden["thresholds"].as_object().expect("thresholds object");
    let floats = [
        ("coldLowC", crate::packing::COLD_LOW_C),
        ("warmHighC", crate::packing::WARM_HIGH_C),
        ("wetSharePct", crate::packing::WET_SHARE_PCT),
        ("highUv", crate::packing::HIGH_UV),
    ];
    for (key, value) in floats {
        assert_eq!(
            thresholds.get(key).and_then(Value::as_f64),
            Some(value),
            "{key} disagrees with the core"
        );
    }
    assert_eq!(
        thresholds.get("poorAqi").and_then(Value::as_u64),
        Some(u64::from(crate::packing::POOR_AQI)),
        "poorAqi disagrees with the core"
    );
    assert_eq!(
        thresholds.get("laundryNights").and_then(Value::as_i64),
        Some(crate::packing::LAUNDRY_NIGHTS),
        "laundryNights disagrees with the core"
    );
    // Nothing in the file goes unchecked, so a threshold cannot be added there
    // and silently enforced nowhere.
    assert_eq!(
        thresholds
            .keys()
            .filter(|key| !key.starts_with('$'))
            .count(),
        floats.len() + 2,
        "every threshold in parity/packing.json must be checked here"
    );

    let cases = golden["cases"].as_array().expect("cases array");
    for case in cases {
        let name = case["name"].as_str().expect("name");
        let trip: Trip = serde_json::from_value(case["trip"].clone()).expect("trip");
        let facts: Vec<ConfirmedFact> =
            serde_json::from_value(case["facts"].clone()).expect("facts");
        let weather: Option<crate::weather::WeatherSnapshot> =
            serde_json::from_value(case["weather"].clone()).expect("weather");

        let actual = serde_json::to_value(crate::packing::build_packing_list(
            &trip,
            &facts,
            weather.as_ref(),
        ))
        .expect("serializable");
        assert_eq!(
            actual, case["expected"],
            "build_packing_list disagrees for {name:?}"
        );
    }
    assert_eq!(cases.len(), 6, "every golden case must be checked");
}

/// Today is implemented in core and mirrored by the shipped in-memory gateway.
/// This pins the full serialized projection so a fact family, target lane, or
/// optional wire field cannot silently disappear from one implementation.
#[test]
fn parity_today_matches_the_contract() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/contracts/parity/today.json");
    let raw = fs::read_to_string(&path).expect("parity/today.json");
    let mut golden: Value = serde_json::from_str(&raw).expect("valid json");
    let regenerate = std::env::var("VOYALIER_REGENERATE_GOLDEN").is_ok();
    let trip: Trip = serde_json::from_value(golden["trip"].clone()).expect("trip");
    let cases = golden["cases"].as_array().expect("cases array").clone();
    let mut regenerated = Vec::with_capacity(cases.len());

    for case in &cases {
        let name = case["name"].as_str().expect("name");
        let facts: Vec<ConfirmedFact> =
            serde_json::from_value(case["facts"].clone()).expect("facts");
        let trip_items: Vec<TripItem> =
            serde_json::from_value(case["tripItems"].clone()).expect("trip items");
        let reference_date = case["referenceDate"].as_str().expect("reference date");
        let actual = serde_json::to_value(crate::build_today_view(
            &trip,
            &facts,
            &trip_items,
            reference_date,
        ))
        .expect("serializable Today view");

        if regenerate {
            let mut updated = case.clone();
            updated["expected"] = actual;
            regenerated.push(updated);
            continue;
        }
        assert_eq!(actual, case["expected"], "Today disagrees for {name:?}");
    }

    if regenerate {
        golden["cases"] = Value::Array(regenerated);
        let mut written = serde_json::to_string_pretty(&golden).expect("serializable");
        written.push('\n');
        fs::write(&path, written).expect("rewrite golden");
        panic!("golden regenerated — review the diff, then run without the flag");
    }
    assert_eq!(cases.len(), 6, "every Today golden case must be checked");
}

/// The share brief is privacy-sensitive mirrored output: confirmation codes,
/// traveler names, and private planning notes must be absent in both adapters,
/// with identical ordering and optional wire fields.
#[test]
fn parity_trip_brief_matches_the_contract() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/parity/trip-brief.json");
    let raw = fs::read_to_string(&path).expect("parity/trip-brief.json");
    let mut golden: Value = serde_json::from_str(&raw).expect("valid json");
    let regenerate = std::env::var("VOYALIER_REGENERATE_GOLDEN").is_ok();
    let trip: Trip = serde_json::from_value(golden["trip"].clone()).expect("trip");
    let canaries = golden["sensitiveCanaries"]
        .as_array()
        .expect("sensitive canaries")
        .iter()
        .map(|value| value.as_str().expect("canary"))
        .collect::<Vec<_>>();
    let cases = golden["cases"].as_array().expect("cases array").clone();
    let mut regenerated = Vec::with_capacity(cases.len());

    let fixture_text = cases
        .iter()
        .flat_map(|case| [case["facts"].to_string(), case["tripItems"].to_string()])
        .collect::<Vec<_>>()
        .join("\n");
    for canary in &canaries {
        assert!(
            fixture_text.contains(canary),
            "canary {canary:?} must exist in input"
        );
    }

    for case in &cases {
        let name = case["name"].as_str().expect("name");
        let facts: Vec<ConfirmedFact> =
            serde_json::from_value(case["facts"].clone()).expect("facts");
        let trip_items: Vec<TripItem> =
            serde_json::from_value(case["tripItems"].clone()).expect("trip items");
        let generated_at = case["generatedAt"].as_str().expect("generatedAt");
        let actual = serde_json::to_value(crate::build_trip_brief(
            &trip,
            &facts,
            &trip_items,
            &crate::RedactionPolicy::for_sharing(),
            generated_at,
        ))
        .expect("serializable brief");
        let actual_text = actual.to_string();
        for canary in &canaries {
            assert!(
                !actual_text.contains(canary),
                "brief {name:?} leaked canary {canary:?}"
            );
        }
        if regenerate {
            let mut updated = case.clone();
            updated["expected"] = actual;
            regenerated.push(updated);
            continue;
        }
        assert_eq!(
            actual, case["expected"],
            "trip brief disagrees for {name:?}"
        );
    }

    if regenerate {
        golden["cases"] = Value::Array(regenerated);
        let mut written = serde_json::to_string_pretty(&golden).expect("serializable");
        written.push('\n');
        fs::write(&path, written).expect("rewrite golden");
        panic!("golden regenerated — review the diff, then run without the flag");
    }
    let expected_text = cases
        .iter()
        .map(|case| case["expected"].to_string())
        .collect::<Vec<_>>()
        .join("\n");
    for canary in canaries {
        assert!(
            !expected_text.contains(canary),
            "expected output leaked canary {canary:?}"
        );
    }
    assert_eq!(cases.len(), 3, "every trip-brief case must be checked");
}

/// The destination-facts rules each language derives on read, held to one file.
///
/// These had no parity coverage at all: the facts family grew a source a day
/// with hand-written mock fixtures beside it, and nothing compared the two. The
/// narrowing rule is the one that mattered — the core sorts and de-duplicates
/// where the mock only filtered.
#[test]
fn parity_trip_facts_matches_the_contract() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/contracts/parity/trip-facts.json");
    let raw = fs::read_to_string(&path).expect("parity/trip-facts.json");
    let golden: Value = serde_json::from_str(&raw).expect("valid json");

    let cases = golden["timeDifference"]["cases"]
        .as_array()
        .expect("timeDifference cases");
    for case in cases {
        let name = case["name"].as_str().expect("name");
        let actual = serde_json::to_value(crate::facts::time_difference(
            case["originPlace"].as_str().expect("originPlace"),
            case["originUtcOffsetMinutes"].as_i64().expect("origin") as i32,
            case["destinationUtcOffsetMinutes"]
                .as_i64()
                .expect("destination") as i32,
        ))
        .expect("serializable");
        assert_eq!(actual, case["expected"], "time_difference for {name:?}");
    }
    assert_eq!(cases.len(), 4, "every timeDifference case must be checked");

    let rates: Vec<crate::facts::CurrencyRate> =
        serde_json::from_value(golden["crossRate"]["rates"].clone()).expect("rates");
    let cases = golden["crossRate"]["cases"]
        .as_array()
        .expect("crossRate cases");
    for case in cases {
        let name = case["name"].as_str().expect("name");
        let actual = crate::facts::cross_rate(
            &rates,
            case["from"].as_str().expect("from"),
            case["to"].as_str().expect("to"),
        );
        // Serialized rather than compared as f64 so an absent rate has to be
        // null on both sides — 0.0 or 1.0 standing in for "unknown" would read
        // as a real quote in the money block.
        assert_eq!(
            serde_json::to_value(actual).expect("serializable"),
            case["expected"],
            "cross_rate for {name:?}"
        );
    }
    assert_eq!(cases.len(), 7, "every crossRate case must be checked");

    let cases = golden["holidaysWithin"]["cases"]
        .as_array()
        .expect("holidaysWithin cases");
    for case in cases {
        let name = case["name"].as_str().expect("name");
        let holidays: Vec<crate::holidays::PublicHoliday> =
            serde_json::from_value(case["holidays"].clone()).expect("holidays");
        let actual = serde_json::to_value(crate::holidays::holidays_within(
            &holidays,
            case["start"].as_str().expect("start"),
            case["end"].as_str().expect("end"),
        ))
        .expect("serializable");
        assert_eq!(actual, case["expected"], "holidays_within for {name:?}");
    }
    assert_eq!(cases.len(), 4, "every holidaysWithin case must be checked");

    let cases = golden["tipping"]["cases"]
        .as_array()
        .expect("tipping cases");
    for case in cases {
        let iso2 = case["iso2"].as_str().expect("iso2");
        let actual =
            serde_json::to_value(crate::tipping::tipping_guidance(iso2)).expect("serializable");
        assert_eq!(actual, case["expected"], "tipping_guidance for {iso2:?}");
    }
    assert_eq!(cases.len(), 2, "every tipping case must be checked");

    let cases = golden["countryFacts"]["cases"]
        .as_array()
        .expect("countryFacts cases");
    for case in cases {
        let iso2 = case["iso2"].as_str().expect("iso2");
        let actual = serde_json::to_value(crate::facts::country_facts(iso2)).expect("serializable");
        assert_eq!(actual, case["expected"], "country_facts for {iso2:?}");
    }
    assert_eq!(cases.len(), 2, "every countryFacts case must be checked");
}

#[test]
fn rust_examples_validate_against_contract_schemas() {
    let schema_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/contracts/schemas");
    let schemas = SchemaSet::load(&schema_dir);

    let trip = Trip {
        id: "trip_schema".to_owned(),
        title: "Chicago -> Kyoto".to_owned(),
        origin: "Chicago".to_owned(),
        destination: "Kyoto".to_owned(),
        start_date: "2027-04-01".to_owned(),
        end_date: "2027-04-10".to_owned(),
        status: TripStatus::Active,
        created_at: "2026-07-10T00:00:00Z".to_owned(),
        updated_at: "2026-07-10T00:00:00Z".to_owned(),
    };

    let candidate = CandidateFact {
        id: "cand_schema".to_owned(),
        trip_id: trip.id.clone(),
        document_id: "doc_schema".to_owned(),
        parser_run_id: "run_schema".to_owned(),
        fact_type: FactType::FlightSegment,
        payload: FactPayload {
            airline_name: Some("Nimbus Air".to_owned()),
            airline_iata: Some("NB".to_owned()),
            flight_number: Some("412".to_owned()),
            departure_airport_iata: Some("SFO".to_owned()),
            arrival_airport_iata: Some("NRT".to_owned()),
            departure_local: Some("2026-08-01T22:30".to_owned()),
            arrival_local: Some("2026-08-02T04:55".to_owned()),
            confirmation_code: Some("SKY8KY".to_owned()),
            passenger_name: Some("Alex Example".to_owned()),
            ..FactPayload::default()
        },
        method: ExtractionMethod::Structured,
        field_spans: vec![FieldSpan {
            field_path: "payload.confirmationCode".to_owned(),
            start: 10,
            end: 16,
            excerpt: "Confirmation SKY8KY".to_owned(),
        }],
        warnings: vec![],
        status: CandidateStatus::Pending,
        created_at: "2026-07-10T00:00:00Z".to_owned(),
        resolved_at: None,
        amends_fact_id: None,
    };

    let confirmed = ConfirmedFact {
        id: "fact_schema".to_owned(),
        trip_id: trip.id.clone(),
        fact_type: FactType::FlightSegment,
        payload: candidate.payload.clone(),
        method: ExtractionMethod::Structured,
        candidate_id: Some(candidate.id.clone()),
        corrected_fields: vec!["payload.flightNumber".to_owned()],
        confirmed_at: "2026-07-10T00:00:00Z".to_owned(),
        source_removed: false,
    };

    let import_result = ImportResult {
        document: SourceDocument {
            id: candidate.document_id.clone(),
            trip_id: trip.id.clone(),
            kind: DocumentKind::Html,
            label: "Fixture".to_owned(),
            content_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                .to_owned(),
            char_count: 128,
            imported_at: "2026-07-10T00:00:00Z".to_owned(),
        },
        parser_run_id: candidate.parser_run_id.clone(),
        candidates: vec![candidate.clone()],
        duplicates_ignored: 0,
    };

    let app_error = AppError {
        code: ErrorCode::DocumentDuplicate,
        message: "duplicate document".to_owned(),
        details: Some(BTreeMap::from([(
            "existingDocumentId".to_owned(),
            "doc_schema".to_owned(),
        )])),
    };

    assert_schema(&schemas, "Trip.schema.json", &trip);
    assert_schema(&schemas, "CandidateFact.schema.json", &candidate);
    assert_schema(&schemas, "ConfirmedFact.schema.json", &confirmed);
    assert_schema(&schemas, "ImportResult.schema.json", &import_result);
    assert_schema(&schemas, "AppError.schema.json", &app_error);

    let health = HealthResponse {
        status: "ok".to_owned(),
        service: "voyalier-core-test".to_owned(),
        version: "0.1.0".to_owned(),
        intelligence_mode: IntelligenceMode::Local,
    };
    let health_json = serde_json::to_value(health).expect("health json");
    assert_eq!(health_json["intelligenceMode"], "local");
    assert!(health_json.get("intelligence_mode").is_none());

    let readiness = serde_json::to_value(ReadinessStatus::ActionNeeded).expect("readiness");
    assert_eq!(readiness, Value::String("action_needed".to_owned()));

    let _ = serde_json::to_value(AddManualFactInput {
        trip_id: trip.id,
        fact_type: FactType::FlightSegment,
        payload: confirmed.payload,
    })
    .expect("manual input");
    let _ = serde_json::to_value(ConfirmCandidateInput {
        candidate_id: candidate.id,
        edited_payload: None,
        amendment_action: None,
    })
    .expect("confirm input");
    let _ = serde_json::to_value(ImportDocumentInput {
        trip_id: "trip_schema".to_owned(),
        kind: DocumentKind::PastedText,
        label: None,
        content: "Confirmation TEST1".to_owned(),
    })
    .expect("import input");
}

#[test]
fn generated_ids_keep_prefixes() {
    assert!(new_id("trip").starts_with("trip_"));
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureExpectation {
    parser: String,
    exact: bool,
    expected_candidates: Vec<ExpectedCandidate>,
    expected_diagnostics: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedCandidate {
    fact_type: FactType,
    method: ExtractionMethod,
    payload: BTreeMap<String, String>,
    #[serde(default)]
    warnings: Vec<WarningCode>,
}

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/parser")
}

fn read_expectation(case_dir: &Path) -> FixtureExpectation {
    let raw = fs::read_to_string(case_dir.join("expected.json")).expect("expected json");
    serde_json::from_str(&raw).expect("expected shape")
}

fn field_scores(
    expected: &FixtureExpectation,
    outcome: &crate::parser::ParserOutcome,
) -> (f64, f64, f64) {
    let expected_fields = expected_field_set(expected);
    let actual_fields = actual_field_set(outcome);
    let true_positive = expected_fields.intersection(&actual_fields).count() as f64;
    let precision = if actual_fields.is_empty() {
        0.0
    } else {
        true_positive / actual_fields.len() as f64
    };
    let recall = if expected_fields.is_empty() {
        1.0
    } else {
        true_positive / expected_fields.len() as f64
    };
    let f1 = if precision + recall == 0.0 {
        0.0
    } else {
        2.0 * precision * recall / (precision + recall)
    };
    (precision, recall, f1)
}

fn assert_expected_subset(
    case_dir: &Path,
    expected: &FixtureExpectation,
    outcome: &crate::parser::ParserOutcome,
) {
    let expected_fields = expected_field_set(expected);
    let actual_fields = actual_field_set(outcome);
    for field in expected_fields {
        assert!(
            actual_fields.contains(&field),
            "{} missing expected field {field}; actual {:?}",
            case_dir.display(),
            actual_fields
        );
    }

    for expected_candidate in &expected.expected_candidates {
        for expected_warning in &expected_candidate.warnings {
            assert!(
                outcome
                    .candidates
                    .iter()
                    .any(|candidate| candidate.warnings.contains(expected_warning)),
                "{} missing expected candidate warning {:?}",
                case_dir.display(),
                expected_warning
            );
        }
    }
}

fn expected_field_set(expected: &FixtureExpectation) -> BTreeSet<String> {
    expected
        .expected_candidates
        .iter()
        .flat_map(|candidate| {
            candidate.payload.iter().map(|(key, value)| {
                format!(
                    "{:?}:{:?}:payload.{key}={value}",
                    candidate.fact_type, candidate.method
                )
            })
        })
        .collect()
}

fn actual_field_set(outcome: &crate::parser::ParserOutcome) -> BTreeSet<String> {
    outcome
        .candidates
        .iter()
        .flat_map(|candidate| {
            let value = serde_json::to_value(&candidate.payload).expect("payload json");
            value
                .as_object()
                .expect("payload object")
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| {
                        format!(
                            "{:?}:{:?}:payload.{key}={value}",
                            candidate.fact_type, candidate.method
                        )
                    })
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[test]
fn parity_visa_stats_sources_match_the_contract() {
    // ADR-0014: the source table is user-facing surface, so it is pinned as a
    // golden the web side reads too — the mock renders from this file rather
    // than mirroring the Rust table (ADR-0004).
    let register: serde_json::Value = serde_json::from_str(include_str!(
        "../../../packages/contracts/parity/visa-stats-sources.json"
    ))
    .expect("visa stats source golden");
    let sources = register["sources"].as_array().expect("sources");
    assert_eq!(sources.len() as u64, register["count"].as_u64().unwrap());
    assert_eq!(
        sources.len(),
        7,
        "bump both count pins when curating an authority"
    );

    for row in sources {
        let code = row["destinationIso2"].as_str().expect("code");
        let source = crate::stats_source(code).expect("every golden row is curated");
        assert_eq!(
            source.authority_name,
            row["authorityName"].as_str().unwrap()
        );
        assert_eq!(source.page_url, row["pageUrl"].as_str().unwrap());
        assert_eq!(source.fetchable, row["fetchable"].as_bool().unwrap());
    }
    assert_eq!(
        sources
            .iter()
            .filter(|row| row["fetchable"].as_bool().unwrap())
            .count(),
        2,
        "CA and GB carry parsers in this slice"
    );
    assert!(crate::stats_source("FR").is_none(), "no eighth authority");
}

#[test]
fn parity_visa_journeys_match_the_contract() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/contracts/parity/visa.json");
    let raw = fs::read_to_string(&path).expect("parity/visa.json");
    let mut golden: Value = serde_json::from_str(&raw).expect("valid json");
    // ADR-0004, same rule as the other goldens: regeneration is deliberate and
    // panics afterwards so the diff gets read, never to turn a red test green.
    let regenerate = std::env::var("VOYALIER_REGENERATE_GOLDEN").is_ok();

    let cases = golden["cases"].as_array().expect("cases array").clone();
    assert_eq!(
        cases.len() as u64,
        golden["caseCount"].as_u64().expect("caseCount"),
        "caseCount must be bumped in visa.json and in both tests when a case is added"
    );

    let mut regenerated = Vec::with_capacity(cases.len());
    for case in &cases {
        let name = case["name"].as_str().expect("name");
        let destination = case["destination"].as_str().expect("destination");
        let nationality = case["nationality"].as_str().expect("nationality");

        // Structure only. The curated prose is rendered verbatim by the
        // interface, so pinning it here would be churn rather than parity.
        let journey = crate::visa_journey(destination, nationality);
        let actual = serde_json::json!({
            "entryPath": crate::entry_path(destination, nationality),
            "routeLabel": journey.as_ref().map(|journey| journey.route_label.clone()),
            "stepIds": journey.as_ref().map(|journey| {
                journey.steps.iter().map(|step| step.id.clone()).collect::<Vec<_>>()
            }),
            "ordinals": journey.as_ref().map(|journey| {
                journey.steps.iter().map(|step| step.ordinal).collect::<Vec<_>>()
            }),
            "documentIds": journey.as_ref().map(|journey| {
                journey
                    .steps
                    .iter()
                    .flat_map(|step| step.documents.iter().map(|document| document.id.clone()))
                    .collect::<Vec<_>>()
            }),
            // The universal playbook fills exactly the cases a journey does not
            // (spec 2026-08-02): pinned here so the mock can synthesize it from
            // this file instead of mirroring core prose (ADR-0004).
            "playbook": journey.is_none().then(|| {
                let playbook = crate::universal_playbook(
                    destination,
                    nationality,
                    crate::entry_path(destination, nationality).as_ref(),
                );
                serde_json::json!({
                    "stepIds": playbook
                        .steps
                        .iter()
                        .map(|step| step.id.clone())
                        .collect::<Vec<_>>(),
                    "ordinals": playbook
                        .steps
                        .iter()
                        .map(|step| step.ordinal)
                        .collect::<Vec<_>>(),
                    "documentIds": playbook
                        .steps
                        .iter()
                        .flat_map(|step| step.documents.iter().map(|document| document.id.clone()))
                        .collect::<Vec<_>>(),
                })
            }),
        });

        if regenerate {
            let mut updated = case.clone();
            updated["expected"] = actual;
            regenerated.push(updated);
            continue;
        }
        assert_eq!(
            actual, case["expected"],
            "visa journey disagrees for {name:?}"
        );
    }

    if regenerate {
        golden["cases"] = Value::Array(regenerated);
        let mut serialized = serde_json::to_string_pretty(&golden).expect("serialize");
        serialized.push('\n');
        fs::write(&path, serialized).expect("write golden");
        panic!("regenerated parity/visa.json -- read the diff, then rerun without the env var");
    }
}

fn assert_schema<T: serde::Serialize>(schemas: &SchemaSet, schema_name: &str, value: &T) {
    let json = serde_json::to_value(value).expect("json");
    schemas
        .validate(schema_name, &json)
        .unwrap_or_else(|errors| panic!("{schema_name} failed: {errors:?}\n{json:#}"));
}

// ---------------------------------------------------------------------------
// Surface transport facts (ADR-0016 §1)
// ---------------------------------------------------------------------------

fn journey_fact(id: &str, fact_type: FactType, departure: &str, arrival: &str) -> ConfirmedFact {
    ConfirmedFact {
        id: id.to_owned(),
        trip_id: "trip_1".to_owned(),
        fact_type,
        payload: FactPayload {
            carrier_name: Some("Meridian Rail".to_owned()),
            service_number: Some("9024".to_owned()),
            departure_place: Some("London St Pancras".to_owned()),
            arrival_place: Some("Paris Gare du Nord".to_owned()),
            departure_local: Some(departure.to_owned()),
            arrival_local: Some(arrival.to_owned()),
            ..FactPayload::default()
        },
        method: ExtractionMethod::Structured,
        candidate_id: None,
        corrected_fields: Vec::new(),
        confirmed_at: "2026-08-01T00:00:00Z".to_owned(),
        source_removed: false,
    }
}

fn parse_html(raw: &str) -> crate::parser::ParserOutcome {
    JsonLdParser.parse(&NormalizedDocument::new(DocumentKind::Html, raw))
}

#[test]
fn every_payload_field_is_listed_by_exactly_one_fact_type() {
    // The union of the per-type allow-lists must cover every field the payload
    // can serialize. A field missing from all four is unreachable; the
    // `reject_foreign_fields` rule would refuse it for every type.
    let populated = FactPayload {
        airline_name: Some("a".to_owned()),
        airline_iata: Some("a".to_owned()),
        flight_number: Some("a".to_owned()),
        departure_airport_iata: Some("a".to_owned()),
        arrival_airport_iata: Some("a".to_owned()),
        departure_local: Some("a".to_owned()),
        arrival_local: Some("a".to_owned()),
        confirmation_code: Some("a".to_owned()),
        passenger_name: Some("a".to_owned()),
        property_name: Some("a".to_owned()),
        address: Some("a".to_owned()),
        checkin_date: Some("a".to_owned()),
        checkout_date: Some("a".to_owned()),
        guest_name: Some("a".to_owned()),
        carrier_name: Some("a".to_owned()),
        service_number: Some("a".to_owned()),
        departure_place: Some("a".to_owned()),
        arrival_place: Some("a".to_owned()),
        vehicle_description: Some("a".to_owned()),
    };
    let serialized = serde_json::to_value(&populated).expect("payload json");
    let on_the_wire: BTreeSet<String> = serialized
        .as_object()
        .expect("object")
        .keys()
        .map(|key| format!("payload.{key}"))
        .collect();

    let mut declared: BTreeSet<String> = BTreeSet::new();
    for fact_type in FACT_TYPES {
        for path in fact_type.field_paths() {
            declared.insert((*path).to_owned());
        }
    }

    assert_eq!(
        on_the_wire, declared,
        "every payload field must belong to at least one fact type"
    );
}

const FACT_TYPES: [FactType; 6] = [
    FactType::FlightSegment,
    FactType::LodgingStay,
    FactType::RailJourney,
    FactType::CoachJourney,
    FactType::FerryCrossing,
    FactType::CarRental,
];

#[test]
fn a_fact_type_refuses_a_field_that_belongs_to_another() {
    // A rail journey has no airport code, and a flight has no station name.
    let with_airport = FactPayload {
        departure_airport_iata: Some("LHR".to_owned()),
        ..FactPayload::default()
    };
    let error = validate_fact_payload(FactType::RailJourney, &with_airport)
        .expect_err("a rail journey cannot carry an airport code");
    assert_eq!(error.code, ErrorCode::ValidationInvalidInput);

    let with_station = FactPayload {
        departure_place: Some("London St Pancras".to_owned()),
        ..FactPayload::default()
    };
    assert!(
        validate_fact_payload(FactType::FlightSegment, &with_station).is_err(),
        "a flight cannot carry a station name"
    );

    // The pairs that are legal stay legal.
    for fact_type in [
        FactType::RailJourney,
        FactType::CoachJourney,
        FactType::FerryCrossing,
        FactType::CarRental,
    ] {
        let payload = FactPayload {
            departure_place: Some("A".to_owned()),
            arrival_place: Some("B".to_owned()),
            departure_local: Some("2026-08-03T09:01".to_owned()),
            arrival_local: Some("2026-08-03T12:17".to_owned()),
            confirmation_code: Some("X1".to_owned()),
            ..FactPayload::default()
        };
        validate_fact_payload(fact_type, &payload).expect("a journey payload is valid");
    }
}

#[test]
fn a_service_number_belongs_to_scheduled_services_only() {
    let payload = FactPayload {
        service_number: Some("9024".to_owned()),
        ..FactPayload::default()
    };
    for fact_type in [
        FactType::RailJourney,
        FactType::CoachJourney,
        FactType::FerryCrossing,
    ] {
        validate_fact_payload(fact_type, &payload).expect("scheduled services carry a service");
    }
    assert!(
        validate_fact_payload(FactType::CarRental, &payload).is_err(),
        "a hire car has no scheduled service number"
    );
    assert!(
        validate_fact_payload(FactType::LodgingStay, &payload).is_err(),
        "a stay has no service number"
    );
}

#[test]
fn journey_times_are_parsed_but_an_inverted_pair_is_not_refused() {
    let bad_time = FactPayload {
        departure_local: Some("not a time".to_owned()),
        ..FactPayload::default()
    };
    assert!(validate_fact_payload(FactType::FerryCrossing, &bad_time).is_err());

    // An overnight sleeper reads oddly and is still recordable: the itinerary
    // checks report it, validation does not block it. Flights have always
    // behaved this way, and surface legs must not be stricter.
    let inverted = FactPayload {
        departure_local: Some("2026-08-03T23:50".to_owned()),
        arrival_local: Some("2026-08-03T06:10".to_owned()),
        ..FactPayload::default()
    };
    validate_fact_payload(FactType::RailJourney, &inverted).expect("recordable");
    validate_fact_payload(FactType::FlightSegment, &inverted).expect("same rule as a flight");
}

#[test]
fn the_parser_reads_each_surface_reservation_kind() {
    let cases = [
        ("jsonld-rail", FactType::RailJourney),
        ("jsonld-coach", FactType::CoachJourney),
        ("jsonld-ferry", FactType::FerryCrossing),
        ("jsonld-car-rental", FactType::CarRental),
    ];
    for (case, expected) in cases {
        let raw = fs::read_to_string(fixture_root().join(case).join("input.html"))
            .expect("fixture input");
        let outcome = parse_html(&raw);
        assert_eq!(
            outcome.candidates.len(),
            1,
            "{case} should yield exactly one candidate"
        );
        assert_eq!(
            outcome.candidates[0].fact_type, expected,
            "{case} resolved the wrong fact type"
        );
        assert!(
            outcome.candidates[0].payload.departure_place.is_some(),
            "{case} lost its departure place"
        );
        assert!(
            outcome.candidates[0]
                .payload
                .departure_airport_iata
                .is_none(),
            "{case} must not invent an airport code"
        );
        // Every extracted value carries a span back into the source document.
        assert!(
            !outcome.candidates[0].field_spans.is_empty(),
            "{case} lost its evidence spans"
        );
    }
}

#[test]
fn a_sparse_surface_reservation_warns_rather_than_inventing() {
    let raw = fs::read_to_string(fixture_root().join("jsonld-rail-sparse").join("input.html"))
        .expect("fixture input");
    let outcome = parse_html(&raw);
    let candidate = outcome.candidates.first().expect("a candidate");
    assert_eq!(candidate.fact_type, FactType::RailJourney);
    assert!(candidate.payload.departure_place.is_none());
    assert!(candidate.payload.departure_local.is_none());
    assert!(candidate.warnings.contains(&WarningCode::MissingLocations));
    assert!(candidate.warnings.contains(&WarningCode::MissingDates));
}

#[test]
fn a_train_and_a_flight_cannot_run_at_once() {
    let trip = Trip {
        id: "trip_1".to_owned(),
        title: "Continental hop".to_owned(),
        origin: "London".to_owned(),
        destination: "Paris".to_owned(),
        start_date: "2026-08-03".to_owned(),
        end_date: "2026-08-06".to_owned(),
        status: TripStatus::Active,
        created_at: "2026-08-01T00:00:00Z".to_owned(),
        updated_at: "2026-08-01T00:00:00Z".to_owned(),
    };
    let mut flight = journey_fact(
        "fact_air",
        FactType::FlightSegment,
        "2026-08-03T10:00",
        "2026-08-03T11:30",
    );
    flight.payload = FactPayload {
        flight_number: Some("NB412".to_owned()),
        departure_local: Some("2026-08-03T10:00".to_owned()),
        arrival_local: Some("2026-08-03T11:30".to_owned()),
        ..FactPayload::default()
    };
    let train = journey_fact(
        "fact_rail",
        FactType::RailJourney,
        "2026-08-03T09:01",
        "2026-08-03T12:17",
    );

    let conflicts = crate::detect_itinerary_conflicts(&trip, &[flight.clone(), train.clone()]);
    let overlap = conflicts
        .iter()
        .find(|conflict| conflict.kind == crate::ItineraryConflictKind::JourneyOverlap)
        .expect("a mixed-mode overlap is reported");
    assert_eq!(overlap.fact_ids, vec!["fact_air", "fact_rail"]);

    // A hire car booked across the same window is not a conflict: it sits in a
    // car park while its holder takes the train.
    let hire = journey_fact(
        "fact_car",
        FactType::CarRental,
        "2026-08-03T08:00",
        "2026-08-06T08:00",
    );
    let with_car = crate::detect_itinerary_conflicts(&trip, &[train, hire]);
    assert!(
        with_car
            .iter()
            .all(|conflict| conflict.kind != crate::ItineraryConflictKind::JourneyOverlap),
        "a parked hire car does not overlap a train"
    );
}

#[test]
fn a_surface_leg_reaches_today_the_brief_and_search() {
    let trip = Trip {
        id: "trip_1".to_owned(),
        title: "Continental hop".to_owned(),
        origin: "London".to_owned(),
        destination: "Paris".to_owned(),
        start_date: "2026-08-03".to_owned(),
        end_date: "2026-08-06".to_owned(),
        status: TripStatus::Active,
        created_at: "2026-08-01T00:00:00Z".to_owned(),
        updated_at: "2026-08-01T00:00:00Z".to_owned(),
    };
    let train = journey_fact(
        "fact_rail",
        FactType::RailJourney,
        "2026-08-03T09:01",
        "2026-08-03T12:17",
    );

    let today = crate::build_today_view(&trip, std::slice::from_ref(&train), &[], "2026-08-03");
    assert!(
        today
            .today
            .iter()
            .any(|item| item.kind == crate::TodayItemKind::JourneyDeparture),
        "a confirmed rail departure belongs in Today"
    );
    assert!(
        today
            .today
            .iter()
            .all(|item| item.kind != crate::TodayItemKind::Rail),
        "confirmed evidence must not borrow the traveler-authored Rail kind"
    );

    let brief = crate::build_trip_brief(
        &trip,
        std::slice::from_ref(&train),
        &[],
        &crate::RedactionPolicy::default(),
        "2026-08-02T00:00:00Z",
    );
    assert_eq!(
        brief.journeys.len(),
        1,
        "a surface leg belongs in the brief"
    );
    assert!(brief.flights.is_empty());

    // Its operator and stations are searchable text.
    let text = crate::fact_search_text(&train);
    assert!(text.contains("Meridian Rail"));
    assert!(text.contains("Paris Gare du Nord"));
    assert_eq!(
        crate::fact_identity(&train).as_deref(),
        Some("London St Pancras → Paris Gare du Nord")
    );
}

#[test]
fn a_surface_leg_names_itself_by_service_then_route() {
    let mut train = journey_fact(
        "fact_rail",
        FactType::RailJourney,
        "2026-08-03T09:01",
        "2026-08-03T12:17",
    );
    assert_eq!(
        crate::fact_label(&train),
        crate::FactLabel::JourneyService {
            mode: crate::TransportMode::Rail,
            service: "9024".to_owned()
        }
    );

    train.payload.service_number = None;
    train.payload.carrier_name = None;
    assert_eq!(
        crate::fact_label(&train),
        crate::FactLabel::JourneyRoute {
            mode: crate::TransportMode::Rail,
            from: "London St Pancras".to_owned(),
            to: "Paris Gare du Nord".to_owned()
        }
    );

    train.payload.departure_place = None;
    assert_eq!(
        crate::fact_label(&train),
        crate::FactLabel::Journey {
            mode: crate::TransportMode::Rail
        }
    );
}
