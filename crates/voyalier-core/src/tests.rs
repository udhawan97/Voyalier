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
    ReadinessStatus, SourceDocument, Trip, TripDraft, TripStatus, WarningCode,
    changed_payload_fields, new_id, schema_validation::SchemaSet, validate_create_trip,
    validate_fact_payload,
};

#[test]
fn creates_a_trimmed_trip_draft() {
    let trip =
        TripDraft::new(" Chicago ", " Kyoto ", "2027-04-01", "2027-04-10").expect("valid trip");

    assert_eq!(trip.origin, "Chicago");
    assert_eq!(trip.destination, "Kyoto");
}

#[test]
fn rejects_a_missing_destination() {
    let error = TripDraft::new("Chicago", " ", "2027-04-01", "2027-04-10")
        .expect_err("destination must be required");

    assert!(error.to_string().contains("destination"));
}

#[test]
fn serializes_trip_draft_with_camel_case_wire_fields() {
    let trip = TripDraft::new("Chicago", "Kyoto", "2027-04-01", "2027-04-10").expect("trip");
    let json = serde_json::to_value(trip).expect("serialize trip");

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

    assert_eq!(validated.title, "Chicago -> Kyoto");
    assert_eq!(validated.origin, "Chicago");

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
    assert_eq!(cases.len(), 12, "every golden case must be checked");
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

fn assert_schema<T: serde::Serialize>(schemas: &SchemaSet, schema_name: &str, value: &T) {
    let json = serde_json::to_value(value).expect("json");
    schemas
        .validate(schema_name, &json)
        .unwrap_or_else(|errors| panic!("{schema_name} failed: {errors:?}\n{json:#}"));
}
